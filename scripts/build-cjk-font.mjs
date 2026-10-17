/**
 * Build-time CJK font subsetting for PO PDFs.
 *
 * Why this exists:
 * - pdf-lib's StandardFonts (Helvetica) are WinAnsi-only, so drawing Chinese
 *   (supplier names, product titles, notes) throws `WinAnsi cannot encode`.
 * - @pdf-lib/fontkit's runtime `embedFont(bytes, { subset: true })` is BROKEN
 *   for large CJK fonts (Noto Sans SC has ~30k glyphs): it silently truncates
 *   glyph outlines — the PDF extracts text fine but renders blank/missing.
 * - Runtime subsetting (subset-font / harfbuzz) can't run on Cloudflare
 *   Workers because it loads its WASM via `fs.readFile` (no filesystem).
 *
 * So we pre-subset the full OFL-licensed Noto Sans SC down to the common
 * charset (ASCII + Latin-1 currency/symbols + CJK punctuation + GB2312
 * hanzi ≈ 8k chars → ~2.3MB) at BUILD time, ship it as a Worker static asset,
 * and embed it at runtime with `subset: false` (full embed of the small subset
 * → correct rendering, ~1.5MB PDF).
 *
 * Regenerate with: `node scripts/build-cjk-font.mjs`
 * Output: public/fonts/NotoSansSC-gb.ttf  (copied to build/client by Vite)
 */
import subsetFont from "subset-font";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Full Noto Sans SC Regular TTF (OFL) shipped by the expo-google-fonts package.
const SRC = require.resolve(
  "@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf"
);

const range = (a, b) => {
  let s = "";
  for (let c = a; c <= b; c++) {
    try {
      s += String.fromCharCode(c);
    } catch {
      /* skip lone surrogates */
    }
  }
  return s;
};

// GB2312 hanzi + symbols: decode every valid two-byte GB2312 sequence.
const gb2312Chars = () => {
  const dec = new TextDecoder("gb2312");
  const seen = new Set();
  for (let hi = 0xa1; hi <= 0xf7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch && ch !== "\uFFFD" && ch.codePointAt(0) > 0x2000) seen.add(ch);
    }
  }
  return [...seen].join("");
};

const charset =
  range(0x20, 0x7e) + // ASCII printable
  range(0xa0, 0x17f) + // Latin-1 supplement + currency (£ ¥ € etc.)
  range(0x3000, 0x303f) + // CJK punctuation
  range(0xff00, 0xffef) + // full-width forms
  "—‘’“”·×÷≤≥≠∞°±" +
  gb2312Chars();

const outDir = path.resolve("public/fonts");
const out = path.join(outDir, "NotoSansSC-gb.ttf");

const srcBuf = fs.readFileSync(SRC);
const subset = new Uint8Array(
  await subsetFont(srcBuf, charset, {
    targetFormat: "truetype",
    // Drop ALL OpenType layout features + positioning tables. pdf-lib applies
    // the font's GPOS/kern pairs when drawing, which injects erratic spacing
    // between digits (e.g. "12.50" -> "1 2 .5 0"). A PO PDF needs no complex
    // shaping (CJK maps 1:1), so stripping these is safe and fixes spacing.
    keepFeatures: [],
    dropTables: ["GPOS", "GSUB", "kern", "GDEF", "BASE", "JSTF", "STAT"],
  })
);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, subset);

console.log(
  `[build-cjk-font] ${charset.length} chars -> ${out} ` +
    `(${(subset.length / 1024 / 1024).toFixed(2)} MB, from ${(srcBuf.length / 1024 / 1024).toFixed(1)} MB source)`
);
