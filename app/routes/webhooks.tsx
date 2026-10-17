import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { deleteShopData, getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";

/**
 * GDPR compliance webhooks (PRD §9). All HMAC-verified via
 * authenticate.webhook. Every topic returns 200.
 *
 * - customers/data_request: we store no customer PII, so there is nothing to
 *   return — acknowledge within Shopify's required window.
 * - customers/redact: delete any customer-linked data (none stored in P0).
 * - shop/redact: delete all shop data 48h after uninstall (immediate here;
 *   app/uninstalled already purges).
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);

  const { topic, shop, payload } = await shopify.authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // P0 stores no customer personal data — nothing to provide.
      console.log(`[justpo] GDPR data_request for shop ${shop}, customer ${(payload as any)?.customer?.id ?? "unknown"}: no data stored`);
      break;
    }
    case "CUSTOMERS_REDACT": {
      // P0 stores no customer personal data — nothing to redact.
      console.log(`[justpo] GDPR customers_redact for shop ${shop}, customer ${(payload as any)?.customer?.id ?? "unknown"}: no data stored`);
      break;
    }
    case "SHOP_REDACT": {
      await deleteShopData(db, shop);
      console.log(`[justpo] GDPR shop_redact — deleted all data for ${shop}`);
      break;
    }
    default: {
      console.log(`[justpo] unhandled webhook topic: ${topic}`);
      break;
    }
  }

  return new Response(null, { status: 200 });
}
