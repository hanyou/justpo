/**
 * Cloudflare Workers environment bindings for JustPO.
 *
 * Secrets (SHOPIFY_API_SECRET, RESEND_API_KEY) are set via `wrangler secret put`
 * in production and via `.dev.vars` locally — never committed.
 */
export interface Env {
  /** Public: from Partner Dashboard > App setup */
  SHOPIFY_API_KEY: string;
  /** Secret: from Partner Dashboard > App setup (use `wrangler secret put`) */
  SHOPIFY_API_SECRET: string;
  /** Public: deployed worker URL, e.g. https://justpo.han.workers.dev */
  SHOPIFY_APP_URL: string;
  /** Comma-separated scopes, e.g. "read_products,read_inventory,write_inventory,read_locations" */
  SCOPES: string;

  /** D1 database binding (created via `wrangler d1 create justpo-db`) */
  DB: D1Database;

  /**
   * Workers Static Assets binding (see wrangler.toml [assets]). Used to fetch
   * the pre-subsetted CJK font at runtime for PO PDF generation. Typed loosely
   * to avoid depending on a specific workers-types Fetcher signature.
   */
  ASSETS: {
    fetch: (request: Request | URL | string, init?: RequestInit) => Promise<Response>;
  };

  /** Optional: Resend API key for PO emails (`wrangler secret put RESEND_API_KEY`) */
  RESEND_API_KEY?: string;
  /** Optional: verified sender, e.g. "JustPO <po@justpo.app>" */
  RESEND_FROM_EMAIL?: string;
  /**
   * Optional: set to "false" in production to create REAL Shopify charges.
   * Defaults to test mode so nobody is charged by accident.
   */
  BILLING_TEST_MODE?: string;
  /**
   * Optional: gate the hard subscription check in the /app loader.
   * The Shopify Billing API rejects apps that are not on public distribution,
   * so this stays OFF (default) during development. Set to "true" before launch
   * (once the app is publicly distributed) to enforce an active subscription.
   */
  BILLING_ENFORCED?: string;
}
