/**
 * PO state machine — pure functions (unit-testable, no I/O).
 *
 * PRD §5: draft → sent → partial → received, single direction only.
 * PRD §13.5: received 可退回改为单向 + 手动调整 (manual adjustment allowed
 * on received POs instead of reversing the state machine).
 * PRD §4.1: only sent+ statuses count toward the Starter quota; cancelled
 * never refunds quota (enforced via quota_counted flag in db layer).
 */

export const POStatus = {
  Draft: "draft",
  Sent: "sent",
  Partial: "partial",
  Received: "received",
  Cancelled: "cancelled",
} as const;
export type POStatus = (typeof POStatus)[keyof typeof POStatus];

/** Allowed single-direction transitions. */
const TRANSITIONS: Record<POStatus, POStatus[]> = {
  [POStatus.Draft]: [POStatus.Sent, POStatus.Cancelled],
  [POStatus.Sent]: [POStatus.Partial, POStatus.Received, POStatus.Cancelled],
  [POStatus.Partial]: [POStatus.Received, POStatus.Cancelled],
  [POStatus.Received]: [], // terminal — corrections go through manual adjustment
  [POStatus.Cancelled]: [], // terminal
};

export function canTransition(from: POStatus, to: POStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that count toward the Starter 30-PO/month quota (PRD §4.1). */
export function countsTowardQuota(status: POStatus): boolean {
  return (
    status === POStatus.Sent ||
    status === POStatus.Partial ||
    status === POStatus.Received
  );
}

/**
 * Derive the receiving status from line quantities.
 * - all lines fully received  → received
 * - some received             → partial
 * - none received             → keep current (sent)
 */
export function deriveReceivingStatus(
  lines: Array<{ qty: number; qty_received: number }>
): "partial" | "received" | null {
  if (lines.length === 0) return null;
  const totalOrdered = lines.reduce((s, l) => s + l.qty, 0);
  const totalReceived = lines.reduce((s, l) => s + l.qty_received, 0);
  if (totalReceived <= 0) return null;
  if (totalReceived >= totalOrdered) return POStatus.Received;
  return POStatus.Partial;
}

/** Manual adjustment: allowed on received POs (PRD §5) — adjust received qty per line. */
export function applyManualAdjustment(
  lines: Array<{ qty: number; qty_received: number }>,
  adjustments: Record<string, number> // lineId -> new qty_received
): Array<{ qty: number; qty_received: number }> {
  return lines.map((line, i) => {
    const key = String(i);
    if (!(key in adjustments)) return line;
    const next = Math.max(0, Math.floor(adjustments[key]));
    return { ...line, qty_received: next };
  });
}

/** Over/under receipt diff per line for the red highlight UI (PRD §6.2). */
export function lineDiff(line: { qty: number; qty_received: number }): number {
  return line.qty_received - line.qty;
}
