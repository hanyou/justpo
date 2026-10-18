import { Form, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  Page, Card, FormLayout, TextField, Button, Select, Text,
  InlineStack, BlockStack, Banner, Modal, ChoiceList,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { createPurchaseOrder, ensureShop, getDb, getEnv } from "../db.server";
import type { Supplier } from "../db.server";
import { getShopify } from "../shopify.server";
import { searchProducts, listProducts } from "../lib/catalog.server";
import type { VariantOption } from "../lib/catalog.server";
import { canCreatePO } from "../lib/billing.server";
import { interpolate, useT } from "../components/i18n";

interface DraftLine {
  key: string;
  variant_id: string | null;
  sku: string;
  title: string;
  qty: string;
  cost: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);

  const { results: suppliers } = await db
    .prepare(`SELECT * FROM suppliers WHERE shop_id = ? ORDER BY name`)
    .bind(session.shop)
    .all<Supplier>();
  const shop = await ensureShop(db, session.shop);
  const allowed = await canCreatePO(db, shop);

  // Product search for the useFetcher (GET ?q=...). Empty query → skip the
  // Shopify call (a bare "*" is not a valid products query operator).
  const params = new URL(request.url).searchParams;
  const q = params.get("q");
  const search =
    q !== null ? (q.trim() ? await searchProducts(admin as any, q.trim()) : []) : null;

  // Browse picker (GET ?browse=1): first 50 products, fetched once per modal open.
  const products = params.get("browse") === "1" ? await listProducts(admin as any) : null;

  return json({ suppliers: suppliers ?? [], allowed, search, products });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const form = await request.formData();
  const rawLines = JSON.parse(String(form.get("lines") ?? "[]")) as Array<{
    variant_id?: string | null; sku: string; title?: string; qty: number; cost?: number | null;
  }>;
  const lines = rawLines.filter((l) => l.sku.trim() && l.qty > 0);
  if (lines.length === 0) {
    return json({ error: "Add at least one line item" }, { status: 400 });
  }

  const po = await createPurchaseOrder(db, session.shop, {
    supplier_id: String(form.get("supplier_id") ?? "") || null,
    lines: lines.map((l) => ({
      variant_id: l.variant_id ?? null,
      sku: l.sku.trim(),
      title: l.title ?? null,
      qty: Math.floor(l.qty),
      cost: l.cost ?? null,
    })),
  });
  return redirect(`/app/purchase-orders/${po.id}`);
}

