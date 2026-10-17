import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { getEnv } from "./db.server";
import { LocaleProvider, useLocale } from "./components/i18n";
import type { Locale } from "./i18n";

// App Bridge v3 web component for the embedded app nav menu.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)justpo_locale=(en|zh)/);
  const locale: Locale = (match?.[1] as Locale) ?? "en";
  return json({ apiKey: env.SHOPIFY_API_KEY, locale, polarisLocale: locale === "zh" ? "zh-CN" : "en" });
}

function Document({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { apiKey, locale, polarisLocale } = useLoaderData<typeof loader>();
  return (
    <Document>
      <LocaleProvider locale={locale}>
        <AppProvider isEmbeddedApp apiKey={apiKey} i18n={{ locale: polarisLocale }}>
          <ui-nav-menu>
            <a href="/app" rel="home" />
            <a href="/app/purchase-orders" />
            <a href="/app/suppliers" />
            <a href="/app/import" />
            <a href="/app/settings" />
            <a href="/app/billing" />
          </ui-nav-menu>
          <Outlet />
        </AppProvider>
      </LocaleProvider>
    </Document>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <Document>
      <div style={{ padding: 32, fontFamily: "system-ui" }}>
        <h1>Something went wrong</h1>
        <p>
          {isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : error instanceof Error
              ? error.message
              : "Unknown error"}
        </p>
      </div>
    </Document>
  );
}
