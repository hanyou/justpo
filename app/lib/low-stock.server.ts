/**
 * Low-stock checking (PRD §6.3).
 *
 * Compares per-variant thresholds (low_stock_thresholds table) against live
 * Shopify inventoryQuantity. Used by the dashboard (live alerts) and by the
 * hourly worker cron (08:00 shop-local digest email).
 */

export interface GraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<{ json: () => Promise<any> }>;
}

export interface LowStockAlert {
  variantId: string;
  sku: string | null;
  title: string;
  onHand: number;
  threshold: number;
}

export interface Threshold {
  variant_id: string;
  sku: string | null;
  threshold: number;
}

export async function loadThresholds(db: D1Database, shopId: string): Promise<Threshold[]> {
  const { results } = await db
    .prepare(`SELECT variant_id, sku, threshold FROM low_stock_thresholds WHERE shop_id = ?`)
    .bind(shopId)
    .all<Threshold>();
  return results ?? [];
}

/**
 * Returns alerts for variants at or below their threshold.
 * Variants that no longer exist in Shopify are skipped (not errors).
 */
export async function checkLowStock(
  admin: GraphqlClient,
  db: D1Database,
  shopId: string
): Promise<LowStockAlert[]> {
  const thresholds = await loadThresholds(db, shopId);
  if (thresholds.length === 0) return [];

  const ids = thresholds.map((t) => t.variant_id);
  const byId = new Map(thresholds.map((t) => [t.variant_id, t]));

  // 50 ids per request to stay well under GraphQL limits.
  const alerts: LowStockAlert[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const response = await admin.graphql(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            sku
            title
            inventoryQuantity
            product { title }
          }
        }
      }`,
      { variables: { ids: batch } }
    );
    const data = await response.json();
    for (const node of data?.data?.nodes ?? []) {
      if (!node?.id) continue; // deleted variant — skip
      const t = byId.get(node.id);
      if (!t) continue;
      const onHand = node.inventoryQuantity ?? 0;
      if (onHand <= t.threshold) {
        alerts.push({
          variantId: node.id,
          sku: node.sku ?? t.sku,
          title: node.product?.title
            ? `${node.product.title} — ${node.title}`
            : node.title ?? node.sku ?? node.id,
          onHand,
          threshold: t.threshold,
        });
      }
    }
  }
  return alerts;
}

export async function getShopContact(
  admin: GraphqlClient
): Promise<{ email: string | null; ianaTimezone: string | null }> {
  const response = await admin.graphql(`query { shop { email ianaTimezone } }`);
  const data = await response.json();
  return {
    email: data?.data?.shop?.email ?? null,
    ianaTimezone: data?.data?.shop?.ianaTimezone ?? null,
  };
}
