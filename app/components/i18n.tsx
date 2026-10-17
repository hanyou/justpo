import { createContext, useContext } from "react";
import type { Locale } from "../i18n";
import { dictionaries, interpolate as interpolateRaw } from "../i18n";

export { interpolateRaw as interpolate };

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** t("dashboard.title") with optional {var} interpolation. */
export function useT() {
  const locale = useLocale();
  return (key: keyof (typeof dictionaries)["en"], vars?: Record<string, string | number>) => {
    const raw = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
    return vars ? interpolateRaw(raw, vars) : raw;
  };
}
