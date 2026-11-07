import { createHash, randomUUID } from "crypto";
import type {
  AuditEvent,
  AuditType,
  Plan,
  SandboxItem,
  VaultAction,
} from "./types";

/**
 * In-memory demo store. In production this maps to: the connected service's
 * real API (executor target), an approvals database, and an append-only
 * audit trail. Here everything lives in one Node process so the pattern is
 * easy to run and inspect. State is kept on globalThis so Next.js dev HMR
 * does not wipe it between module reloads.
 */
interface Store {
  plans: Plan[];
  actions: VaultAction[];
  audit: AuditEvent[];
  sandbox: SandboxItem[];
}

const g = globalThis as unknown as { __vetoStore?: Store };
if (!g.__vetoStore) {
  g.__vetoStore = { plans: [], actions: [], audit: [], sandbox: [] };
}
export const store: Store = g.__vetoStore;

export function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function logAudit(
  type: AuditType,
  message: string,
  actionId?: string,
): AuditEvent {
  const ev: AuditEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    message,
    actionId,
  };
  store.audit.push(ev);
  return ev;
}

export function getAction(id: string): VaultAction | undefined {
  return store.actions.find((a) => a.id === id);
}
