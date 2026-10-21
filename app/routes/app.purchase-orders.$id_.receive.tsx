import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page, Card, Text, Button, InlineStack, BlockStack, Banner,
  DataTable, TextField, Modal,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { getDb, getEnv, getPurchaseOrder } from "../db.server";
import { getShopify } from "../shopify.server";
import { ScannerModal } from "../components/ScannerModal";
import {
  getInventoryItemIds,
  writebackReceipt,
} from "../lib/inventory.server";
import { POStatus, deriveReceivingStatus, lineDiff } from "../lib/po-state";
import { interpolate, useT } from "../components/i18n";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const po = await getPurchaseOrder(db, session.shop, params.id!);
  if (!po) throw new Response("Not found", { status: 404 });
  return json({ po });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session, admin } = await shopify.authenticate.admin(request);
  const poId = params.id!;
  const ts = new Date().toISOString();

  const po = await getPurchaseOrder(db, session.shop, poId);
  if (!po) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Add an unknown-SKU line to the PO (PRD §6.5).
  if (intent === "add-line") {
    // Only an open receipt can gain lines; the UI hides this on draft/received/
    // cancelled, but guard the endpoint too so a crafted post can't mutate them.
    if (!([POStatus.Sent, POStatus.Partial] as POStatus[]).includes(po.status as POStatus)) {
      return json({ error: `Cannot add a line to a ${po.status} PO`, writebackFailed: 0 }, { status: 400 });
    }
    const sku = String(form.get("sku") ?? "").trim();
    const qty = Math.max(1, Math.floor(Number(form.get("qty") ?? 1)));
    if (!sku) return json({ error: "SKU required" }, { status: 400 });
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID() : `${Date.now()}`;
    await db
      .prepare(
        `INSERT INTO po_line_items (id, po_id, sku, qty, qty_received, qty_written_back, writeback_status)
         VALUES (?, ?, ?, ?, ?, 0, 'pending')`
      )
      .bind(id, poId, sku, qty, qty)
      .run();
    return json({ ok: true, addedLineId: id, writebackFailed: 0 });
  }

  // Retry failed writebacks (PRD §6.5): only the not-yet-written portion,
  // so retries never double-count inventory.
  if (intent === "retry-writeback") {
    const lineIds = JSON.parse(String(form.get("lineIds") ?? "[]")) as string[];
    const targets = po.lines.filter(
      (l) => lineIds.includes(l.id) && l.qty_received > l.qty_written_back
    );
    if (targets.length === 0) return json({ ok: true, writebackFailed: 0 });

    const variantIds = targets.map((l) => l.variant_id).filter(Boolean) as string[];
    const itemIds = await getInventoryItemIds(admin as any, variantIds);
    await writebackReceipt(
      admin as any,
      db,
      targets.map((l) => ({
        lineId: l.id,
        inventoryItemId: l.variant_id ? (itemIds.get(l.variant_id) ?? "") : "",
        delta: l.qty_received - l.qty_written_back,
        // Same key formula as the receive path: a unique from->to transition,
        // so a replayed retry matches and different gaps never collide.
        idempotentKey: `${poId}:${l.id}:${l.qty_written_back}->${l.qty_received}`,
      }))
    );
    return json({ ok: true, writebackFailed: 0 });
  }

  // Confirm receipt: update received quantities, derive status, write back.
  if (intent === "receive") {
    if (!([POStatus.Sent, POStatus.Partial] as POStatus[]).includes(po.status as POStatus)) {
      return json({ error: `Cannot receive a ${po.status} PO` }, { status: 400 });
    }
    const received = JSON.parse(String(form.get("received") ?? "{}")) as Record<string, number>;

    // Write back the not-yet-applied portion of each line. The delta base is
    // qty_written_back (NOT the previous qty_received), so a receipt that
    // failed to write back earlier is picked up here instead of being skipped;
    // and the idempotent key encodes the exact from->to transition, so the
    // receive and retry paths use an identical key + delta base. Together these
    // keep the qty_written_back ledger from drifting against real inventory.
    const deltas: Array<{ lineId: string; variantId: string; from: number; to: number; delta: number }> = [];
    const stmts = [];
    for (const line of po.lines) {
      const next = Math.max(0, Math.floor(received[line.id] ?? line.qty_received));
      if (next !== line.qty_received) {
        stmts.push(
          db.prepare(`UPDATE po_line_items SET qty_received = ? WHERE id = ?`).bind(next, line.id)
        );
      }
      const delta = next - line.qty_written_back;
      if (delta > 0 && line.variant_id) {
        deltas.push({ lineId: line.id, variantId: line.variant_id, from: line.qty_written_back, to: next, delta });
      }
    }
    // D1 caps a batch at 100 statements — chunk so a large PO never crashes.
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }

    // Inventory writeback — failures recorded per line, never block the PO.
    if (deltas.length > 0) {
      const itemIds = await getInventoryItemIds(
        admin as any,
        deltas.map((d) => d.variantId)
      );
      await writebackReceipt(
        admin as any,
        db,
        deltas.map((d) => ({
          lineId: d.lineId,
          inventoryItemId: itemIds.get(d.variantId) ?? "",
          delta: d.delta,
          idempotentKey: `${poId}:${d.lineId}:${d.from}->${d.to}`,
        }))
      );
    }

    // Derive new PO status from updated quantities.
    const updated = await getPurchaseOrder(db, session.shop, poId);
    const derived = deriveReceivingStatus(
      (updated?.lines ?? []).map((l) => ({ qty: l.qty, qty_received: l.qty_received }))
    );
    if (derived) {
      await db
        .prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(derived, ts, poId)
        .run();
    }
    await db.prepare(`UPDATE purchase_orders SET updated_at = ? WHERE id = ?`).bind(ts, poId).run();

    const failed = (updated?.lines ?? []).filter((l) => l.writeback_status === "failed").length;
    return json({ ok: true, writebackFailed: failed });
  }

  return json({ error: "Unknown intent", writebackFailed: 0 }, { status: 400 });
}

