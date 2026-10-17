/**
 * Shopify app instance factory for Cloudflare Workers.
 *
 * IMPORTANT — Workers runtime wiring (the PRD §8 spike risk):
 * - We register `@shopify/shopify-api/adapters/cf-worker` (side-effect import)
 *   so the API library uses Workers-native fetch/crypto. We do NOT import
 *   `@shopify/shopify-app-remix/adapters/node` (it touches process.env).
 * - Env comes from the worker, not process.env, so the app is constructed
 *   per-request via getShopify(env). Construction is config-only (cheap);
 *   the D1SessionStorage is bound to the request's DB binding.
 *
 * NOTE on file naming: we use the standard `.server.ts` suffix. The Remix Vite
 * plugin enforces that route *components* never import values from `.server`
 * modules (only `loader`/`action` may). Shared constants needed by both sides
 * (e.g. plan names) live in `app/lib/plans.ts`.
 *
 * Billing (PRD §4.1): recurring subscriptions via Shopify Billing API.
 *   Starter $9/mo (30 POs/mo, app-side counted) · Pro $19/mo (unlimited) ·
 *   14-day billed trial on both plans · no free tier.
 */
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import type { Env } from "../env";
import { D1SessionStorage } from "./lib/session-storage.server";
import { PLAN_PRICES_USD, PRO_PLAN, STARTER_PLAN } from "./lib/plans";

export function getShopify(env: Env) {
  const scopes = env.SCOPES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const shopify = shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    apiVersion: ApiVersion.July26,
    scopes,
    appUrl: env.SHOPIFY_APP_URL,
    authPathPrefix: "/auth",
    sessionStorage: new D1SessionStorage({ db: env.DB }),
    distribution: AppDistribution.AppStore,
    billing: {
      [STARTER_PLAN]: {
        trialDays: 14,
        lineItems: [
          {
            amount: PLAN_PRICES_USD[STARTER_PLAN],
            currencyCode: "USD",
            interval: BillingInterval.Every30Days,
          },
        ],
      },
      [PRO_PLAN]: {
        trialDays: 14,
        lineItems: [
          {
            amount: PLAN_PRICES_USD[PRO_PLAN],
            currencyCode: "USD",
            interval: BillingInterval.Every30Days,
          },
        ],
      },
    },
  });

  return shopify;
}

export type ShopifyInstance = ReturnType<typeof getShopify>;
