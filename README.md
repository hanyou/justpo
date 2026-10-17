# JustPO — 极简采购单 + 扫码收货 (Shopify 嵌入式 App)

Scaffold for the JustPO Shopify app, built per **PRD v1.1** (`~/workspace/goals/side-business-product-planning/files/stocky-replacement-prd.md`).
P0 only. Hard exclusions (not built, per PRD): AI/forecasting, multi-warehouse, free tier, COGS writeback.

**Stack:** Cloudflare Workers + D1 · Remix 2.17.5 + Vite 6 · `@shopify/shopify-app-remix` 6 ·
App Bridge 3 · Polaris 13 · Resend (email) · pdf-lib (PO PDF) · ZXing (camera scan)

## What was built

```
justpo/
├── worker.ts                  # Workers entry: fetch → Remix handler, scheduled → low-stock digest
├── wrangler.toml              # D1 binding (DB), nodejs_compat, hourly cron
├── env.d.ts                   # Env interface (bindings + vars)
├── migrations/0001_init.sql   # D1 schema: shops, sessions, suppliers, purchase_orders,
│                              #   po_line_items, po_counters, seed_users, low_stock_thresholds
├── app/
│   ├── entry.server.tsx       # Workers-safe SSR (renderToReadableStream); registers cf-worker adapter
│   ├── root.tsx               # App Bridge + Polaris AppProvider, <ui-nav-menu>, i18n provider
│   ├── shopify.server.ts      # getShopify(env): shopifyApp() for Workers (billing plans, scopes)
│   ├── db.server.ts           # D1 helpers: ensureShop, nextPoNumber (PO-0001…), PO CRUD, deleteShopData
│   ├── i18n.ts                # en / zh dictionaries + interpolate()
│   ├── lib/
│   │   ├── session-storage.ts # D1-backed SessionStorage (5-method interface, JSON via
│   │   │                     #   Session.toPropertyArray()/fromPropertyArray())
│   │   ├── po-state.ts        # Pure PO state machine (unit-testable, no I/O)
│   │   ├── billing.ts         # Plans, quota (Starter 30/mo), trial, upgrade/downgrade, seed lock
│   │   ├── email.ts           # Resend; logs clearly when RESEND_API_KEY is unset
│   │   ├── pdf.ts             # PO PDF via pdf-lib (Workers-safe, pure JS)
│   │   ├── inventory.ts       # Inventory writeback (primary location only, per-line status)
│   │   ├── low-stock.ts       # Threshold vs live inventoryQuantity check
│   │   ├── catalog.ts         # Product/variant search (GraphQL)
│   │   └── cron.ts            # Hourly job: 08:00 shop-local low-stock digest email
│   ├── components/
│   │   ├── ScannerModal.tsx   # Camera (ZXing, dynamic import) + keyboard-wedge input
│   │   ├── csv.ts             # Minimal CSV parser (import wizard)
│   │   └── i18n.tsx           # LocaleProvider + useT() hook
│   └── routes/
│       ├── _index.tsx → /app, auth.$.tsx (OAuth), app.tsx (auth + billing.require gate + nav)
│       ├── app._index.tsx     # Dashboard: quota, low-stock alerts, recent POs
│       ├── app.onboarding.tsx # 3-step empty state (supplier → 3 SKUs → test PO)
│       ├── app.suppliers(.tsx / .$supplierId.tsx)   # Supplier CRUD
│       ├── app.purchase-orders.tsx                   # PO list + status filter tabs
│       ├── app.purchase-orders.new.tsx               # New PO: supplier + product search + lines
│       ├── app.purchase-orders.$id.tsx               # Detail: send-email / mark-sent / cancel / adjust
│       ├── app.purchase-orders.$id.receive.tsx       # Receiving + scanner + writeback retry
│       ├── app.import.tsx     # Stocky CSV wizard: upload → map → preview 10 → import
│       ├── app.settings.tsx   # Low-stock thresholds + language (en/zh)
│       ├── app.billing.tsx    # Plan, quota, trial, upgrade/downgrade
│       ├── webhooks.app.uninstalled.tsx  # Deletes all shop data (HMAC-verified)
│       └── webhooks.tsx       # GDPR: customers/data_request, customers/redact, shop/redact
```

