import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Frame, Navigation } from "@shopify/polaris";
import { HomeIcon, OrderIcon, PersonIcon, ImportIcon, SettingsIcon, ReceiptIcon } from "@shopify/polaris-icons";
import { ensureShop, getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { PRO_PLAN, STARTER_PLAN } from "../lib/plans";
import { getBillingState } from "../lib/billing.server";
import { LocaleProvider, useT } from "../components/i18n";
import type { Locale } from "../i18n";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);

  const { session, billing } = await shopify.authenticate.admin(request);

  // PRD §4.1 / §9: no free tier — every shop must hold an active subscription.
  // require() throws a redirect to the Shopify billing confirmation when the
  // shop has no active plan; the 14-day trial is part of the plan config.
  //
  // Gated by BILLING_ENFORCED: the Shopify Billing API rejects any app that is
  // not on public distribution ("Apps without a public distribution cannot use
  // the Billing API"), so this stays OFF during development and is turned ON
  // (BILLING_ENFORCED=true) once the app is distributed publicly before launch.
  if (env.BILLING_ENFORCED === "true") {
    // Test mode unless explicitly disabled (never charge real money by accident),
    // mirroring changePlan() in billing.server.ts — dev/demo shops can't be charged.
    const isTest = env.BILLING_TEST_MODE !== "false";
    await billing.require({
      plans: [STARTER_PLAN, PRO_PLAN],
      isTest,
      onFailure: async () =>
        billing.request({
          plan: STARTER_PLAN,
          isTest,
          returnUrl: `${env.SHOPIFY_APP_URL}/app`,
        }),
    });
  }

  const shop = await ensureShop(db, session.shop);
  const billingState = await getBillingState(db, shop);

  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)justpo_locale=(en|zh)/);
  const locale: Locale = (match?.[1] as Locale) ?? (shop.locale as Locale) ?? "en";

  return json({ shop: session.shop, billingState, locale });
}

function Nav() {
  const t = useT();
  return (
    <Navigation location="/">
      <Navigation.Section
        items={[
          { url: "/app", label: t("nav.dashboard"), icon: HomeIcon },
          { url: "/app/purchase-orders", label: t("nav.purchaseOrders"), icon: OrderIcon },
          { url: "/app/suppliers", label: t("nav.suppliers"), icon: PersonIcon },
          { url: "/app/import", label: t("nav.import"), icon: ImportIcon },
          { url: "/app/settings", label: t("nav.settings"), icon: SettingsIcon },
          { url: "/app/billing", label: t("nav.billing"), icon: ReceiptIcon },
        ]}
      />
    </Navigation>
  );
}

export default function AppLayout() {
  const { locale } = useLoaderData<typeof loader>();
  return (
    <LocaleProvider locale={locale}>
      <Frame navigation={<Nav />}>
        <Outlet />
      </Frame>
    </LocaleProvider>
  );
}
