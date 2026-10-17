import { Form, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  Page, Card, Text, Button, BlockStack, InlineStack, Banner,
  TextField, ResourceList, ResourceItem, RadioButton,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { searchProducts } from "../lib/catalog.server";
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

  const q = new URL(request.url).searchParams.get("q");
  const search = q !== null ? await searchProducts(admin as any, q || "*") : null;

  return json({ thresholds, locale: (shop?.locale ?? "en") as Locale, search });
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
    const threshold = Math.max(0, Math.floor(Number(form.get("threshold") ?? 0)));
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
  const busy = nav.state === "submitting";

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
                <Button submit size="slim" loading={busy}>{t("common.save")}</Button>
              </InlineStack>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">{t("settings.lowStock")}</Text>
            <TextField
              label={t("common.search")}
              value={query}
              onChange={setQuery}
              autoComplete="off"
              placeholder="Search products…"
            />
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
                          <Button submit size="slim">{t("common.save")}</Button>
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
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd">
                      {th.sku ?? th.variant_id}{" "}
                      <Text as="span" tone="subdued">
                        · {t("settings.threshold")}: {th.threshold}
                      </Text>
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-threshold" />
                      <input type="hidden" name="variant_id" value={th.variant_id} />
                      <Button submit size="slim" tone="critical" variant="plain">✕</Button>
                    </Form>
                  </InlineStack>
                </ResourceItem>
              )}
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
