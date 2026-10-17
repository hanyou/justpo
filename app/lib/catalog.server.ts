/**
 * Shopify catalog search (product/variant picker backing the PO and
 * settings flows). Read-only; needs read_products.
 */
import type { GraphqlClient } from "./low-stock.server";

export interface VariantOption {
  id: string;
  sku: string | null;
  title: string;
  inventoryQuantity: number | null;
  productTitle: string;
}

export async function searchProducts(
  admin: GraphqlClient,
  query: string
): Promise<VariantOption[]> {
  const response = await admin.graphql(
    `query($q: String!) {
      products(first: 8, query: $q) {
        edges {
          node {
            title
            variants(first: 15) {
              edges {
                node { id sku title inventoryQuantity }
              }
            }
          }
        }
      }
    }`,
    { variables: { q: query } }
  );
  const data = await response.json();
  const out: VariantOption[] = [];
  for (const edge of data?.data?.products?.edges ?? []) {
    const productTitle = edge?.node?.title ?? "";
    for (const v of edge?.node?.variants?.edges ?? []) {
      out.push({
        id: v?.node?.id ?? "",
        sku: v?.node?.sku ?? null,
        title: v?.node?.title ?? "",
        inventoryQuantity: v?.node?.inventoryQuantity ?? null,
        productTitle,
      });
    }
  }
  return out.filter((v) => v.id);
}
