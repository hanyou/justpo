/**
 * PO PDF generation with pdf-lib (pure JS — bundles fine on Workers).
 *
 * Renders a simple, printable purchase order: header (PO number, date,
 * supplier), line table (SKU / title / qty / unit cost / line total),
 * totals, and notes.
 *
 * CJK: supplier names / product titles / notes may contain Chinese, which the
 * built-in StandardFonts (WinAnsi-only) cannot encode — drawText would throw
 * `WinAnsi cannot encode`. We embed a pre-subsetted OFL Noto Sans SC (served as
 * a Worker static asset, see scripts/build-cjk-font.mjs) via @pdf-lib/fontkit
 * with `subset: false` (runtime `subset: true` silently corrupts large CJK
 * fonts). If the font can't be loaded we fall back to Helvetica + WinAnsi
 * sanitization so email generation never 500s.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Env } from "../../env";

export interface POPdfLine {
  sku: string;
  title: string | null;
  qty: number;
  cost: number | null;
}

export interface POPdfData {
  poNumber: string;
  createdAt: string;
  shopDomain: string;
  supplierName: string;
  supplierContact: string | null;
  supplierEmail: string | null;
  paymentTerms: string | null;
  notes: string | null;
  lines: POPdfLine[];
  currency: string;
}

const MARGIN = 50;
const PAGE_W = 595; // A4 width in points
const PAGE_H = 842;

/** Path of the pre-subsetted CJK font within the Worker's static assets. */
const FONT_ASSET_PATH = "/fonts/NotoSansSC-gb.ttf";

// Isolate-level cache of the font bytes. Cleared on rejection so a transient
// failure can't poison every subsequent request (see common pitfall).
let fontBytesPromise: Promise<ArrayBuffer> | null = null;
async function loadCjkFontBytes(assets: Env["ASSETS"]): Promise<ArrayBuffer> {
  if (!fontBytesPromise) {
    fontBytesPromise = (async () => {
      const res = await assets.fetch(new URL(FONT_ASSET_PATH, "https://assets.local"));
      if (!res.ok) throw new Error(`font asset responded ${res.status}`);
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) throw new Error("font asset was empty");
      return buf;
    })();
    fontBytesPromise.catch(() => {
      fontBytesPromise = null;
    });
  }
  return fontBytesPromise;
}

/** Replace characters outside WinAnsi with "?" so Helvetica never throws. */
function toWinAnsi(s: string): string {
  // WinAnsiEncoding = Windows-1252: ASCII 0x20-0x7E, Latin-1 0xA0-0xFF, plus
  // the 0x80-0x9F specials (€, smart quotes, en/em dash, ellipsis, ™ …).
  const winAnsiExtras =
    "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d" +
    "\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u2122\u0161\u203a\u0153\u017e\u0178";
  return s.replace(new RegExp(`[^\\x20-\\x7e\\u00a0-\\u00ff${winAnsiExtras}]`, "g"), "?");
}

function money(n: number | null, currency: string): string {
  if (n === null || n === undefined) return "—";
  return `${currency} ${n.toFixed(2)}`;
}