export default function Receive() {
  const t = useT();
  const { po } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state === "submitting";

  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(po.lines.map((l) => [l.id, String(l.qty_received)]))
  );
  // When po.lines revalidate (e.g., after add-line), fill in new line IDs that
  // aren't in our local state yet (useState only runs on mount).
  useEffect(() => {
    setReceived((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const l of po.lines) {
        if (!(l.id in next)) { next[l.id] = String(l.qty_received); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [po.lines]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [unknownSku, setUnknownSku] = useState<string | null>(null);

  const onScan = (code: string) => {
    // Match by SKU (case-insensitive) or variant barcode.
    const line = po.lines.find(
      (l) => l.sku.toLowerCase() === code.toLowerCase()
    );
    if (line) {
      setReceived((r) => ({ ...r, [line.id]: String((parseInt(r[line.id] ?? "0", 10) || 0) + 1) }));
    } else {
      setUnknownSku(code); // PRD §6.5: unknown SKU → add-to-PO / ignore
    }
  };

  const confirmReceipt = () => {
    const form = new FormData();
    form.set("intent", "receive");
    form.set(
      "received",
      JSON.stringify(
        Object.fromEntries(Object.entries(received).map(([k, v]) => [k, parseInt(v, 10) || 0]))
      )
    );
    submit(form, { method: "post" });
  };

  const retryFailed = () => {
    const failed = po.lines.filter((l) => l.writeback_status === "failed").map((l) => l.id);
    const form = new FormData();
    form.set("intent", "retry-writeback");
    form.set("lineIds", JSON.stringify(failed));
    submit(form, { method: "post" });
  };

  const rows = po.lines.map((l) => {
    const diff = lineDiff({ qty: l.qty, qty_received: parseInt(received[l.id] ?? "0", 10) || 0 });
    return [
      l.sku,
      interpolate(t("receive.ordered"), { n: l.qty }),
      <TextField
        key={l.id}
        label="" labelHidden
        type="number"
        value={received[l.id] ?? "0"}
        onChange={(v) => setReceived((r) => ({ ...r, [l.id]: v }))}
        autoComplete="off"
      />,
      diff !== 0 ? (
        <Text as="span" tone={diff > 0 ? "critical" : undefined}>
          {diff > 0 ? `+${diff} over` : `${diff} short`}
        </Text>
      ) : (
        "—"
      ),
      l.writeback_status === "failed" ? (
        <Text as="span" tone="critical">{t("receive.wbFailed")}</Text>
      ) : l.writeback_status === "success" ? (
        "✓"
      ) : (
        t("receive.wbPending")
      ),
    ];
  });

  const failedCount = po.lines.filter((l) => l.writeback_status === "failed").length;

  return (
    <Page
      title={`${t("receive.title")} — ${po.po_number}`}
      backAction={{ content: t("common.back"), url: `/app/purchase-orders/${po.id}` }}
      primaryAction={
        <Button variant="primary" onClick={() => setScannerOpen(true)}>
          {t("receive.scanBtn")}
        </Button>
      }
    >
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">{String(actionData.error)}</Banner>
        )}
        {failedCount > 0 && (
          <Banner tone="warning">
            {t("receive.writebackFailed")}{" "}
            <Button variant="plain" onClick={retryFailed}>{t("po.retryWriteback")}</Button>
          </Banner>
        )}

        <Card>
          <DataTable
            columnContentTypes={["text", "text", "numeric", "text", "text"]}
            headings={[t("po.sku"), t("po.qty"), t("po.received"), t("receive.colDiff"), t("receive.colSync")]}
            rows={rows}
          />
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" loading={busy} onClick={confirmReceipt}>
              {t("receive.confirm")}
            </Button>
          </div>
        </Card>
      </BlockStack>

      <ScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={onScan}
      />

      <Modal
        open={unknownSku !== null}
        onClose={() => setUnknownSku(null)}
        title={t("receive.unknownSku")}
        primaryAction={{
          content: t("receive.addToPO"),
          onAction: () => {
            const form = new FormData();
            form.set("intent", "add-line");
            form.set("sku", unknownSku ?? "");
            form.set("qty", "1");
            submit(form, { method: "post" });
            setUnknownSku(null);
            setScannerOpen(false);
          },
        }}
        secondaryActions={[{ content: t("receive.ignore"), onAction: () => setUnknownSku(null) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Barcode: <strong>{unknownSku}</strong>
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
