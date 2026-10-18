import { useState } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page, Card, ResourceList, ResourceItem, Text, Badge, Button, Tabs,
  TextField, Box, Form, InlineStack,
} from "@shopify/polaris";
import { getDb, getEnv, listPurchaseOrders, countPurchaseOrders } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";
import { POStatus } from "../lib/po-state";

const TABS = ["all", POStatus.Draft, POStatus.Sent, POStatus.Partial, POStatus.Received, POStatus.Cancelled] as const;

const PER_PAGE = 20;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && statusParam !== "all" ? statusParam : undefined;
  const q = (url.searchParams.get("q") ?? "").trim();
  const parsedPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const offset = (page - 1) * PER_PAGE;

  const filters = { status, q: q || undefined };
  const [pos, total] = await Promise.all([
    listPurchaseOrders(db, session.shop, { ...filters, limit: PER_PAGE, offset }),
    countPurchaseOrders(db, session.shop, filters),
  ]);
  return json({ pos, total, status: statusParam ?? "all", q, page });
}

export default function PurchaseOrders() {
  const t = useT();
  const { pos, total, status, q, page } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState(q);

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasPrev = page > 1;
  const hasNext = page < lastPage;

  // Merge mutations into the current query string; when resetPage is true the
  // "page" param is dropped so the view falls back to page 1 (search/tab switch).
  function applyParams(mutations: Record<string, string | null>, resetPage = false) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(mutations)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setSearchParams(next);
  }

  const tabs = TABS.map((s) => ({
    id: s,
    content: s === "all" ? "All" : t(`po.status.${s}` as any),
    isActive: status === s,
    onClick: () => applyParams({ status: s === "all" ? null : s }, true),
  }));

  const submitSearch = () => applyParams({ q: searchValue.trim() || null }, true);
  const clearSearch = () => {
    setSearchValue("");
    applyParams({ q: null }, true);
  };

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
        <Box padding="400">
          <Form onSubmit={submitSearch}>
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label=""
                  labelHidden
                  value={searchValue}
                  placeholder={t("po.searchPO")}
                  onChange={setSearchValue}
                  autoComplete="off"
                />
              </div>
              <Button submit variant="primary">{t("common.search")}</Button>
              {q ? <Button variant="plain" onClick={clearSearch}>{t("common.cancel")}</Button> : null}
            </InlineStack>
          </Form>
        </Box>
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
        <Box padding="400">
          <InlineStack gap="200" blockAlign="center">
            <Button
              onClick={() => applyParams({ page: String(page - 1) })}
              disabled={!hasPrev}
            >
              {t("common.prevPage")}
            </Button>
            <Button
              onClick={() => applyParams({ page: String(page + 1) })}
              disabled={!hasNext}
            >
              {t("common.nextPage")}
            </Button>
            <Text as="span" variant="bodySm" tone="subdued">
              {t("common.pageInfo", { page, total })}
            </Text>
          </InlineStack>
        </Box>
      </Card>
    </Page>
  );
}
