import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getEnv } from "../db.server";
import { getShopify } from "../shopify.server";

/** OAuth entry/callback passthrough (PRD §9: real OAuth, no placeholders). */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const shopify = getShopify(env);
  return shopify.authenticate.admin(request);
}
