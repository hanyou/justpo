/**
 * Remix server entry — Cloudflare Workers compatible.
 * Uses renderToReadableStream (no node:stream) and WHATWG Response.
 *
 * The cf-worker adapter is registered here (side-effect import): this module
 * is server-only (never in the client bundle) and evaluates before any
 * shopifyApp() call, in both `remix vite:dev` and the production worker.
 */
import "@shopify/shopify-api/adapters/cf-worker";
import type { EntryContext } from "@remix-run/cloudflare";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

const ABORT_DELAY = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ABORT_DELAY);

  const body = await renderToReadableStream(
    <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        if (!controller.signal.aborted) {
          // Log streaming errors; the client shell will show the error boundary.
          console.error("[justpo] render error:", error);
        }
        responseStatusCode = 500;
      },
    }
  );

  // Bots get the fully-rendered HTML.
  if (isbot(request.headers.get("user-agent") || "")) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  clearTimeout(timeoutId);
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
