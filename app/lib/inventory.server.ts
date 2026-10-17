/**
 * Shopify inventory writeback (PRD §6.2, §6.5).
 *
 * 2026-07 `inventoryAdjustQuantities` requires BOTH an `@idempotent(key)`
 * directive AND a `changeFromQuantity` (the pre-change `available`, for
 * compare-and-swap). So before writing we read back, per inventory item, the
 * location that actually stocks it and its current available.
 *
 * P0 limitation: one write per item, at the first location that stocks it.
 * Failures are recorded per line as writeback_status (pending|success|failed)
 * and surfaced in the UI with a manual retry button — the PO itself is never
 * blocked by a writeback failure. Retries reuse the same idempotent key (derived
 * from poId:lineId:receivedTarget) so a replayed batch never double-counts.
 */
import type { GraphqlClient } from "./low-stock.server";

export interface WritebackItem {
  lineId: string;
  inventoryItemId: string;
  delta: number; // positive = stock in
  idempotentKey: string; // monotonic per line, decoupled from the delta amount
}

export interface LevelInfo {
  locationId: string;
  available: number;
}

/**
 * For each inventory item, find the location that actually stocks it plus the
 * current `available` quantity (the `changeFromQuantity` Shopify needs). P0:
 * picks the first level that reports an available quantity. Batched 50 at a
 * time. Reading levels works with `write_inventory` (no `read_inventory` needed).
 */
export async function getInventoryLevels(
  admin: GraphqlClient,
  inventoryItemIds: string[]
): Promise<Map<string, LevelInfo>> {
  const map = new Map<string, LevelInfo>();
  const unique = [...new Set(inventoryItemIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const response = await admin.graphql(
      `query($ids: [ID!]!, $names: [String!]!) {
        nodes(ids: $ids) {
          ... on InventoryItem {
            id
            inventoryLevels(first: 10) {
              edges { node { location { id } quantities(names: $names) { name quantity } } }
            }
          }
        }
      }`,
      { variables: { ids: batch, names: ["available"] } }
    );
    const data = await response.json();
    for (const node of data?.data?.nodes ?? []) {
      if (!node?.id) continue;
      for (const e of node?.inventoryLevels?.edges ?? []) {
        const locId = e?.node?.location?.id;
        const avail = (e?.node?.quantities ?? []).find(
          (q: any) => q?.name === "available"
        )?.quantity;
        if (locId && typeof avail === "number") {
          map.set(node.id, { locationId: locId, available: avail });
          break;
        }
      }
    }
  }
  return map;
}

/** Resolve Shopify variant IDs → inventory item IDs (batched, 50 at a time). */
export async function getInventoryItemIds(
  admin: GraphqlClient,
  variantIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(variantIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const response = await admin.graphql(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id inventoryItem { id } }
        }
      }`,
      { variables: { ids: batch } }
    );
    const data = await response.json();
    for (const node of data?.data?.nodes ?? []) {
      if (node?.id && node?.inventoryItem?.id) {
        map.set(node.id, node.inventoryItem.id);
      }
    }
  }
  return map;
}

/**
 * Adjust `available` at a location. Requires `changeFromQuantity` (pre-change
 * available) and an `@idempotent` key on 2026-07. Returns ok + the authoritative
 * applied delta parsed from `inventoryAdjustmentGroup.changes` (on an idempotent
 * replay this is the FIRST effective amount, so accounting never drifts).
 */
export async function adjustInventory(
  admin: GraphqlClient,
  input: {
    inventoryItemId: string;
    locationId: string;
    delta: number;
    changeFromQuantity: number;
    idempotentKey: string;
  }
): Promise<{ ok: boolean; error?: string; appliedDelta?: number }> {
  try {
    const response = await admin.graphql(
      `mutation($input: InventoryAdjustQuantitiesInput!, $key: String!) {
        inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
          userErrors { field message }
          inventoryAdjustmentGroup { changes { name delta } }
        }
      }`,
      {
        variables: {
          key: input.idempotentKey,
          input: {
            reason: "received",
            name: "available",
            referenceDocumentUri: "justpo://purchase-order",
            changes: [
              {
                delta: input.delta,
                changeFromQuantity: input.changeFromQuantity,
                inventoryItemId: input.inventoryItemId,
                locationId: input.locationId,
              },
            ],
          },
        },
      }
    );
    const data = await response.json();
    const payload = data?.data?.inventoryAdjustQuantities;
    const errors = payload?.userErrors ?? [];
    if (data?.errors?.length || errors.length > 0) {
      const msg =
        errors.map((e: any) => e.message).join("; ") ||
        (data?.errors ?? []).map((e: any) => e.message).join("; ");
      return { ok: false, error: msg || "Unknown inventory error" };
    }
    const appliedDelta = (payload?.inventoryAdjustmentGroup?.changes ?? [])
      .filter((c: any) => c?.name === "available")
      .reduce((sum: number, c: any) => sum + (Number(c?.delta) || 0), 0);
    return { ok: true, appliedDelta };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface WritebackResult {
  lineId: string;
  ok: boolean;
  error?: string;
}

/**
 * Write back receipt deltas for a PO's lines. Updates each line's
 * writeback_status AND qty_written_back in D1 (so retries only write the
 * not-yet-written portion — no double counting). Never throws.
 */
export async function writebackReceipt(
  admin: GraphqlClient,
  db: D1Database,
  items: WritebackItem[]
): Promise<WritebackResult[]> {
  const results: WritebackResult[] = [];
  const actionable = items.filter((i) => i.delta > 0 && i.inventoryItemId);
  if (actionable.length === 0) return results;

  // Read the stocked location + current available for each item (needed for
  // changeFromQuantity). Items with no level anywhere are recorded as failed.
  const levels = await getInventoryLevels(
    admin,
    actionable.map((i) => i.inventoryItemId)
  );

  for (const item of actionable) {
    const level = levels.get(item.inventoryItemId);
    if (!level) {
      await db
        .prepare(`UPDATE po_line_items SET writeback_status = 'failed' WHERE id = ?`)
        .bind(item.lineId)
        .run();
      results.push({ lineId: item.lineId, ok: false, error: "not stocked at any location" });
      console.error(
        `[justpo] writeback: no inventory level for item ${item.inventoryItemId} (line ${item.lineId})`
      );
      continue;
    }

    const { ok, error, appliedDelta } = await adjustInventory(admin, {
      inventoryItemId: item.inventoryItemId,
      locationId: level.locationId,
      changeFromQuantity: level.available,
      delta: item.delta,
      idempotentKey: item.idempotentKey,
    });
    if (ok) {
      // Account by the amount Shopify actually applied, not the local intent.
      const applied = typeof appliedDelta === "number" ? appliedDelta : item.delta;
      await db
        .prepare(
          `UPDATE po_line_items
           SET writeback_status = 'success', qty_written_back = qty_written_back + ?
           WHERE id = ?`
        )
        .bind(applied, item.lineId)
        .run();
    } else {
      await db
        .prepare(`UPDATE po_line_items SET writeback_status = 'failed' WHERE id = ?`)
        .bind(item.lineId)
        .run();
      console.error(`[justpo] writeback failed for line ${item.lineId}: ${error}`);
    }
    results.push({ lineId: item.lineId, ok, error });
  }
  return results;
}
