/**
 * Billing helpers — Shopify Billing API (recurring) + app-side PO quota.
 *
 * PRD §4.1 rules implemented here:
 * - Starter $9/mo: 30 POs per 30-day billing cycle. Pro $19/mo: unlimited.
 * - 14-day billed trial (trialDays: 14 in shopify.ts plan config).
 * - App-side counting per shop + cycle: only sent+ statuses count
 *   (tracked by the quota_counted flag, set once at first send).
 * - Drafts don't count. Cancelled POs don't refund quota.
 * - Upgrade → immediate (APPLY_IMMEDIATELY). Downgrade → end of cycle
 *   (APPLY_ON_NEXT_BILLING_CYCLE).
 * - Seed users (PRD §10.5): first 10 shops keep a locked $9 price even on Pro,
 *   applied via per-request lineItems override at subscription creation.
 */
import { BillingInterval, BillingReplacementBehavior } from "@shopify/shopify-api";
import type { Env } from "../../env";
import { getShopify } from "../shopify.server";
import { PRO_PLAN, STARTER_PLAN } from "./plans";
import type { ShopRow } from "../db.server";

export const STARTER_QUOTA = 30;
export const TRIAL_DAYS = 14;
export const MAX_SEED_USERS = 10;

export interface BillingState {
  plan: string; // 'starter' | 'pro'
  isSeedUser: boolean;
  lockedPrice: number | null; // seed lock price (9) when isSeedUser
  quotaUsed: number;
  quotaLimit: number | null; // null = unlimited (Pro)
  cycleStart: string | null;
  trialEndsAt: string | null;
  inTrial: boolean;
}

export function cycleStartFor(shop: ShopRow): string {
  return shop.billing_period_start ?? shop.installed_at;
}

export async function isSeedUser(db: D1Database, shop: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT shop FROM seed_users WHERE shop = ?`)
    .bind(shop)
    .first();
  return !!row;
}

/** Grant the $9 seed lock to one of the first 10 shops (PRD §10.5). */
export async function grantSeedLock(db: D1Database, shop: string): Promise<boolean> {
  if (await isSeedUser(db, shop)) return true;
  const { count } = (await db
    .prepare(`SELECT COUNT(*) AS count FROM seed_users`)
    .first<{ count: number }>()) ?? { count: 0 };
  if (count >= MAX_SEED_USERS) return false;
  await db
    .prepare(`INSERT INTO seed_users (shop, locked_price, granted_at) VALUES (?, 9, ?)`)
    .bind(shop, new Date().toISOString())
    .run();
  return true;
}

export async function quotaUsed(
  db: D1Database,
  shopId: string,
  cycleStart: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders
       WHERE shop_id = ? AND quota_counted = 1 AND sent_at >= ?`
    )
    .bind(shopId, cycleStart)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getBillingState(
  db: D1Database,
  shop: ShopRow
): Promise<BillingState> {
  const seed = await isSeedUser(db, shop.id);
  const cycleStart = cycleStartFor(shop);
  const used = await quotaUsed(db, shop.id, cycleStart);
  const isPro = shop.plan === "pro";
  const trialEndsAt = shop.trial_ends_at;
  const inTrial = !!trialEndsAt && new Date(trialEndsAt) > new Date();
  return {
    plan: shop.plan,
    isSeedUser: seed,
    lockedPrice: seed ? 9 : null,
    quotaUsed: used,
    quotaLimit: isPro ? null : STARTER_QUOTA,
    cycleStart,
    trialEndsAt,
    inTrial,
  };
}

/** Can this shop create (send) another PO under its current plan? */
export async function canCreatePO(db: D1Database, shop: ShopRow): Promise<boolean> {
  const state = await getBillingState(db, shop);
  if (state.quotaLimit === null) return true; // Pro: unlimited
  return state.quotaUsed < state.quotaLimit;
}

/**
 * Change plan via Shopify Billing API.
 * - Upgrade to Pro: immediate.
 * - Downgrade to Starter: end of current cycle.
 * Seed users keep the locked $9 price via lineItems override.
 */
export async function changePlan(
  env: Env,
  db: D1Database,
  request: Request,
  shopDomain: string,
  targetPlan: typeof STARTER_PLAN | typeof PRO_PLAN
): Promise<never> {
  const shopify = getShopify(env);
  const { billing } = await shopify.authenticate.admin(request);
  const seed = await isSeedUser(db, shopDomain);

  // Test mode unless explicitly disabled (never charge real money by accident).
  const isTest = env.BILLING_TEST_MODE !== "false";

  // billing.request() throws a redirect to the Shopify confirmation page.
  await billing.request({
    plan: targetPlan,
    isTest,
    returnUrl: `${env.SHOPIFY_APP_URL}/app/billing?plan_changed=1`,
    replacementBehavior:
      targetPlan === PRO_PLAN
        ? BillingReplacementBehavior.ApplyImmediately
        : BillingReplacementBehavior.ApplyOnNextBillingCycle,
    // Seed lock (PRD §10.5): Pro at $9 for the first 10 shops.
    ...(seed && targetPlan === PRO_PLAN
      ? {
          lineItems: [
            {
              amount: 9,
              currencyCode: "USD",
              interval: BillingInterval.Every30Days,
            },
          ],
        }
      : {}),
  });

  // Unreachable — billing.request always throws a redirect.
  throw new Error("billing.request did not redirect");
}

/** Sync the local plan + cycle after Shopify confirms a subscription. */
export async function syncPlanFromShopify(
  env: Env,
  request: Request,
  shopDomain: string
): Promise<void> {
  const shopify = getShopify(env);
  const { billing } = await shopify.authenticate.admin(request);
  const { appSubscriptions } = await billing.check({
    plans: [STARTER_PLAN, PRO_PLAN],
  });
  const db = env.DB;
  const sub = (appSubscriptions ?? []).find((s) => s.status === "ACTIVE");
  if (!sub) return;
  const plan = sub.name === PRO_PLAN ? "pro" : "starter";
  await db
    .prepare(
      `UPDATE shops SET plan = ?, billing_period_start = ?, trial_ends_at = ?
       WHERE id = ?`
    )
    .bind(
      plan,
      periodStartFromEnd(sub.currentPeriodEnd),
      sub.trialDays > 0 ? trialEndFromCreated(sub.createdAt, sub.trialDays) : null,
      shopDomain
    )
    .run();
}

function periodStartFromEnd(currentPeriodEnd: string): string {
  const end = new Date(currentPeriodEnd);
  return new Date(end.getTime() - 30 * 24 * 3600 * 1000).toISOString();
}

function trialEndFromCreated(createdAt: string, trialDays: number): string {
  return new Date(
    new Date(createdAt).getTime() + trialDays * 24 * 3600 * 1000
  ).toISOString();
}
