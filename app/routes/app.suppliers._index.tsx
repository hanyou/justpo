import { Form, useLoaderData, useNavigation, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import {
  Page,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Button,
  EmptyState,
  InlineStack,
} from "@shopify/polaris";
import { getDb, getEnv } from "../db.server";
import type { Supplier } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const { results } = await db
    .prepare(`SELECT * FROM suppliers WHERE shop_id = ? ORDER BY name`)
    .bind(session.shop)
    .all<Supplier>();
  return json({ suppliers: results ?? [] });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (form.get("intent") === "delete" && id) {
    await db
      .prepare(`DELETE FROM suppliers WHERE id = ? AND shop_id = ?`)
      .bind(id, session.shop)
      .run();
  }
  return redirect("/app/suppliers");
}

export default function Suppliers() {
  const t = useT();
  const { suppliers } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const navigate = useNavigate();
  const busy = nav.state !== "idle";

  return (
    <Page
      title={t("suppliers.title")}
      primaryAction={
        <Button variant="primary" onClick={() => navigate("/app/suppliers/new")}>
          {t("suppliers.new")}
        </Button>
      }
    >
      <Card>
        {suppliers.length === 0 ? (
          <EmptyState heading={t("suppliers.new")} image="">
            <p>{t("suppliers.empty")}</p>
          </EmptyState>
        ) : (
          <ResourceList
            resourceName={{ singular: "supplier", plural: "suppliers" }}
            items={suppliers}
            renderItem={(s) => (
              <ResourceItem
                id={s.id}
                url={`/app/suppliers/${s.id}`}
                accessibilityLabel={s.name}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <div>
                    <Text as="span" fontWeight="semibold">
                      {s.name}
                    </Text>
                    {s.email && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {" "}
                        · {s.email}
                      </Text>
                    )}
                  </div>
                  <Form method="post" onClick={(e) => e.stopPropagation()}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={s.id} />
                    <Button
                      submit
                      tone="critical"
                      size="slim"
                      disabled={busy}
                      variant="plain"
                    >
                      {t("suppliers.delete")}
                    </Button>
                  </Form>
                </InlineStack>
              </ResourceItem>
            )}
          />
        )}
      </Card>
    </Page>
  );
}
