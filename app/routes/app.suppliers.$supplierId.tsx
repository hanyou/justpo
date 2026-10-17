import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Page, Card, FormLayout, TextField, Button } from "@shopify/polaris";
import { useState } from "react";
import { getDb, getEnv } from "../db.server";
import type { Supplier } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const { supplierId } = params;
  if (!supplierId || supplierId === "new") return json({ supplier: null });
  const supplier = await db
    .prepare(`SELECT * FROM suppliers WHERE id = ? AND shop_id = ?`)
    .bind(supplierId, session.shop)
    .first<Supplier>();
  if (!supplier) throw new Response("Not found", { status: 404 });
  return json({ supplier });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const form = await request.formData();
  const data = {
    name: String(form.get("name") ?? "").trim(),
    contact: String(form.get("contact") ?? "").trim() || null,
    email: String(form.get("email") ?? "").trim() || null,
    currency: String(form.get("currency") ?? "USD").trim() || "USD",
    payment_terms: String(form.get("payment_terms") ?? "").trim() || null,
    notes: String(form.get("notes") ?? "").trim() || null,
  };
  if (!data.name) return json({ error: "Name is required" }, { status: 400 });

  const ts = new Date().toISOString();
  const { supplierId } = params;
  if (supplierId && supplierId !== "new") {
    await db
      .prepare(
        `UPDATE suppliers SET name = ?, contact = ?, email = ?, currency = ?,
         payment_terms = ?, notes = ?, updated_at = ?
         WHERE id = ? AND shop_id = ?`
      )
      .bind(
        data.name, data.contact, data.email, data.currency,
        data.payment_terms, data.notes, ts, supplierId, session.shop
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO suppliers
           (id, shop_id, name, contact, email, currency, payment_terms, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        uid(), session.shop, data.name, data.contact, data.email, data.currency,
        data.payment_terms, data.notes, ts, ts
      )
      .run();
  }
  return redirect("/app/suppliers");
}

export default function SupplierForm() {
  const t = useT();
  const { supplier } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [name, setName] = useState(supplier?.name ?? "");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [currency, setCurrency] = useState(supplier?.currency ?? "USD");
  const [terms, setTerms] = useState(supplier?.payment_terms ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");

  return (
    <Page
      title={supplier ? supplier.name : t("suppliers.new")}
      backAction={{ content: t("common.back"), url: "/app/suppliers" }}
    >
      <Card>
        <Form method="post">
          <FormLayout>
            <TextField label={t("suppliers.name")} name="name" value={name} onChange={setName} autoComplete="off" requiredIndicator />
            <TextField label={t("suppliers.contact")} name="contact" value={contact} onChange={setContact} autoComplete="off" />
            <TextField label={t("suppliers.email")} name="email" type="email" value={email} onChange={setEmail} autoComplete="off" />
            <TextField label={t("suppliers.currency")} name="currency" value={currency} onChange={setCurrency} autoComplete="off" helpText="Recorded only — P0 uses the shop home currency, no conversion." />
            <TextField label={t("suppliers.terms")} name="payment_terms" value={terms} onChange={setTerms} autoComplete="off" />
            <TextField label={t("suppliers.notes")} name="notes" value={notes} onChange={setNotes} multiline={3} autoComplete="off" />
            <Button submit variant="primary" loading={busy}>
              {t("suppliers.save")}
            </Button>
          </FormLayout>
        </Form>
      </Card>
    </Page>
  );
}