export async function renderPOPdf(data: POPdfData, env: Env): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  let font: PDFFont;
  let bold: PDFFont;
  let enc: (s: string) => string;
  try {
    const bytes = await loadCjkFontBytes(env.ASSETS);
    pdf.registerFontkit(fontkit);
    const cjk = await pdf.embedFont(bytes, { subset: false });
    font = cjk;
    bold = cjk; // single weight; headers rely on larger size
    enc = (s) => s;
  } catch (e: any) {
    console.warn(
      "[justpo] CJK font unavailable — falling back to Helvetica (non-latin chars will be '?'):",
      e?.message ?? e
    );
    font = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    enc = toWinAnsi;
  }

  // Truncate `text` to fit `maxW` points at `size`, using the active font's
  // metrics (CJK glyphs are wider than latin, so char-count slicing is unsafe).
  const fit = (text: string, maxW: number, size: number, f: PDFFont): string => {
    let t = text;
    if (f.widthOfTextAtSize(enc(t), size) <= maxW) return t;
    while (t.length > 1 && f.widthOfTextAtSize(enc(t + "..."), size) > maxW) {
      t = t.slice(0, -1);
    }
    return t.length > 1 ? t + "..." : t;
  };

  // Width-aware word wrap (CJK-safe): splits into lines that each fit maxW,
  // preserving explicit newlines. Char-count chunking overflows for wide CJK.
  const wrapText = (text: string, maxW: number, size: number, f: PDFFont): string[] => {
    const out: string[] = [];
    for (const para of text.split(/\r?\n/)) {
      if (para === "") { out.push(""); continue; }
      let cur = "";
      for (const ch of para) {
        if (cur && f.widthOfTextAtSize(enc(cur + ch), size) > maxW) {
          out.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const draw = (
    text: string,
    opts: { x?: number; size?: number; f?: PDFFont; color?: any } = {}
  ) => {
    page.drawText(enc(text), {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 11,
      font: opts.f ?? font,
      color: opts.color ?? rgb(0, 0, 0),
    });
  };
  const line = () => {
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 14;
  };
  const nextPageIfNeeded = () => {
    if (y < 90) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // Header
  draw(`PURCHASE ORDER ${data.poNumber}`, { size: 20, f: bold });
  y -= 22;
  draw(`Date: ${new Date(data.createdAt).toLocaleDateString()}`, { size: 10 });
  y -= 14;
  draw(`From: ${data.shopDomain}`, { size: 10 });
  y -= 14;
  line();

  // Supplier block
  draw("Supplier", { size: 12, f: bold });
  y -= 16;
  draw(fit(data.supplierName, PAGE_W - 2 * MARGIN, 11, bold), { f: bold });
  y -= 14;
  if (data.supplierContact) { draw(`Contact: ${data.supplierContact}`, { size: 10 }); y -= 14; }
  if (data.supplierEmail) { draw(`Email: ${data.supplierEmail}`, { size: 10 }); y -= 14; }
  if (data.paymentTerms) { draw(`Payment terms: ${data.paymentTerms}`, { size: 10 }); y -= 14; }
  line();

  // Table header: SKU / Item / Qty / Unit cost / Line total
  const cols = [MARGIN, 140, 330, 380, 470];
  draw("SKU", { x: cols[0], size: 10, f: bold });
  draw("Item", { x: cols[1], size: 10, f: bold });
  draw("Qty", { x: cols[2], size: 10, f: bold });
  draw("Unit cost", { x: cols[3], size: 10, f: bold });
  draw("Total", { x: cols[4], size: 10, f: bold });
  y -= 14;

  let total = 0;
  for (const l of data.lines) {
    nextPageIfNeeded();
    const lineTotal = (l.cost ?? 0) * l.qty;
    total += lineTotal;
    draw(fit(l.sku, cols[1] - cols[0] - 6, 10, font), { x: cols[0], size: 10 });
    draw(fit(l.title ?? "", cols[2] - cols[1] - 6, 10, font), { x: cols[1], size: 10 });
    draw(String(l.qty), { x: cols[2], size: 10 });
    draw(money(l.cost, data.currency), { x: cols[3], size: 10 });
    draw(money(lineTotal, data.currency), { x: cols[4], size: 10 });
    y -= 14;
  }
  line();
  draw(`Total: ${money(total, data.currency)}`, { size: 12, f: bold });
  y -= 20;

  if (data.notes) {
    nextPageIfNeeded();
    draw("Notes", { size: 12, f: bold });
    y -= 16;
    for (const chunk of wrapText(data.notes, PAGE_W - 2 * MARGIN, 10, font)) {
      nextPageIfNeeded();
      draw(chunk, { size: 10 });
      y -= 14;
    }
  }

  return pdf.save();
}