export default function NewPO() {
  const t = useT();
  const { suppliers, allowed, search: initialSearch } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const searcher = useFetcher<typeof loader>();
  const browseFetcher = useFetcher<typeof loader>();

  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (query.trim().length >= 2) {
      const id = setTimeout(() => {
        searcher.submit({ q: query }, { method: "get" });
      }, 300);
      return () => clearTimeout(id);
    }
  }, [query]);

  const results: VariantOption[] = searcher.data?.search ?? initialSearch ?? [];

  // Browse modal: products are fetched once via ?browse=1; the filter box is
  // pure client-side matching over product title / variant title / SKU.
  const browseProducts: VariantOption[] = browseFetcher.data?.products ?? [];
  const isBrowsing = browseFetcher.state !== "idle" && browseFetcher.data?.products == null;
  const filteredProducts = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    if (!kw) return browseProducts;
    return browseProducts.filter((v) =>
      `${v.productTitle} ${v.title} ${v.sku ?? ""}`.toLowerCase().includes(kw)
    );
  }, [browseProducts, filter]);

  const openBrowse = () => {
    setBrowseOpen(true);
    if (!browseFetcher.data?.products) {
      browseFetcher.submit({ browse: "1" }, { method: "get" });
    }
  };
  const closeBrowse = () => setBrowseOpen(false);
  const addSelected = () => {
    const chosen = browseProducts.filter((v) => selectedIds.includes(v.id));
    if (chosen.length) {
      setLines((ls) => [
        ...ls,
        ...chosen.map((v) => ({
          key: `${v.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          variant_id: v.id,
          sku: v.sku ?? "",
          title: v.productTitle + (v.title !== "Default Title" ? ` — ${v.title}` : ""),
          qty: "1",
          cost: "",
        })),
      ]);
    }
    setSelectedIds([]);
    setFilter("");
    setBrowseOpen(false);
  };

  const addLine = (v: VariantOption) => {
    setLines((ls) => [
      ...ls,
      {
        key: `${v.id}-${Date.now()}`,
        variant_id: v.id,
        sku: v.sku ?? "",
        title: v.productTitle + (v.title !== "Default Title" ? ` — ${v.title}` : ""),
        qty: "1",
        cost: "",
      },
    ]);
    setQuery("");
  };

  const addManualLine = () =>
    setLines((ls) => [
      ...ls,
      { key: `manual-${Date.now()}`, variant_id: null, sku: "", title: "", qty: "1", cost: "" },
    ]);

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    const payload = lines.map((l) => ({
      variant_id: l.variant_id,
      sku: l.sku,
      title: l.title || null,
      qty: parseInt(l.qty, 10) || 0,
      cost: l.cost === "" ? null : parseFloat(l.cost),
    }));
    if (!payload.some((l) => l.sku.trim() && l.qty > 0)) {
      e.preventDefault();
      setError("Add at least one line item");
      return;
    }
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "lines";
    input.value = JSON.stringify(payload);
    e.currentTarget.appendChild(input);
  };

  return (
    <Page title={t("po.new")} backAction={{ content: t("common.back"), url: "/app/purchase-orders" }}>
      <BlockStack gap="400">
        {!allowed && (
          <Banner tone="warning">
            {interpolate(t("dashboard.quotaWarning"), { used: "", limit: "" })}
          </Banner>
        )}
        <Card>
          <Form method="post" onSubmit={submit}>
            <FormLayout>
              <Select
                label={t("po.supplier")}
                name="supplier_id"
                options={[
                  { label: "—", value: "" },
                  ...suppliers.map((s) => ({ label: s.name, value: s.id })),
                ]}
                value={supplierId}
                onChange={setSupplierId}
              />

              <Text as="h2" variant="headingMd">{t("po.lines")}</Text>
              {error && <Banner tone="critical">{error}</Banner>}

              <InlineStack gap="200" blockAlign="end">
                <div style={{ flex: 1 }}>
                  <TextField
                    label={t("common.search")}
                    value={query}
                    onChange={setQuery}
                    autoComplete="off"
                    placeholder="Search products…"
                  />
                </div>
                <Button onClick={openBrowse}>{t("po.browseProducts")}</Button>
              </InlineStack>
              {results.length > 0 && query.trim().length >= 2 && (
                <Card>
                  <BlockStack gap="200">
                    {results.slice(0, 8).map((v) => (
                      <InlineStack key={v.id} align="space-between" blockAlign="center">
                        <Text as="span" variant="bodyMd">
                          {v.productTitle}
                          {v.title !== "Default Title" ? ` — ${v.title}` : ""}{" "}
                          <Text as="span" tone="subdued">· {v.sku}</Text>
                        </Text>
                        <Button size="slim" onClick={() => addLine(v)}>{t("po.addLine")}</Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              {lines.map((l) => (
                <InlineStack key={l.key} gap="200" blockAlign="end">
                  <div style={{ flex: 2 }}>
                    <TextField label={t("po.sku")} value={l.sku} onChange={(v) => updateLine(l.key, { sku: v })} autoComplete="off" />
                  </div>
                  <div style={{ flex: 3 }}>
                    <TextField label="Title" value={l.title} onChange={(v) => updateLine(l.key, { title: v })} autoComplete="off" />
                  </div>
                  <div style={{ width: 90 }}>
                    <TextField label={t("po.qty")} type="number" value={l.qty} onChange={(v) => updateLine(l.key, { qty: v })} autoComplete="off" />
                  </div>
                  <div style={{ width: 110 }}>
                    <TextField label={t("po.cost")} type="number" value={l.cost} onChange={(v) => updateLine(l.key, { cost: v })} autoComplete="off" />
                  </div>
                  <Button tone="critical" variant="plain" onClick={() => removeLine(l.key)}>✕</Button>
                </InlineStack>
              ))}

              <InlineStack gap="200">
                <Button onClick={addManualLine}>{t("po.addLine")}</Button>
                <Button submit variant="primary" loading={nav.state === "submitting"}>
                  {t("common.save")}
                </Button>
              </InlineStack>
            </FormLayout>
          </Form>
        </Card>
        <Modal
          open={browseOpen}
          onClose={closeBrowse}
          title={t("po.browseProducts")}
          size="large"
          limitHeight
          loading={isBrowsing}
          primaryAction={{
            content: `${interpolate(t("po.selectedN"), { n: selectedIds.length })} · ${t("po.addSelected")}`,
            onAction: addSelected,
            disabled: selectedIds.length === 0,
          }}
          secondaryActions={[{ content: t("common.cancel"), onAction: closeBrowse }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <TextField
                label=""
                labelHidden
                value={filter}
                onChange={setFilter}
                autoComplete="off"
                placeholder={t("po.filterProducts")}
              />
              {filteredProducts.length === 0 && !isBrowsing ? (
                <Text as="span" tone="subdued">{t("po.noProducts")}</Text>
              ) : (
                <ChoiceList
                  title={t("po.browseProducts")}
                  titleHidden
                  allowMultiple
                  choices={filteredProducts.map((v) => ({
                    label: `${v.productTitle} — ${v.title} · ${v.sku ?? ""}`,
                    value: v.id,
                  }))}
                  selected={selectedIds}
                  onChange={(sel) => setSelectedIds(sel)}
                />
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
