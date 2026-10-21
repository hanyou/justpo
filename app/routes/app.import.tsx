import { useActionData, useNavigation, useSubmit } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page, Card, Text, Button, BlockStack, InlineStack, Banner, Select, DataTable, RadioButton,
} from "@shopify/polaris";
import { useState } from "react";
import { getDb, getEnv } from "../db.server";
import { getShopify } from "../shopify.server";
import { parseCSV, guessMapping } from "../components/csv";
import { interpolate, useT } from "../components/i18n";

/**
 * Stocky CSV import wizard — minimum viable (PRD P0):
 * 1. Upload a single CSV file (suppliers OR purchase orders).
 * 2. Manually map columns to JustPO fields (with header-name guesses).
 * 3. Preview the first 10 rows, then import.
 */

const SUPPLIER_FIELDS = [
  { key: "name", label: "Name", aliases: ["name", "supplier", "vendor"] },
  { key: "contact", label: "Contact", aliases: ["contact"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail"] },
  { key: "currency", label: "Currency", aliases: ["currency"] },
  { key: "payment_terms", label: "Payment terms", aliases: ["terms", "payment"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note"] },
];

const PO_FIELDS = [
  { key: "supplier_name", label: "Supplier name", aliases: ["supplier", "vendor", "name"] },
  { key: "sku", label: "SKU", aliases: ["sku", "barcode"] },
  { key: "qty", label: "Qty", aliases: ["qty", "quantity", "ordered"] },
  { key: "cost", label: "Unit cost", aliases: ["cost", "price"] },
];

// Downloadable CSV templates. Headers use the exact field keys so guessMapping
// auto-matches every column on re-upload. PO rows demo one supplier spanning
// multiple line items (→ merged into a single draft PO per supplier).
const SUPPLIER_TEMPLATE: string[][] = [
  ["name", "contact", "email", "currency", "payment_terms", "notes"],
  ["Acme Trading Co.", "John Li", "john@acme.example", "USD", "Net 30", "Main packaging supplier"],
  ["Shenzhen Bright Ltd.", "Wei Zhang", "wei@bright.example", "CNY", "Prepay 50%", "Ships in 7 days"],
];

const PO_TEMPLATE: string[][] = [
  ["supplier_name", "sku", "qty", "cost"],
  ["Acme Trading Co.", "SKU-1001", "50", "3.20"],
  ["Acme Trading Co.", "SKU-1002", "20", "5.10"],
  ["Shenzhen Bright Ltd.", "SKU-2001", "100", "1.85"],
];

// RFC-4180 quote only when the value contains a comma / quote / newline.
function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildTemplate(kind: "suppliers" | "purchase_orders"): string {
  const rows = kind === "suppliers" ? SUPPLIER_TEMPLATE : PO_TEMPLATE;
  // Leading UTF-8 BOM so Excel opens CJK without mojibake; CRLF line endings.
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const shopify = getShopify(env);
  await shopify.authenticate.admin(request);
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const payload = (await request.json()) as {
    type: "suppliers" | "purchase_orders";
    mapping: Record<string, number>;
    rows: string[][];
  };
  const ts = new Date().toISOString();
  const uid = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const cell = (row: string[], key: string) => {
    const idx = payload.mapping[key];
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };

  if (payload.type === "suppliers") {
    // Idempotent import: skip suppliers whose name already exists for this shop.
    const { results: existingRows } = await db
      .prepare(`SELECT name FROM suppliers WHERE shop_id = ?`)
      .bind(session.shop)
      .all<{ name: string }>();
    const existingNames = new Set((existingRows ?? []).map((r) => r.name.toLowerCase()));

    const stmts = [];
    let count = 0;
    let skipped = 0;
    for (const row of payload.rows) {
      const name = cell(row, "name");
      if (!name) continue;
      if (existingNames.has(name.toLowerCase())) { skipped++; continue; }
      existingNames.add(name.toLowerCase());
      stmts.push(
        db
          .prepare(
            `INSERT INTO suppliers
               (id, shop_id, name, contact, email, currency, payment_terms, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            uid(), session.shop, name,
            cell(row, "contact") || null,
            cell(row, "email") || null,
            cell(row, "currency") || "USD",
            cell(row, "payment_terms") || null,
            cell(row, "notes") || null,
            ts, ts
          )
      );
      count++;
    }
    // D1 batch limit is 100 — chunk it.
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
    return json({ ok: true, suppliers: count, skipped, pos: 0, poSkipped: 0 });
  }

  // purchase_orders: group rows by supplier name → one draft PO per supplier.
  const { nextPoNumber } = await import("../db.server");
  const groups = new Map<string, string[][]>();
  for (const row of payload.rows) {
    if (!cell(row, "sku")) continue;
    const key = cell(row, "supplier_name") || "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Idempotent PO import: build signatures of existing draft POs
  // (supplier_id + sorted SKU set). If same combo exists, skip.
  const { results: draftPoRows } = await db
    .prepare(`SELECT id, supplier_id FROM purchase_orders WHERE shop_id = ? AND status = 'draft'`)
    .bind(session.shop)
    .all<{ id: string; supplier_id: string | null }>();
  const draftSignatures = new Set<string>();
  for (const dp of draftPoRows ?? []) {
    const { results: skus } = await db
      .prepare(`SELECT sku FROM po_line_items WHERE po_id = ?`)
      .bind(dp.id)
      .all<{ sku: string }>();
    const sig = (skus ?? []).map((l) => l.sku).sort().join(",");
    draftSignatures.add(`${dp.supplier_id ?? "__none__"}|${sig}`);
  }

  let poCount = 0;
  let poSkipped = 0;
  for (const [supplierName, groupRows] of groups) {
    let supplierId: string | null = null;
    if (supplierName !== "__none__") {
      const s = await db
        .prepare(`SELECT id FROM suppliers WHERE shop_id = ? AND name = ?`)
        .bind(session.shop, supplierName)
        .first<{ id: string }>();
      supplierId = s?.id ?? null;
    }
    // Check signature: same supplier + same sorted SKU set = duplicate.
    const groupSkus = groupRows.map((r) => cell(r, "sku")).sort().join(",");
    const signature = `${supplierId ?? "__none__"}|${groupSkus}`;
    if (draftSignatures.has(signature)) { poSkipped++; continue; }
    draftSignatures.add(signature); // handle re-import within same CSV

    const poNumber = await nextPoNumber(db, session.shop);
    const poId = uid();
    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO purchase_orders
             (id, shop_id, po_number, supplier_id, status, quota_counted, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)`
        )
        .bind(poId, session.shop, poNumber, supplierId, ts, ts),
    ];
    for (const row of groupRows) {
      // CSV cost is free text ("3.20 USD" etc.); only bind a real number, else null.
      const costNum = Number(cell(row, "cost"));
      stmts.push(
        db
          .prepare(
            `INSERT INTO po_line_items
               (id, po_id, sku, qty, qty_received, qty_written_back, cost, writeback_status)
             VALUES (?, ?, ?, ?, 0, 0, ?, 'pending')`
          )
          .bind(
            uid(), poId, cell(row, "sku"),
            Math.max(1, Math.floor(Number(cell(row, "qty")) || 1)),
            cell(row, "cost") && Number.isFinite(costNum) ? costNum : null
          )
      );
    }
    // D1 batch limit is 100 — a supplier group with 100+ SKUs is common. stmts[0]
    // is the PO head, so the first chunk satisfies the line_items FK.
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
    poCount++;
  }
  return json({ ok: true, suppliers: 0, skipped: 0, pos: poCount, poSkipped });
}

type Step = "upload" | "map" | "preview" | "done";

export default function Import() {
  const t = useT();
  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();
  const busy = nav.state === "submitting";

  const [step, setStep] = useState<Step>("upload");
  const [type, setType] = useState<"suppliers" | "purchase_orders">("suppliers");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [fileError, setFileError] = useState<string | null>(null);

  const fields = type === "suppliers" ? SUPPLIER_FIELDS : PO_FIELDS;

  const downloadTemplate = () => {
    // Pure client-side: build CSV text → Blob → throwaway <a download>.
    const blob = new Blob([buildTemplate(type)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      type === "suppliers"
        ? "justpo-suppliers-template.csv"
        : "justpo-purchase-orders-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 2) {
      setFileError("CSV is empty or has no data rows");
      return;
    }
    const [head, ...data] = parsed;
    setHeaders(head);
    setRows(data);
    setMapping(guessMapping(head, fields));
    setStep("map");
  };

  const mappedRows = rows.map((row) =>
    Object.fromEntries(fields.map((f) => [f.key, mapping[f.key] === undefined ? "" : (row[mapping[f.key]] ?? "")]))
  );

  const doImport = () => {
    submit(
      { type, mapping, rows },
      { method: "post", encType: "application/json" }
    );
    setStep("done");
  };

  return (
    <Page title={t("import.title")} backAction={{ content: t("common.back"), url: "/app" }}>
      <BlockStack gap="400">
        {step === "upload" && (
          <Card>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">{t("import.step1")}</Text>
              {fileError && <Banner tone="critical">{fileError}</Banner>}
              <InlineStack gap="400" blockAlign="center" wrap>
                <BlockStack gap="200">
                  <RadioButton
                    label="Suppliers"
                    checked={type === "suppliers"}
                    id="type-suppliers"
                    name="type"
                    onChange={() => setType("suppliers")}
                  />
                  <RadioButton
                    label="Purchase orders"
                    checked={type === "purchase_orders"}
                    id="type-pos"
                    name="type"
                    onChange={() => setType("purchase_orders")}
                  />
                </BlockStack>
                <Button onClick={downloadTemplate}>{t("import.downloadTemplate")}</Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{t("import.templateHint")}</Text>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </BlockStack>
          </Card>
        )}

        {step === "map" && (
          <Card>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">{t("import.step2")}</Text>
              {fields.map((f) => (
                <Select
                  key={f.key}
                  label={f.label}
                  options={[
                    { label: "— ignore —", value: "" },
                    ...headers.map((h, i) => ({ label: h || `(column ${i + 1})`, value: String(i) })),
                  ]}
                  value={mapping[f.key] === undefined ? "" : String(mapping[f.key])}
                  onChange={(v) =>
                    setMapping((m) =>
                      v === "" ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== f.key)) : { ...m, [f.key]: parseInt(v, 10) }
                    )
                  }
                />
              ))}
              <Button variant="primary" onClick={() => setStep("preview")}>
                {t("import.preview")}
              </Button>
            </BlockStack>
          </Card>
        )}

        {step === "preview" && (
          <Card>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd">{t("import.step3")}</Text>
              <DataTable
                columnContentTypes={fields.map(() => "text")}
                headings={fields.map((f) => f.label)}
                rows={mappedRows.slice(0, 10).map((r) => fields.map((f) => r[f.key]))}
              />
              <Button variant="primary" loading={busy} onClick={doImport}>
                {`${t("import.doImport")} (${rows.length} rows)`}
              </Button>
            </BlockStack>
          </Card>
        )}

        {step === "done" && actionData && "ok" in actionData && (
          <Card>
            <Banner tone="success">
              {interpolate(t("import.done"), {
                suppliers: actionData.suppliers ?? 0,
                pos: actionData.pos ?? 0,
              })}
            </Banner>
            {(actionData.skipped ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text as="span" tone="subdued">{interpolate(t("import.skipped"), { n: actionData.skipped })}</Text>
              </div>
            )}
            {(actionData.poSkipped ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text as="span" tone="subdued">{interpolate(t("import.poSkipped"), { n: actionData.poSkipped })}</Text>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => { setStep("upload"); setHeaders([]); setRows([]); }}>
                {t("import.upload")}
              </Button>
            </div>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
