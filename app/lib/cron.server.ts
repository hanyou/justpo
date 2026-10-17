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
import { sendEmail } from "./email.server";

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

export async function runLowStockDigest(env: Env): Promise<void> {
  const db = env.DB;
  const shopify = getShopify(env);
  const now = new Date();

  const { results: shops } = await db
    .prepare(`SELECT id, timezone FROM shops WHERE uninstalled_at IS NULL`)
    .all<{ id: string; timezone: string | null }>();

  for (const shop of shops ?? []) {
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

      // Only run at 08:00 shop-local time (PRD §6.3).
      if (localHour(tz, now) !== 8) continue;

      const alerts = await checkLowStock(admin as any, db, shop.id);
      if (alerts.length === 0) continue;
      if (!contact.email) {
        console.warn(`[justpo] no shop email for ${shop.id} — skipping digest`);
        continue;
      }

      const lines = alerts
        .map((a) => `<li>${a.title} — on hand ${a.onHand} (threshold ${a.threshold})</li>`)
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
}
