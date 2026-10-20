import { useEffect, useRef, useState } from "react";
import { Modal, TextField, Button, BlockStack, Text, Banner } from "@shopify/polaris";
import { useT } from "./i18n";

// Window in which the same barcode is treated as one scan (not a re-count).
const SCAN_COOLDOWN_MS = 1800;

/**
 * Barcode scanner integration point.
 *
 * Two channels (PRD P0):
 * 1. Camera — ZXing, dynamically imported so SSR never touches it.
 *    Requires the camera permission; the browser explains why (PRD §9).
 * 2. Bluetooth scanner in keyboard-wedge mode — it types the barcode into the
 *    text field below and hits Enter. No pairing code needed in the app.
 */
export function ScannerModal({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<any>(null);
  // ZXing's camera callback fires on ~every frame (~2x/sec) while the same
  // barcode sits in view; without this the parent's onScan would +1 repeatedly.
  // Dedupe by (code -> last accepted timestamp) so one physical scan = one +1.
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: "", ts: 0 });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const stopCamera = () => {
    try {
      readerRef.current?.reset();
    } catch {
      /* noop */
    }
    readerRef.current = null;
    setCameraOn(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      // Dynamic import — never evaluated during SSR.
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setCameraOn(true);
      await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result: any, err: any) => {
          if (!result) return;
          const code = result.getText();
          const nowTs = Date.now();
          const last = lastScanRef.current;
          // Same barcode within the cooldown = a repeat frame of one scan → ignore.
          // A different code, or the same code after the cooldown, is a fresh scan.
          if (code === last.code && nowTs - last.ts < SCAN_COOLDOWN_MS) return;
          lastScanRef.current = { code, ts: nowTs };
          onScan(code);
        }
      );
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : String(e));
      setCameraOn(false);
    }
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setManual("");
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const submitManual = () => {
    const code = manual.trim();
    if (code) {
      onScan(code);
      setManual("");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("receive.title")}>
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("receive.scanHint")}
          </Text>

          {cameraError && <Banner tone="critical">{cameraError}</Banner>}

          <video
            ref={videoRef}
            style={{
              width: "100%",
              borderRadius: 8,
              background: "#000",
              display: cameraOn ? "block" : "none",
            }}
          />

          <Button onClick={cameraOn ? stopCamera : startCamera}>
            {cameraOn ? t("receive.stopCamera") : t("receive.startCamera")}
          </Button>

          {/* Keyboard-wedge channel: a bluetooth scanner types the barcode
              here and hits Enter (form submit). */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitManual();
            }}
          >
            <TextField
              label="Barcode"
              value={manual}
              onChange={setManual}
              autoComplete="off"
              placeholder="Scan or type, then Enter"
              connectedRight={
                <Button submit size="slim">
                  +
                </Button>
              }
            />
          </form>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
