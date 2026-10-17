import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";

/** Root of the embedded app: bounce into /app (billing-gated layout). */
export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/app");
}
