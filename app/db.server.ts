/**
 * D1 data-access helpers. All queries are scoped by shop_id (tenant isolation).
 *
 * Conventions:
 * - IDs: crypto.randomUUID()
 * - Timestamps: ISO strings (new Date().toISOString())
 * - Money: REAL, shop home currency (PRD §6.6)
 */
import type { Env } from "../env";

export interface Supplier {
  id: string;
  shop_id: string;
  name: string;
  contact: string | null;
  email: string | null;
  currency: string;
  payment_terms: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrder {
  id: string;
  shop_id: string;
  po_number: string;
  supplier_id: string | null;
  status: string;
  quota_counted: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface POLineItem {
  id: string;
  po_id: string;
  variant_id: string | null;
  sku: string;
  barcode: string | null;
  title: string | null;
  qty: number;
  qty_received: number;
  qty_written_back: number;
  cost: number | null;
  writeback_status: string;
}

export interface ShopRow {
  id: string;
  plan: string;
  billing_period_start: string | null;
  trial_ends_at: string | null;
  installed_at: string;
  uninstalled_at: string | null;
  timezone: string | null;
  locale: string;
}

export function getDb(context: any): D1Database {
  const env = context?.cloudflare?.env as Env | undefined;
  if (!env?.DB) {
    throw new Response("D1 binding DB is not configured", { status: 500 });
  }
  return env.DB;
}

export function getEnv(context: any): Env {
  const env = context?.cloudflare?.env as Env | undefined;
  if (!env?.SHOPIFY_API_KEY) {
    throw new Response("Worker env is not configured", { status: 500 });
  }
  return env;
}

const now = () => new Date().toISOString();
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Ensure a shops row exists (called on every authenticated app load). */
export async function ensureShop(
  db: D1Database,
  shopDomain: string
): Promise<ShopRow> {
  // Idempotent upsert: app.tsx and a child route can call ensureShop in
  // parallel on first install, and a plain SELECT-then-INSERT would race and
  // throw on the primary key. ON CONFLICT DO NOTHING makes it safe.
  await db
    .prepare(
      `INSERT INTO shops (id, plan, installed_at, locale) VALUES (?, 'starter', ?, 'en')
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(shopDomain, now())
    .run();
  return (await db
    .prepare(`SELECT * FROM shops WHERE id = ?`)
    .bind(shopDomain)
    .first<ShopRow>()) as ShopRow;
}

/** Atomically allocate the next PO number for a shop (PO-0001, PO-0002, …). */
export async function nextPoNumber(
  db: D1Database,
  shopId: string
): Promise<string> {
  // Single-statement compare-and-set: SQLite/D1 serializes writes, so two
  // concurrent POs can never read the same counter and collide on
  // UNIQUE(shop_id, po_number). `next_number` keeps the invariant "the number
  // to allocate NEXT"; RETURNING hands back the value we just consumed
  // (pre-increment), which also stays correct for rows seeded by the old code.
  const row = await db
    .prepare(
      `INSERT INTO po_counters (shop_id, next_number) VALUES (?, 2)
       ON CONFLICT(shop_id) DO UPDATE SET next_number = next_number + 1
       RETURNING next_number - 1 AS allocated`
    )
    .bind(shopId)
    .first<{ allocated: number }>();
  const next = row?.allocated ?? 1;
  return `PO-${String(next).padStart(4, "0")}`;
}

/** Create a draft PO with line items. Returns the PO row. */
export async function createPurchaseOrder(
  db: D1Database,
  shopId: string,
  input: {
    supplier_id?: string | null;
    lines: Array<{
      variant_id?: string | null;
      sku: string;
      barcode?: string | null;
      title?: string | null;
      qty: number;
      cost?: number | null;
    }>;
  }
): Promise<PurchaseOrder> {
  const poNumber = await nextPoNumber(db, shopId);
  const id = uid();
  const ts = now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO purchase_orders
           (id, shop_id, po_number, supplier_id, status, quota_counted, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)`
      )
      .bind(id, shopId, poNumber, input.supplier_id ?? null, ts, ts),
  ];
  for (const line of input.lines) {
    statements.push(
      db
        .prepare(
          `INSERT INTO po_line_items
             (id, po_id, variant_id, sku, barcode, title, qty, qty_received, qty_written_back, cost, writeback_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'pending')`
        )
        .bind(
          uid(),
          id,
          line.variant_id ?? null,
          line.sku,
          line.barcode ?? null,
          line.title ?? null,
          line.qty,
          line.cost ?? null
        )
    );
  }
  // D1 caps a batch at 100 statements — chunk so a PO with 100+ line items
  // doesn't throw (the head is statement[0], so FK is satisfied by the first
  // chunk).
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }
  return (await db
    .prepare(`SELECT * FROM purchase_orders WHERE id = ?`)
    .bind(id)
    .first<PurchaseOrder>()) as PurchaseOrder;
}

