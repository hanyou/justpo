import { vitePlugin as remix, cloudflareDevProxyVitePlugin } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/cloudflare" {
  interface Future {
    v3_singleFetch: true;
  }
}

export default defineConfig({
  plugins: [
    cloudflareDevProxyVitePlugin(),
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
  ssr: {
    // Production worker bundle: bundle everything (workerd has no node_modules).
    // node: builtins stay external — nodejs_compat is enabled in wrangler.toml.
    // Dev (`remix vite:dev`): leave deps external so Node resolves them natively
    // (bundling react's CJS entry in vite's dev module runner 500s every page).
    noExternal:
      process.env.NODE_ENV === "production" ? [/^(?!node:).*/] : undefined,
    resolve: {
      // Resolve the `worker` condition so `react-dom/server` -> server.browser.js.
      // The node build (default condition) does NOT export renderToReadableStream,
      // which entry.server.tsx needs — without this every SSR page 500s.
      conditions: ["workerd", "worker", "browser", "module", "default"],
      // Same for dev, where react stays external and is imported natively.
      externalConditions: ["workerd", "worker", "node", "module", "default"],
    },
  },
});
