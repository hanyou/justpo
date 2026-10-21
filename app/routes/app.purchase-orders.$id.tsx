import { Form, Link, useActionData, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Page, Card, Text, Badge, Button, InlineStack, BlockStack, Banner,
  DataTable, TextField, Modal,
} from "@shopify/polaris";
import { useState } from "react";
import { ensureShop, getDb, getEnv, getPurchaseOrder } from "../db.server";
import { getShopify } from "../shopify.server";
import { renderPOPdf } from "../lib/pdf.server";
import { sendPOEmail, escapeHtml } from "../lib/email.server";
import { canCreatePO, getBillingState } from "../lib/billing.server";
import { POStatus, canTransition, countsTowardQuota } from "../lib/po-state";
import { interpolate, useT } from "../components/i18n";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const po = await getPurchaseOrder(db, session.shop, params.id!);
  if (!po) throw new Response("Not found", { status: 404 });
  return json({ po, shop: session.shop });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);
  const poId = params.id!;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ts = new Date().toISOString();

  const po = await getPurchaseOrder(db, session.shop, poId);
  if (!po) throw new Response("Not found", { status: 404 });

  const transition = async (to: POStatus) => {
    if (!canTransition(po.status as POStatus, to)) {
      return json({ error: `Cannot transition ${po.status} → ${to}` }, { status: 400 });
    }
    // PRD §4.1: sending counts quota; guard Starter limits.
    if (!countsTowardQuota(po.status as POStatus) && countsTowardQuota(to)) {
      const shop = await ensureShop(db, session.shop);
      if (!(await canCreatePO(db, shop))) {
        const billing = await getBillingState(db, shop);
        return json({ error: "quota_exceeded", quotaUsed: billing.quotaUsed, quotaLimit: billing.quotaLimit }, { status: 402 });
      }
    }
    // Only a transition INTO a quota-counting status starts the clock and
    // consumes quota. Cancelling a never-sent draft must NOT set sent_at /
    // quota_counted (PRD §4.1: drafts don't count), while sent→cancelled keeps
    // the existing flag so a cancelled PO never refunds quota.
    const toCounting = countsTowardQuota(to);
    const setClause = toCounting
      ? "status = ?, sent_at = COALESCE(sent_at, ?), quota_counted = 1, updated_at = ?"
      : "status = ?, updated_at = ?";
    const binds: string[] = toCounting ? [to, ts, ts, poId] : [to, ts, poId];
    await db
      .prepare(`UPDATE purchase_orders SET ${setClause} WHERE id = ?`)
      .bind(...binds)
      .run();
    return json({ ok: true });
  };

  if (intent === "mark-sent") return transition(POStatus.Sent);

  if (intent === "cancel") return transition(POStatus.Cancelled);

  if (intent === "send-email") {
    if (!po.supplier?.email) {
      return json({ error: "supplier_no_email" }, { status: 400 });
    }
    // Move to Sent (quota-guarded) BEFORE emailing the supplier, so an
    // over-quota shop never gets the PO sent out (was: email first, then 402).
    if (po.status === (POStatus.Draft as string)) {
      const res = await transition(POStatus.Sent);
      if (res instanceof Response && res.status !== 200) return res;
    }
    const pdf = await renderPOPdf({
      poNumber: po.po_number,
      createdAt: po.created_at,
      shopDomain: session.shop,
      supplierName: po.supplier.name,
      supplierContact: po.supplier.contact,
      supplierEmail: po.supplier.email,
      paymentTerms: po.supplier.payment_terms,
      notes: po.supplier.notes,
      lines: po.lines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, cost: l.cost })),
      currency: po.supplier.currency,
    }, env);
    const email = await sendPOEmail(env, {
      to: po.supplier.email,
      subject: `Purchase order ${po.po_number} from ${session.shop}`,
      htmlBody: `<p>Hello ${escapeHtml(po.supplier.name)},</p><p>Please find purchase order <b>${escapeHtml(po.po_number)}</b> attached.</p>`,
      pdfBytes: pdf,
      pdfFilename: `${po.po_number}.pdf`,
    });
    // PRD §6.5: email failure does NOT roll back the sent status — the PO
    // stays sent (transition above already committed it), the user sees a red
    // warning + retry button.
    return json({ emailSent: email.sent, emailReason: email.reason });
  }

  if (intent === "adjust") {
    // Manual adjustment on received POs (PRD §5): correct received quantities.
    if (po.status !== (POStatus.Received as string)) {
      return json({ error: "Adjustments are only allowed on received POs" }, { status: 400 });
    }
    const adjustments = JSON.parse(String(form.get("adjustments") ?? "{}")) as Record<string, number>;
    const stmts = Object.entries(adjustments).map(([lineId, qtyReceived]) =>
      db
        .prepare(`UPDATE po_line_items SET qty_received = ? WHERE id = ? AND po_id = ?`)
        .bind(Math.max(0, Math.floor(qtyReceived)), lineId, poId)
    );
    // D1 caps a batch at 100 statements — chunk so a large PO never crashes.
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
    await db.prepare(`UPDATE purchase_orders SET updated_at = ? WHERE id = ?`).bind(ts, poId).run();
    return json({ ok: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function PODetail() {
  const t = useT();
  const { po } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const navigate = useNavigate();
  const busy = nav.state === "submitting";
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});

  const status = po.status as POStatus;
  const rows = po.lines.map((l) => [
    l.sku,
    l.title ?? "—",
    String(l.qty),
    String(l.qty_received),
    l.cost != null ? l.cost.toFixed(2) : "—",
    l.writeback_status === "success" ? "✓" : l.writeback_status === "failed" ? `✗ ${t("receive.wbFailed")}` : t("receive.wbPending"),
  ]);

  return (
    <Page
      title={po.po_number}
      backAction={{ content: t("common.back"), url: "/app/purchase-orders" }}
      primaryAction={
        // Draft POs must be marked sent first (the receive action rejects
        // drafts); showing 收货 on a draft was a dead-end (silent 400).
        status === POStatus.Sent || status === POStatus.Partial ? (
          <Button variant="primary" onClick={() => navigate(`/app/purchase-orders/${po.id}/receive`)}>
            {t("po.receive")}
          </Button>
        ) : undefined
      }
    >
      <BlockStack gap="400">
        {actionData && "emailSent" in actionData && actionData.emailSent && (
          <Banner tone="success">{t("po.emailSent")}</Banner>
        )}
        {actionData && "emailSent" in actionData && !actionData.emailSent && (
          <Banner tone="critical">
            {t("po.emailFailed")} ({actionData.emailReason})
          </Banner>
        )}
        {actionData && "error" in actionData && actionData.error === "quota_exceeded" && (
          <Banner tone="warning">
            {interpolate(t("dashboard.quotaWarning"), {
              used: String((actionData as Record<string, unknown>).quotaUsed ?? ""),
              limit: (actionData as Record<string, unknown>).quotaLimit == null ? "" : String((actionData as Record<string, unknown>).quotaLimit)
            })}{" "}
            <Link to="/app/billing">{t("nav.billing")}</Link>
          </Banner>
        )}
        {actionData && "error" in actionData && !["quota_exceeded"].includes(actionData.error as string) && (
          <Banner tone="critical">{String(actionData.error)}</Banner>
        )}

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Badge>{t(`po.status.${status}` as any)}</Badge>
              {po.supplier && <Text as="span" variant="bodyMd">{po.supplier.name}</Text>}
            </InlineStack>
            <InlineStack gap="200">
              {status === POStatus.Draft && (
                <Form method="post">
                  <input type="hidden" name="intent" value="mark-sent" />
                  <Button submit loading={busy}>{t("po.markSent")}</Button>
                </Form>
              )}
              {(status === POStatus.Draft || status === POStatus.Sent) && po.supplier?.email && (
                <Form method="post">
                  <input type="hidden" name="intent" value="send-email" />
                  <Button submit variant="primary" loading={busy}>{t("po.sendEmail")}</Button>
                </Form>
              )}
              {status === POStatus.Received && (
                <Button onClick={() => setAdjustOpen(true)}>{t("po.adjust")}</Button>
              )}
              {([POStatus.Draft, POStatus.Sent, POStatus.Partial] as POStatus[]).includes(status) && (
                <Form method="post">
                  <input type="hidden" name="intent" value="cancel" />
                  <Button submit tone="critical" loading={busy}>{t("po.cancel")}</Button>
                </Form>
              )}
            </InlineStack>
          </InlineStack>
        </Card>

        <Card>
          <Text as="h2" variant="headingMd">{t("po.lines")}</Text>
          <div style={{ marginTop: 12 }}>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
              headings={[t("po.sku"), t("po.colTitle"), t("po.qty"), t("po.received"), t("po.cost"), t("receive.colSync")]}
              rows={rows}
            />
          </div>
        </Card>
      </BlockStack>

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title={t("po.adjust")}
        primaryAction={{
          content: t("common.save"),
          onAction: () => {
            const form = document.createElement("form");
            form.method = "post";
            const intent = document.createElement("input");
            intent.name = "intent"; intent.value = "adjust";
            const adj = document.createElement("input");
            adj.name = "adjustments";
            adj.value = JSON.stringify(
              Object.fromEntries(
                Object.entries(adjustments).map(([k, v]) => [k, parseInt(v, 10) || 0])
              )
            );
            form.appendChild(intent);
            form.appendChild(adj);
            document.body.appendChild(form);
            form.submit();
          },
        }}
        secondaryActions={[{ content: t("common.cancel"), onAction: () => setAdjustOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            {po.lines.map((l) => (
              <TextField
                key={l.id}
                label={`${l.sku} (${interpolate(t("receive.ordered"), { n: l.qty })})`}
                type="number"
                value={adjustments[l.id] ?? String(l.qty_received)}
                onChange={(v) => setAdjustments((a) => ({ ...a, [l.id]: v }))}
                autoComplete="off"
              />
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
