/**
 * Billing plan names — shared between server and client code.
 * (Kept in a non-`.server` module so route components can import the
 * names without pulling server code into the client bundle.)
 */
export const STARTER_PLAN = "Starter";
export const PRO_PLAN = "Pro";

/** Monthly prices in USD, per PRD §4. */
export const PLAN_PRICES_USD: Record<string, number> = {
  [STARTER_PLAN]: 9,
  [PRO_PLAN]: 19,
};
