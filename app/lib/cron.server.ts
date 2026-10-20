/**
 * Hourly cron job (wrangler.toml [triggers]): low-stock digest emails.
 *
 * For every installed shop whose local time is 08:00, checks thresholds
 * against live inventory and emails a digest to the shop email (PRD §6.3).
 * Real implementation — no placeholders. Failures are logged, never thrown.
 */
import type { Env } from "../../env";
import { getShopify } from "../shopify.server";
import { checkLowStock, getShopContact } from "./low-stock.server";
import { sendEmail, escapeHtml } from "./email.server";

function localHour(ianaTimezone: string | null, now: Date): number | null {
  if (!ianaTimezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTimezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value;
    return hour === undefined ? null : parseInt(hour, 10) % 24;
  } catch {
    return null;
  }
}

/** Max Shopify-touching shops processed concurrently per cron run. */
const CONCURRENCY = 5;

interface ShopCandidate {
  id: string;
  timezone: string | null;
}

export async function runLowStockDigest(env: Env): Promise<void> {
  const db = env.DB;
  const shopify = getShopify(env);
  const now = new Date();

  // Prefilter in SQL so a shop that isn't due (or tracks nothing) costs ZERO
  // Shopify calls this hour — previously every installed shop paid a
  // `shop { email ianaTimezone }` GraphQL each hour just to learn its timezone.
  // Candidate set = not uninstalled AND has ≥1 threshold AND (local 08:00 now,
  // OR timezone still unknown so we can backfill it once on first sight).
  const candidates = await candidatesDueNow(db, now);
  if (candidates.length === 0) return;

  // Bounded-concurrency fan-out replaces the old serial loop: one shop's slow
  // API call or failure no longer blocks the rest.
  await mapLimit(candidates, CONCURRENCY, (shop) =>
    processShop(db, shopify, env, shop, now)
  );
}

/**
 * Timezones whose shop-local hour is 08:00 right now. Reuses localHour so the
 * 08:00 rule lives in exactly one place.
 */
async function listDueTimezones(db: D1Database, now: Date): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT timezone FROM shops
       WHERE uninstalled_at IS NULL AND timezone IS NOT NULL`
    )
    .all<{ timezone: string }>();
  return (results ?? [])
    .map((r) => r.timezone)
    .filter((tz) => localHour(tz, now) === 8);
}

/**
 * Shops to process this run. When `due` is empty we drop the IN clause entirely
 * (SQLite rejects `IN ()`) and keep only NULL-timezone shops (backfill pass).
 * A large `due` list is split so no single statement exceeds D1's bind-parameter
 * ceiling.
 */
async function candidatesDueNow(db: D1Database, now: Date): Promise<ShopCandidate[]> {
  const due = await listDueTimezones(db, now);
  const hasThresholds = `EXISTS (SELECT 1 FROM low_stock_thresholds t WHERE t.shop_id = shops.id)`;

  if (due.length === 0) {
    const { results } = await db
      .prepare(
        `SELECT id, timezone FROM shops
         WHERE uninstalled_at IS NULL AND timezone IS NULL AND ${hasThresholds}`
      )
      .all<ShopCandidate>();
    return results ?? [];
  }

  const CHUNK = 90; // keep bound params per statement well under D1's limit
  // Keyed by shop id: the `timezone IS NULL OR timezone IN (...)` predicate
  // repeats NULL-tz shops in every chunk, so a Map dedupes them.
  const byId = new Map<string, ShopCandidate>();
  for (let i = 0; i < due.length; i += CHUNK) {
    const chunk = due.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT id, timezone FROM shops
         WHERE uninstalled_at IS NULL
           AND (timezone IS NULL OR timezone IN (${placeholders}))
           AND ${hasThresholds}`
      )
      .bind(...chunk)
      .all<ShopCandidate>();
    for (const r of results ?? []) byId.set(r.id, r);
  }
  return [...byId.values()];
}

/** Per-shop digest — mirrors the previous inline loop body, behaviour unchanged. */
async function processShop(
  db: D1Database,
  shopify: ReturnType<typeof getShopify>,
  env: Env,
  shop: ShopCandidate,
  now: Date
): Promise<void> {
  try {
    const { admin } = await shopify.unauthenticated.admin(shop.id);

    // Lazily backfill timezone + keep it fresh.
    let tz = shop.timezone;
    const contact = await getShopContact(admin as any);
    if (contact.ianaTimezone && contact.ianaTimezone !== tz) {
      tz = contact.ianaTimezone;
      await db
        .prepare(`UPDATE shops SET timezone = ? WHERE id = ?`)
        .bind(tz, shop.id)
        .run();
    }

    // Only run at 08:00 shop-local time (PRD §6.3). Guards against a stale
    // timezone in the candidate list; a still-NULL tz (backfill pass) is
    // intentionally skipped this run and picked up once it's known.
    if (localHour(tz, now) !== 8) return;

    // Subscription gate: canceled / trial-expired shops that never uninstalled
    // must stop receiving digests. Runs only after the 08:00 filter, so non-due
    // shops pay zero extra API. Fail-closed: if the check itself errors we skip
    // rather than risk emailing a shop we can't confirm — a paying user missing
    // one day beats emailing a canceled one. (This version of shopify-app-remix
    // exposes `billing` only via `authenticate.admin(request)`, which a cron has
    // no Request for, so we read the live subscription status directly.)
    let hasActive: boolean;
    try {
      hasActive = await hasActiveSubscription(admin as any);
    } catch (e) {
      console.error(`[justpo] skip digest for ${shop.id}: subscription check failed:`, e);
      return;
    }
    if (!hasActive) {
      console.log(`[justpo] skip digest for ${shop.id}: no active subscription`);
      return;
    }

    const alerts = await checkLowStock(admin as any, db, shop.id);
    if (alerts.length === 0) return;
    if (!contact.email) {
      console.warn(`[justpo] no shop email for ${shop.id} — skipping digest`);
      return;
    }

    const lines = alerts
      .map((a) => `<li>${escapeHtml(a.title)} — on hand ${a.onHand} (threshold ${a.threshold})</li>`)
      .join("");
    await sendEmail(env, {
      to: contact.email,
      subject: `JustPO low-stock alert: ${alerts.length} variant${alerts.length > 1 ? "s" : ""}`,
      htmlBody: `<p>The following variants are at or below their low-stock thresholds:</p><ul>${lines}</ul>`,
    });
  } catch (e) {
    console.error(`[justpo] low-stock digest failed for ${shop.id}:`, e);
  }
}

/**
 * True if the shop currently has an ACTIVE app subscription. A running trial is
 * reported as ACTIVE, so trial shops keep receiving digests (PRD §4.1: the gate
 * is "is there an ACTIVE subscription", independent of the Starter PO quota).
 * Reads the live installation status — no local plan sync and no webhook needed.
 */
async function hasActiveSubscription(admin: {
  graphql: (query: string) => Promise<{ json: () => Promise<any> }>;
}): Promise<boolean> {
  const response = await admin.graphql(
    `query { currentAppInstallation { activeSubscriptions { status } } }`
  );
  const data = await response.json();
  const subs: Array<{ status?: string }> =
    data?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return subs.some((s) => s.status === "ACTIVE");
}

/**
 * Run `fn` over `items` with at most `limit` in flight. No dependency: a fixed
 * pool of index-consuming workers. `fn` is expected to settle (processShop never
 * throws), but we catch defensively so one rejection can't strand the pool.
 */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        await fn(items[idx]);
      } catch (e) {
        console.error("[justpo] low-stock mapLimit worker error:", e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
