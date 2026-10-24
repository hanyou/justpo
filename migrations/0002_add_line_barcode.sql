-- 0002: store the variant barcode on each PO line so the receiving scanner can
-- match a scanned UPC/EAN barcode, not just the internal SKU. Backfills as NULL
-- for existing rows; new POs populate it from the Shopify catalog.
ALTER TABLE po_line_items ADD COLUMN barcode TEXT;
