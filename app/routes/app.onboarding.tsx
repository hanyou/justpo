import { useLoaderData, useNavigate } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Page, Layout, Card, Text, List, Button, Badge } from "@shopify/polaris";
import { getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";

/** Onboarding 3-step empty state (PRD §6.1). */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const suppliers = await db
    .prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE shop_id = ?`)
    .bind(session.shop)
    .first<{ n: number }>();
  const thresholds = await db
    .prepare(`SELECT COUNT(*) AS n FROM low_stock_thresholds WHERE shop_id = ?`)
    .bind(session.shop)
    .first<{ n: number }>();
  const pos = await db
    .prepare(`SELECT COUNT(*) AS n FROM purchase_orders WHERE shop_id = ?`)
    .bind(session.shop)
    .first<{ n: number }>();

  return json({
    step1Done: (suppliers?.n ?? 0) > 0,
    step2Done: (thresholds?.n ?? 0) >= 3,
    step3Done: (pos?.n ?? 0) > 0,
  });
}

export default function Onboarding() {
  const t = useT();
  const { step1Done, step2Done, step3Done } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const steps = [
    {
      done: step1Done,
      title: t("onboarding.step1"),
      cta: t("suppliers.new"),
      url: "/app/suppliers/new",
    },
    {
      done: step2Done,
      title: t("onboarding.step2"),
      cta: t("settings.lowStock"),
      url: "/app/settings",
    },
    {
      done: step3Done,
      title: t("onboarding.step3"),
      cta: t("po.new"),
      url: "/app/purchase-orders/new",
    },
  ];

  return (
    <Page title={t("dashboard.getStarted")}>
      <Layout>
        <Layout.Section>
          <Card>
            <List type="number">
              {steps.map((s, i) => (
                <List.Item key={i}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <Text as="span" variant="bodyMd">
                      {s.title}{" "}
                      {s.done && <Badge tone="success">✓</Badge>}
                    </Text>
                    {!s.done && (
                      <Button size="slim" onClick={() => navigate(s.url)}>
                        {s.cta}
                      </Button>
                    )}
                  </div>
                </List.Item>
              ))}
            </List>
            {step1Done && step2Done && step3Done && (
              <div style={{ marginTop: 16 }}>
                <Text as="p" variant="bodyMd">
                  {t("onboarding.done")}
                </Text>
              </div>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
