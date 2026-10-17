/**
 * D1-backed Shopify SessionStorage.
 *
 * Implements the 5-method SessionStorage interface from
 * @shopify/shopify-app-session-storage (v2, as nested under
 * @shopify/shopify-app-remix@6):
 *   storeSession / loadSession / deleteSession / deleteSessions / findSessionsByShop
 *
 * Sessions are serialized with Session.toPropertyArray() /
 * Session.fromPropertyArray() so the stored shape tracks the installed
 * @shopify/shopify-api version (currently v15) instead of hand-rolled fields.
 */
import { Session } from "@shopify/shopify-api";

export interface D1SessionStorageOptions {
  db: D1Database;
}

export class D1SessionStorage {
  private db: D1Database;

  constructor(opts: D1SessionStorageOptions) {
    this.db = opts.db;
  }

  async storeSession(session: Session): Promise<boolean> {
    const payload = JSON.stringify(session.toPropertyArray());
    const expires = session.expires ? session.expires.toISOString() : null;
    await this.db
      .prepare(
        `INSERT INTO sessions (id, shop, is_online, expires, payload)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           shop = excluded.shop,
           is_online = excluded.is_online,
           expires = excluded.expires,
           payload = excluded.payload`
      )
      .bind(
        session.id,
        session.shop,
        session.isOnline ? 1 : 0,
        expires,
        payload
      )
      .run();
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.db
      .prepare(`SELECT payload FROM sessions WHERE id = ?`)
      .bind(id)
      .first<{ payload: string }>();
    if (!row) return undefined;
    try {
      const entries = JSON.parse(row.payload) as [string, string | number | boolean][];
      return Session.fromPropertyArray(entries);
    } catch {
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const placeholders = ids.map(() => "?").join(",");
    await this.db
      .prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const { results } = await this.db
      .prepare(`SELECT payload FROM sessions WHERE shop = ?`)
      .bind(shop)
      .all<{ payload: string }>();
    const sessions: Session[] = [];
    for (const row of results ?? []) {
      try {
        const entries = JSON.parse(row.payload) as [string, string | number | boolean][];
        sessions.push(Session.fromPropertyArray(entries));
      } catch {
        // Skip corrupt rows rather than failing the whole lookup.
      }
    }
    return sessions;
  }
}