**P0 feature wiring (PRD):**
- **Billing (§4.1):** `billing.require()` in `app.tsx` — no free tier, every shop needs an active
  subscription. Starter $9/mo (30 POs/mo, counted app-side via `quota_counted` flag — sent+ only,
  drafts don't count, cancelled never refunds), Pro $19/mo unlimited. `trialDays: 14` on both.
  Upgrade = immediate, downgrade = end of cycle. Seed users (first 10) keep $9 on Pro.
- **PO state machine (§5):** `draft → sent → partial → received`, single direction + `cancelled`;
  manual adjustment on received POs. Pure functions in `lib/po-state.ts`.
- **Email (§6.4/§6.5):** one-click PO PDF email to supplier; failure keeps PO `sent` + red banner + retry.
- **Receiving (§6.2):** camera (ZXing) + bluetooth keyboard-wedge; unknown SKU → add-to-PO/ignore;
  per-line `writeback_status` + retry; `qty_written_back` prevents double-counting on retry.
  P0 writes to the **primary location only** (first active location).
- **Low stock (§6.3):** thresholds in settings; live alerts on dashboard; hourly cron emails a digest
  at 08:00 shop-local time.
- **Webhooks (§9):** HMAC-verified via `authenticate.webhook`; GDPR topics return 200;
  `app/uninstalled` purges all shop data.

## Manual steps for han (requires YOUR accounts — I can't do these)

### 0. Legal pages (privacy policy + terms) — content done, 4 placeholders left
The two legal pages are **already built as public routes in the app** (no auth):
- `https://<app-url>/privacy` — content from `goals/side-business-product-planning/files/justpo-privacy-policy.md`
- `https://<app-url>/terms` — content from `goals/side-business-product-planning/files/justpo-terms-of-service.md`

You only need to:
1. Fill the `[bracket]` placeholders in `app/routes/privacy.tsx` and `app/routes/terms.tsx`:
   `[YYYY-MM-DD]` effective date, `[DEVELOPER NAME]`/`[开发者名称]`, `[SUPPORT_EMAIL]`/`[支持邮箱]`,
   `[JURISDICTION]`/`[管辖地]` (terms only).
2. Redeploy, then paste the two URLs into **Partner Dashboard → App setup → Privacy policy URL / Terms of service URL**.
3. If data practices change later (e.g. new scope), update the policy page + the source .md together.

### 1. Shopify Partner Dashboard
1. https://partners.shopify.com → **Apps → Create app** → name it **JustPO**.
2. **App setup** → copy **Client ID** (= `SHOPIFY_API_KEY`) and **Client secret** (= `SHOPIFY_API_SECRET`).
3. **App URL:** `https://justpo.<your-subdomain>.workers.dev` (after first deploy; update here too).
   **Allowed redirection URLs:** add `https://justpo.<your-subdomain>.workers.dev/auth/callback`.
4. **API access → Scopes:** `read_products, read_inventory, write_inventory, read_locations`.
5. **Webhooks → Event subscriptions** (GDPR + lifecycle, all to your app URL):
   - `app/uninstalled` → `https://<app-url>/webhooks/app/uninstalled`
   - `customers/data_request`, `customers/redact`, `shop/redact` → `https://<app-url>/webhooks`
6. **Create a dev store** (Partners → Stores → Add store → Development store) and install the app
   there for testing.

### 2. Cloudflare
```bash
npx wrangler login
npx wrangler d1 create justpo-db        # copy the database_id into wrangler.toml
npx wrangler d1 execute justpo-db --file=./migrations/0001_init.sql
npx wrangler secret put SHOPIFY_API_SECRET
# optional (PO emails + low-stock digests):
npx wrangler secret put RESEND_API_KEY  # get one at https://resend.com
```
Edit `wrangler.toml`: set `SHOPIFY_APP_URL` to your workers.dev URL.

### 3. Local dev
```bash
cp .dev.vars.example .dev.vars   # fill in SHOPIFY_API_KEY / SHOPIFY_API_SECRET
npm install
npm run dev                      # Remix dev with Cloudflare proxy (D1 + env work locally)
```

### 4. Deploy
```bash
npm run build && npx wrangler deploy ./worker.ts
# or: npm run deploy
```

## Billing test notes
- `BILLING_TEST_MODE` defaults to **test** (no real charges). Set `BILLING_TEST_MODE=false`
  via `wrangler secret put` only when you're ready for real charges.
- The 14-day trial is a *billed* trial (`trialDays: 14`): Shopify collects payment method upfront.

## Known limitations / what I could NOT verify (no Shopify credentials)
- **OAuth handshake** with a real shop — code path is standard `shopify-app-remix`, but the
  redirect dance needs your dev store.
- **Billing test charge** — `billing.request`/`require`/`check` wiring is per v6 API, but the
  confirmation redirect + subscription lifecycle needs a real install.
- **Webhook HMAC** — uses `authenticate.webhook` (verifies HMAC); needs real webhook delivery.
- **Camera scanning** — ZXing integration is written defensively (dynamic import, try/catch);
  needs a real device. Keyboard-wedge path works anywhere.

## Version / API workarounds (for Qoder)
1. **`.server.ts` discipline:** the Remix Vite plugin hard-fails the build
   (`Server-only module referenced by client`) if a route *component* imports
   values from a `.server` module — only `loader`/`action` may. Shared
   constants needed on both sides (plan names) live in `app/lib/plans.ts`
   (no suffix). This check works correctly; do not work around it by renaming.
2. **`react-dom/server` must resolve to the BROWSER build** (`vite.config.ts`
   `ssr.resolve.conditions` includes `worker`). The node build of react-dom 18
   does NOT export `renderToReadableStream`, which `entry.server.tsx` needs —
   without the condition every SSR page 500s in the deployed worker (verified
   2026-10-17). Do not remove the condition or switch the entry to
   `renderToPipeableStream`.
3. **`ssr.noExternal` is production-build-only** (`vite.config.ts`). In
   `remix vite:dev`, bundling react's CJS entry through vite's module runner
   500s every page (`module is not defined`); dev leaves deps external so Node
   resolves them natively (with `externalConditions` incl. `worker`, so
   `react-dom/server` still lands on the browser build).
2. **No Cloudflare adapter in `shopify-app-remix` v6** (only `node`/`vercel`): we register
   `@shopify/shopify-api`'s `adapters/cf-worker` via side-effect import in
   `app/entry.server.tsx` (server-only, runs before any `shopifyApp()` call).
3. **No `process` in Workers:** only two `process.env` touches exist in the Shopify
   packages — the `node` adapter (not imported) and a short-circuited localhost check.
4. **Billing config shape (v6/v15):** plans use `{ trialDays, lineItems: [{ amount,
   currencyCode, interval: BillingInterval.Every30Days }] }`; `billing` is inherited
   from the base API config (not declared in the remix `AppConfigArg` d.ts).
5. **Pinned versions:** `@remix-run/*` 2.17.5 + `vite` 6 + `react` 18;
   `@cloudflare/workers-types` v4 (v5 conflicts with `@remix-run/cloudflare`
   peer); `wrangler` 3.x installed locally (needed by the dev proxy plugin).
6. **`@shopify/shopify-app-session-storage`** is NOT a direct dep (its v2 peer wants
   `@shopify/shopify-api` ^9/^10, we have v15). `D1SessionStorage` implements the
   5-method interface structurally — validated working with `shopifyApp()`.
7. **Worker entry:** `remix vite:build` emits a `ServerBuild`, not a fetch handler;
   `worker.ts` wraps it with `createRequestHandler` and injects Env as
   `context.cloudflare.env`. Wrangler bundles `worker.ts` (not `build/server` directly).

## Scripts
| script | what it does |
|---|---|
| `npm run dev` | Remix dev + Cloudflare proxy (local D1, `.dev.vars`) |
| `npm run build` | `remix vite:build` → `build/client` + `build/server` |
| `npm run deploy` | build + `wrangler deploy ./worker.ts` |
| `npm run preview` | build + `wrangler dev ./worker.ts` (workerd runtime) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | apply `migrations/0001_init.sql` to D1 |