export async function getPurchaseOrder(
  db: D1Database,
  shopId: string,
  poId: string
): Promise<(PurchaseOrder & { lines: POLineItem[]; supplier: Supplier | null }) | null> {
  const po = await db
    .prepare(`SELECT * FROM purchase_orders WHERE id = ? AND shop_id = ?`)
    .bind(poId, shopId)
    .first<PurchaseOrder>();
  if (!po) return null;
  const { results: lines } = await db
    .prepare(`SELECT * FROM po_line_items WHERE po_id = ? ORDER BY rowid`)
    .bind(poId)
    .all<POLineItem>();
  const supplier = po.supplier_id
    ? await db
        .prepare(`SELECT * FROM suppliers WHERE id = ? AND shop_id = ?`)
        .bind(po.supplier_id, shopId)
        .first<Supplier>()
    : null;
  return { ...po, lines: lines ?? [], supplier };
}

export interface POListFilters {
  status?: string;
  q?: string;
}

/**
 * Escape LIKE wildcards so a user-typed % or _ matches literally instead of
 * acting as a wildcard. Pair with `... LIKE ? ESCAPE '\'` in the SQL.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Build the shared WHERE fragment (+ bound params) for list/count so both stay
 * in sync. Filters are AND-ed on top of the mandatory shop_id scoping done by
 * the caller. Search matches PO number OR supplier name (LIKE %q%).
 */
function buildPOFilters(filters: POListFilters): {
  clause: string;
  params: string[];
} {
  const parts: string[] = [];
  const params: string[] = [];
  if (filters.status) {
    parts.push("po.status = ?");
    params.push(filters.status);
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push("(po.po_number LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  return { clause: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

export async function listPurchaseOrders(
  db: D1Database,
  shopId: string,
  filters: POListFilters & { limit?: number; offset?: number } = {}
): Promise<Array<PurchaseOrder & { supplier_name: string | null; line_count: number }>> {
  const { clause, params } = buildPOFilters(filters);
  // limit omitted → return all rows (dashboard "recent" relies on this).
  let sql =
    `SELECT po.*, s.name AS supplier_name,
            (SELECT COUNT(*) FROM po_line_items li WHERE li.po_id = po.id) AS line_count
     FROM purchase_orders po
     LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.shop_id = ?${clause}
     ORDER BY po.created_at DESC`;
  const binds: Array<string | number> = [shopId, ...params];
  if (typeof filters.limit === "number") {
    sql += " LIMIT ? OFFSET ?";
    binds.push(filters.limit, filters.offset ?? 0);
  }
  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results ?? []) as unknown as Array<
    PurchaseOrder & { supplier_name: string | null; line_count: number }
  >;
}

/** Total rows matching the same filters — used for pagination. */
export async function countPurchaseOrders(
  db: D1Database,
  shopId: string,
  filters: POListFilters = {}
): Promise<number> {
  const { clause, params } = buildPOFilters(filters);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.shop_id = ?${clause}`
    )
    .bind(shopId, ...params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Delete all data for a shop (GDPR: app/uninstalled + shop/redact). */
export async function deleteShopData(db: D1Database, shopId: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE shop = ?`).bind(shopId),
    db.prepare(`DELETE FROM low_stock_thresholds WHERE shop_id = ?`).bind(shopId),
    db.prepare(`DELETE FROM seed_users WHERE shop = ?`).bind(shopId),
    db.prepare(`DELETE FROM po_counters WHERE shop_id = ?`).bind(shopId),
    // po_line_items cascade via purchase_orders delete
    db.prepare(`DELETE FROM purchase_orders WHERE shop_id = ?`).bind(shopId),
    db.prepare(`DELETE FROM suppliers WHERE shop_id = ?`).bind(shopId),
    db.prepare(`DELETE FROM shops WHERE id = ?`).bind(shopId),
  ]);
}
