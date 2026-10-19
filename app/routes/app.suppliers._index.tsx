import { useState } from "react";
import {
  Form, useLoaderData, useNavigation, useNavigate, useSearchParams,
} from "@remix-run/react";
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
  TextField,
  Box,
} from "@shopify/polaris";
import { getDb, getEnv, escapeLike } from "../db.server";
import type { Supplier } from "../db.server";
import { getShopify } from "../shopify.server";
import { useT } from "../components/i18n";

const PER_PAGE = 20;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const db = getDb(context);
  const shopify = getShopify(env);
  const { session } = await shopify.authenticate.admin(request);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const parsedPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  // shop_id isolation is mandatory; the name/contact/email LIKE filter is added
  // only when a search term is present. Same WHERE reused for count + list.
  let where = "WHERE shop_id = ?";
  const binds: string[] = [session.shop];
  if (q) {
    where +=
      " AND (name LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')";
    const like = `%${escapeLike(q)}%`;
    binds.push(like, like, like);
  }

  // Count first so a delete that empties the last page clamps to the new last page.
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM suppliers ${where}`)
    .bind(...binds)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(requestedPage, lastPage);
  const offset = (page - 1) * PER_PAGE;

  const { results } = await db
    .prepare(`SELECT * FROM suppliers ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .bind(...binds, PER_PAGE, offset)
    .all<Supplier>();

  return json({
    suppliers: results ?? [],
    total,
    q,
    page,
  });
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

  // Preserve the active search + page on redirect so the operator stays put
  // after deleting (the delete form POSTs to the current URL incl. query).
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const q = url.searchParams.get("q");
  const page = url.searchParams.get("page");
  if (q) params.set("q", q);
  if (page) params.set("page", page);
  const qs = params.toString();
  return redirect(`/app/suppliers${qs ? `?${qs}` : ""}`);
}

export default function Suppliers() {
  const t = useT();
  const { suppliers, total, q, page } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(q);
  const busy = nav.state !== "idle";

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasPrev = page > 1;
  const hasNext = page < lastPage;

  // Prev/next keep the current q; only the "page" param changes.
  function setPage(target: number) {
    const next = new URLSearchParams(searchParams);
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    setSearchParams(next);
  }

  return (
    <Page
      title={t("suppliers.title")}
      primaryAction={
        <Button variant="primary" onClick={() => navigate("/app/suppliers/new")}>
          {t("suppliers.new")}
        </Button>
      }
    >
      <Card padding="0">
        <Box padding="400">
          {/* GET form: submitting writes ?q= and re-runs the loader; dropping
              "page" resets the view to page 1. */}
          <Form method="get">
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label=""
                  labelHidden
                  name="q"
                  value={searchValue}
                  onChange={setSearchValue}
                  placeholder={t("po.searchSupplier")}
                  autoComplete="off"
                />
              </div>
              <Button submit variant="primary">{t("common.search")}</Button>
              {q ? (
                <Button variant="plain" onClick={() => navigate("/app/suppliers")}>
                  {t("common.clear")}
                </Button>
              ) : null}
            </InlineStack>
          </Form>
        </Box>
        {total === 0 && !q ? (
          <EmptyState heading={t("suppliers.new")} image="">
            <p>{t("suppliers.empty")}</p>
          </EmptyState>
        ) : (
          <>
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
            <Box padding="400">
              <InlineStack gap="200" blockAlign="center">
                <Button onClick={() => setPage(page - 1)} disabled={!hasPrev}>
                  {t("common.prevPage")}
                </Button>
                <Button onClick={() => setPage(page + 1)} disabled={!hasNext}>
                  {t("common.nextPage")}
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("common.pageInfo", { page, total })}
                </Text>
              </InlineStack>
            </Box>
          </>
        )}
      </Card>
    </Page>
  );
}
