import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page, Card, ResourceList, ResourceItem, Text, Badge, Button, Tabs,
} from "@shopify/polaris";
import { getDb, getEnv, listPurchaseOrders } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";
import { POStatus } from "../lib/po-state";

const TABS = ["all", POStatus.Draft, POStatus.Sent, POStatus.Partial, POStatus.Received, POStatus.Cancelled] as const;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const pos = await listPurchaseOrders(
    db, session.shop,
    status && status !== "all" ? status : undefined
  );
  return json({ pos, status: status ?? "all" });
}

export default function PurchaseOrders() {
  const t = useT();
  const { pos, status } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tabs = TABS.map((s) => ({
    id: s,
    content: s === "all" ? "All" : t(`po.status.${s}` as any),
    isActive: status === s,
    onClick: () => setSearchParams(s === "all" ? {} : { status: s }),
  }));

  return (
    <Page
      title={t("nav.purchaseOrders")}
      primaryAction={
        <Button variant="primary" onClick={() => navigate("/app/purchase-orders/new")}>
          {t("po.new")}
        </Button>
      }
    >
      <Card padding="0">
        <Tabs tabs={tabs.map(({ onClick, ...rest }) => rest)} selected={TABS.indexOf(status as any)} onSelect={(i) => tabs[i].onClick()} />
        <ResourceList
          resourceName={{ singular: "purchase order", plural: "purchase orders" }}
          items={pos}
          renderItem={(po) => (
            <ResourceItem
              id={po.id}
              url={`/app/purchase-orders/${po.id}`}
              accessibilityLabel={po.po_number}
            >
              <Text as="span" fontWeight="semibold">{po.po_number}</Text>{" "}
              <Badge>{t(`po.status.${po.status}` as any)}</Badge>
              {po.supplier_name && (
                <Text as="span" variant="bodySm" tone="subdued"> · {po.supplier_name}</Text>
              )}
              <Text as="span" variant="bodySm" tone="subdued"> · {po.line_count} lines</Text>
            </ResourceItem>
          )}
        />
      </Card>
    </Page>
  );
}
