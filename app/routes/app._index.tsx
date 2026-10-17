import { useLoaderData, useNavigate, useRouteLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page,
  Layout,
  Card,
  Text,
  ProgressBar,
  Banner,
  ResourceList,
  ResourceItem,
  Badge,
  EmptyState,
  Button,
} from "@shopify/polaris";
import { getDb, getEnv, listPurchaseOrders } from "../db.server";
import { getShopify } from "../shopify.server";
import { checkLowStock } from "../lib/low-stock.server";
import { interpolate, useT } from "../components/i18n";
import type { loader as appLoader } from "./app";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);

  const recent = await listPurchaseOrders(db, session.shop);
  const alerts = await checkLowStock(admin as any, db, session.shop);

  return json({ recent: recent.slice(0, 5), alerts });
}

export default function Dashboard() {
  const t = useT();
  const { recent, alerts } = useLoaderData<typeof loader>();
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");
  const navigate = useNavigate();
  const billingState = appData?.billingState;

  const quotaUsed = billingState?.quotaUsed ?? 0;
  const quotaLimit = billingState?.quotaLimit ?? null;
  const quotaPct =
    quotaLimit === null ? 0 : Math.min(100, (quotaUsed / quotaLimit) * 100);

  return (
    <Page title={t("dashboard.title")}>
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              {t("dashboard.poThisCycle")}
            </Text>
            <div style={{ margin: "12px 0" }}>
              <ProgressBar progress={quotaPct} size="small" />
            </div>
            <Text as="p" variant="bodyMd">
              {quotaLimit === null
                ? `${quotaUsed} · ${t("dashboard.unlimited")}`
                : `${quotaUsed} / ${quotaLimit}`}
            </Text>
            {quotaLimit !== null && quotaUsed >= quotaLimit && (
              <div style={{ marginTop: 12 }}>
                <Banner tone="warning">
                  {interpolate(t("dashboard.quotaWarning"), {
                    used: quotaUsed,
                    limit: quotaLimit,
                  })}
                </Banner>
              </div>
            )}
          </Card>
        </Layout.Section>

        {alerts.length > 0 && (
          <Layout.Section>
            <Card>
              <Text as="h2" variant="headingMd">
                {t("dashboard.lowStock")} ({alerts.length})
              </Text>
              <ResourceList
                resourceName={{ singular: "variant", plural: "variants" }}
                items={alerts}
                renderItem={(a) => (
                  <ResourceItem id={a.variantId} onClick={() => {}}>
                    <Text as="span" fontWeight="semibold">
                      {a.title}
                    </Text>{" "}
                    <Badge tone="critical">
                      {`${a.onHand} / ${a.threshold}`}
                    </Badge>
                    {a.sku && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {" "}
                        · {a.sku}
                      </Text>
                    )}
                  </ResourceItem>
                )}
              />
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text as="h2" variant="headingMd">
                {t("dashboard.recentPOs")}
              </Text>
              <Button variant="plain" onClick={() => navigate("/app/purchase-orders")}>
                {t("dashboard.viewAll")}
              </Button>
            </div>
            {recent.length === 0 ? (
              <EmptyState
                heading={t("dashboard.getStarted")}
                action={{
                  content: t("po.new"),
                  onAction: () => navigate("/app/purchase-orders/new"),
                }}
                image=""
              >
                <p>{t("dashboard.noPOs")}</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "purchase order", plural: "purchase orders" }}
                items={recent}
                renderItem={(po) => (
                  <ResourceItem
                    id={po.id}
                    url={`/app/purchase-orders/${po.id}`}
                    accessibilityLabel={po.po_number}
                  >
                    <Text as="span" fontWeight="semibold">
                      {po.po_number}
                    </Text>{" "}
                    <Badge>{t(`po.status.${po.status}` as any)}</Badge>
                    {po.supplier_name && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {" "}
                        · {po.supplier_name}
                      </Text>
                    )}
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
