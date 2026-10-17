/** Minimal RFC-4180-ish CSV parser (handles quoted fields, no external dep). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r") {
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop trailing empty rows.
  while (rows.length && rows[rows.length - 1].every((f) => f === "")) {
    rows.pop();
  }
  return rows;
}

/** Guess a column mapping from header names (case-insensitive contains). */
export function guessMapping(
  headers: string[],
  fields: Array<{ key: string; aliases: string[] }>
): Record<string, number> {
  const mapping: Record<string, number> = {};
  const lower = headers.map((h) => h.toLowerCase());
  for (const f of fields) {
    const idx = lower.findIndex((h) => f.aliases.some((a) => h.includes(a)));
    if (idx >= 0) mapping[f.key] = idx;
  }
  return mapping;
}
