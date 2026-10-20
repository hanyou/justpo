import { Form, useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  Page, Card, Text, Button, BlockStack, InlineStack, Banner,
  TextField, ResourceList, ResourceItem, RadioButton, Modal, ChoiceList,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { searchProducts, listProducts } from "../lib/catalog.server";
import type { VariantOption } from "../lib/catalog.server";
import { loadThresholds } from "../lib/low-stock.server";
import type { Threshold } from "../lib/low-stock.server";
import { interpolate, useT } from "../components/i18n";
import type { Locale } from "../i18n";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);

  const thresholds = await loadThresholds(db, session.shop);
  const shop = await db
    .prepare(`SELECT locale FROM shops WHERE id = ?`)
    .bind(session.shop)
    .first<{ locale: string }>();

  const params = new URL(request.url).searchParams;
  const q = params.get("q");
  // Product search for the debounced box (GET ?q=...). A bare "*" is not a
  // valid products query operator → empty/blank query returns no results.
  const search =
    q !== null ? (q.trim() ? await searchProducts(admin as any, q.trim()) : []) : null;

  // Browse picker (GET ?browse=1): first 50 products, fetched once per modal open.
  const products = params.get("browse") === "1" ? await listProducts(admin as any) : null;

  return json({ thresholds, locale: (shop?.locale ?? "en") as Locale, search, products });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const uid = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (intent === "add-threshold") {
    const variantId = String(form.get("variant_id") ?? "");
    const sku = String(form.get("sku") ?? "") || null;
    // Empty/blank/garbage falls back to 0; otherwise integer >= 0 (matches the
    // batch path's Number.isFinite guard so NaN never reaches the NOT NULL column).
    const parsedThreshold = Number(form.get("threshold"));
    const threshold = Number.isFinite(parsedThreshold) ? Math.max(0, Math.floor(parsedThreshold)) : 0;
    if (!variantId) return json({ error: "variant required" }, { status: 400 });
    await db
      .prepare(
        `INSERT INTO low_stock_thresholds (id, shop_id, variant_id, sku, threshold)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(shop_id, variant_id) DO UPDATE SET threshold = excluded.threshold, sku = excluded.sku`
      )
      .bind(uid(), session.shop, variantId, sku, threshold)
      .run();
    return json({ ok: true });
  }

  if (intent === "add-thresholds") {
    // Batch add from the browse modal: threshold comes from the modal input;
    // sku is carried along so the list rows render readably.
    const variantIds = JSON.parse(String(form.get("variant_ids") ?? "[]")) as string[];
    const skus = JSON.parse(String(form.get("skus") ?? "{}")) as Record<string, string | null>;
    if (!Array.isArray(variantIds) || variantIds.length === 0) {
      return json({ error: "no variants" }, { status: 400 });
    }
    // Missing/blank/invalid falls back to 5; otherwise clamp like the single
    // add-threshold path (integer >= 0).
    const rawThreshold = form.get("threshold");
    const parsedThreshold = Number(rawThreshold);
    const threshold =
      rawThreshold == null || String(rawThreshold).trim() === "" || !Number.isFinite(parsedThreshold)
        ? 5
        : Math.max(0, Math.floor(parsedThreshold));
    const stmts = variantIds.map((variantId) =>
      db
        .prepare(
          `INSERT INTO low_stock_thresholds (id, shop_id, variant_id, sku, threshold)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(shop_id, variant_id) DO UPDATE SET threshold = excluded.threshold, sku = excluded.sku`
        )
        .bind(uid(), session.shop, variantId, skus[variantId] ?? null, threshold)
    );
    // D1 batch limit is 100 — chunk.
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
    return json({ ok: true, added: stmts.length });
  }

  if (intent === "delete-threshold") {
    const variantId = String(form.get("variant_id") ?? "");
    await db
      .prepare(`DELETE FROM low_stock_thresholds WHERE shop_id = ? AND variant_id = ?`)
      .bind(session.shop, variantId)
      .run();
    return json({ ok: true });
  }

  if (intent === "language") {
    const locale = String(form.get("locale") ?? "en") === "zh" ? "zh" : "en";
    await db.prepare(`UPDATE shops SET locale = ? WHERE id = ?`).bind(locale, session.shop).run();
    // Set the cookie and reload so the whole app picks up the locale.
    return redirect("/app/settings", {
      headers: { "Set-Cookie": `justpo_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax` },
    });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function Settings() {
  const t = useT();
  const { thresholds, locale } = useLoaderData<typeof loader>();
  const searcher = useFetcher<typeof loader>();
  const nav = useNavigation();
  // Each <Form method="post"> shares one navigation, so a plain `busy` flag would
  // light up every Save button. Scope the spinner to the intent (and variant row)
  // that is actually submitting, via nav.formData.
  const isSubmitting = (intent: string, variantId?: string) =>
    nav.state === "submitting" &&
    nav.formData?.get("intent") === intent &&
    (variantId === undefined || nav.formData?.get("variant_id") === variantId);

  const [query, setQuery] = useState("");
  const [thresholdInput, setThresholdInput] = useState<Record<string, string>>({});
  const [lang, setLang] = useState<Locale>(locale);

  useEffect(() => {
    if (query.trim().length >= 2) {
      const id = setTimeout(() => searcher.submit({ q: query }, { method: "get" }), 300);
      return () => clearTimeout(id);
    }
  }, [query]);

  const results: VariantOption[] = searcher.data?.search ?? [];
  const existing = new Set(thresholds.map((th) => th.variant_id));

  // Browse-products modal (reuses the new-PO picker pattern).
  const browseFetcher = useFetcher<typeof loader>();
  const submit = useSubmit();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchThreshold, setBatchThreshold] = useState("5");

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
    // Always start fresh: drop any selection/filter/threshold from a previous open.
    setSelectedIds([]);
    setFilter("");
    setBatchThreshold("5");
    setBrowseOpen(true);
    if (!browseFetcher.data?.products) {
      browseFetcher.submit({ browse: "1" }, { method: "get" });
    }
  };
  const closeBrowse = () => setBrowseOpen(false);
  const addSelected = () => {
    // Skip variants already tracked (they're disabled in the list too).
    const chosen = browseProducts.filter(
      (v) => selectedIds.includes(v.id) && !existing.has(v.id)
    );
    if (chosen.length) {
      const payload = new FormData();
      payload.set("intent", "add-thresholds");
      payload.set("variant_ids", JSON.stringify(chosen.map((v) => v.id)));
      payload.set("threshold", batchThreshold);
      payload.set(
        "skus",
        JSON.stringify(Object.fromEntries(chosen.map((v) => [v.id, v.sku ?? null])))
      );
      submit(payload, { method: "post" });
    }
    setSelectedIds([]);
    setFilter("");
    setBrowseOpen(false);
  };

  return (
    <Page title={t("settings.title")}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("settings.language")}</Text>
            <Form method="post">
              <input type="hidden" name="intent" value="language" />
              <InlineStack gap="400">
                <RadioButton label="English" id="lang-en" name="locale" value="en" checked={lang === "en"} onChange={() => setLang("en")} />
                <RadioButton label="简体中文" id="lang-zh" name="locale" value="zh" checked={lang === "zh"} onChange={() => setLang("zh")} />
                <Button submit size="slim" loading={isSubmitting("language")}>{t("common.save")}</Button>
              </InlineStack>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("settings.lowStock")}</Text>
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
              <BlockStack gap="200">
                {results.slice(0, 6).map((v) => (
                  <InlineStack key={v.id} align="space-between" blockAlign="center" gap="200">
                    <Text as="span" variant="bodyMd">
                      {v.productTitle}{" "}
                      <Text as="span" tone="subdued">· {v.sku} · on hand {v.inventoryQuantity ?? "?"}</Text>
                    </Text>
                    {existing.has(v.id) ? (
                      <Text as="span" tone="subdued">✓</Text>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="add-threshold" />
                        <input type="hidden" name="variant_id" value={v.id} />
                        <input type="hidden" name="sku" value={v.sku ?? ""} />
                        <InlineStack gap="100" blockAlign="center">
                          <div style={{ width: 90 }}>
                            <TextField
                              label="" labelHidden
                              type="number"
                              name="threshold"
                              value={thresholdInput[v.id] ?? "5"}
                              onChange={(val) => setThresholdInput((m) => ({ ...m, [v.id]: val }))}
                              autoComplete="off"
                            />
                          </div>
                          <Button submit size="slim" loading={isSubmitting("add-threshold", v.id)}>{t("common.save")}</Button>
                        </InlineStack>
                      </Form>
                    )}
                  </InlineStack>
                ))}
              </BlockStack>
            )}

            <ResourceList
              resourceName={{ singular: "threshold", plural: "thresholds" }}
              items={thresholds}
              renderItem={(th: Threshold) => (
                <ResourceItem id={th.variant_id} onClick={() => {}}>
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <Text as="span" variant="bodyMd">{th.sku ?? th.variant_id}</Text>
                    <InlineStack gap="100" blockAlign="center">
                      <Form method="post">
                        <input type="hidden" name="intent" value="add-threshold" />
                        <input type="hidden" name="variant_id" value={th.variant_id} />
                        <input type="hidden" name="sku" value={th.sku ?? ""} />
                        <InlineStack gap="100" blockAlign="center">
                          <div style={{ width: 90 }}>
                            <TextField
                              label="" labelHidden
                              type="number"
                              name="threshold"
                              min={0}
                              value={thresholdInput[th.variant_id] ?? String(th.threshold)}
                              onChange={(val) => setThresholdInput((m) => ({ ...m, [th.variant_id]: val }))}
                              autoComplete="off"
                            />
                          </div>
                          <Button submit size="slim" loading={isSubmitting("add-threshold", th.variant_id)}>{t("common.save")}</Button>
                        </InlineStack>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-threshold" />
                        <input type="hidden" name="variant_id" value={th.variant_id} />
                        <Button submit size="slim" tone="critical" variant="plain" loading={isSubmitting("delete-threshold", th.variant_id)}>✕</Button>
                      </Form>
                    </InlineStack>
                  </InlineStack>
                </ResourceItem>
              )}
            />
          </BlockStack>
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
            disabled: selectedIds.length === 0 || isSubmitting("add-thresholds"),
            loading: isSubmitting("add-thresholds"),
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
              <TextField
                label={t("settings.threshold")}
                type="number"
                min={0}
                value={batchThreshold}
                onChange={setBatchThreshold}
                autoComplete="off"
              />
              {filteredProducts.length === 0 && !isBrowsing ? (
                <Text as="span" tone="subdued">{t("po.noProducts")}</Text>
              ) : (
                <ChoiceList
                  title={t("po.browseProducts")}
                  titleHidden
                  allowMultiple
                  choices={filteredProducts.map((v) => {
                    const isExisting = existing.has(v.id);
                    return {
                      label:
                        [
                          v.productTitle +
                            (v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""),
                          v.sku,
                        ]
                          .filter(Boolean)
                          .join(" · ") + (isExisting ? " ✓" : ""),
                      value: v.id,
                      disabled: isExisting,
                    };
                  })}
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
