import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Page, Card, Text, Button, BlockStack, Banner, InlineStack } from "@shopify/polaris";
import { ensureShop, getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { PRO_PLAN, STARTER_PLAN } from "../lib/plans";
import { changePlan, getBillingState, syncPlanFromShopify } from "../lib/billing.server";
import { useT } from "../components/i18n";

/**
 * Billing page (PRD §4.1): current plan, quota, trial status, seed lock,
 * upgrade (immediate) / downgrade (end of cycle) via Shopify Billing API.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  // Returning from Shopify's billing confirmation → sync local plan state.
  const url = new URL(request.url);
  if (url.searchParams.get("plan_changed") === "1") {
    await syncPlanFromShopify(env, request, session.shop);
  }

  const shop = await ensureShop(db, session.shop);
  const state = await getBillingState(db, shop);
  return json({ state });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const form = await request.formData();
  const target = String(form.get("plan") ?? "");
  if (target !== STARTER_PLAN && target !== PRO_PLAN) {
    return json({ error: "Unknown plan" }, { status: 400 });
  }
  // changePlan() throws a redirect to Shopify's confirmation page.
  // returnUrl brings the merchant back here with ?plan_changed=1.
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);
  await changePlan(env, db, request, session.shop, target);
  return json({ error: "unreachable" }, { status: 500 });
}

export default function Billing() {
  const t = useT();
  const { state } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const isPro = state.plan === "pro";

  return (
    <Page title={t("billing.title")}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("billing.current")}</Text>
              <Text as="span" variant="headingMd">
                {isPro ? t("billing.pro") : t("billing.starter")}
              </Text>
            </InlineStack>
            {state.inTrial && (
              <Banner tone="info">
                {t("billing.trial")} — ends {state.trialEndsAt}
              </Banner>
            )}
            {state.isSeedUser && (
              <Banner tone="success">
                Seed user — price locked at ${state.lockedPrice}/mo.
              </Banner>
            )}
            <Text as="p" variant="bodyMd" tone="subdued">
              {state.quotaLimit === null
                ? `${t("dashboard.poThisCycle")}: ${state.quotaUsed} · ${t("dashboard.unlimited")}`
                : `${t("dashboard.poThisCycle")}: ${state.quotaUsed} / ${state.quotaLimit}`}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Form method="post">
              <input type="hidden" name="plan" value={isPro ? STARTER_PLAN : PRO_PLAN} />
              <Button submit variant="primary" loading={busy}>
                {isPro ? t("billing.downgrade") : t("billing.upgrade")}
              </Button>
            </Form>
            <Text as="p" variant="bodySm" tone="subdued">
              Upgrades apply immediately. Downgrades take effect at the end of the
              current billing cycle.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
