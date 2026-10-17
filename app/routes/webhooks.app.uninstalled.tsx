import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { deleteShopData, getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";

/**
 * APP_UNINSTALLED webhook (PRD §9).
 * HMAC-verified via authenticate.webhook, then all shop data is deleted.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);

  const { shop } = await shopify.authenticate.webhook(request);

  await deleteShopData(db, shop);
  console.log(`[justpo] app uninstalled — deleted all data for ${shop}`);

  return new Response(null, { status: 200 });
}
