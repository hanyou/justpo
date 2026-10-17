import { Form, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  Page, Card, FormLayout, TextField, Button, Select, Text,
  InlineStack, BlockStack, Banner,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { createPurchaseOrder, ensureShop, getDb, getEnv } from "../db.server";
import type { Supplier } from "../db.server";
import { getShopify } from "../shopify.server";
import { searchProducts } from "../lib/catalog.server";
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

  // Product search for the useFetcher (GET ?q=...).
  const q = new URL(request.url).searchParams.get("q");
  const search = q !== null ? await searchProducts(admin as any, q || "*") : null;

  return json({ suppliers: suppliers ?? [], allowed, search });
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

  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length >= 2) {
      const id = setTimeout(() => {
        searcher.submit({ q: query }, { method: "get" });
      }, 300);
      return () => clearTimeout(id);
    }
  }, [query]);

  const results: VariantOption[] = searcher.data?.search ?? initialSearch ?? [];

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

              <TextField
                label={t("common.search")}
                value={query}
                onChange={setQuery}
                autoComplete="off"
                placeholder="Search products…"
              />
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
      </BlockStack>
    </Page>
  );
}
