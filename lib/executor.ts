import { randomUUID } from "crypto";
import { getAction, logAudit, store } from "./store";
import { consumeToken } from "./vault";

/**
 * The executor is deliberately dumb and paranoid:
 *
 *  - It has no code path that runs a high-impact action without first
 *    consuming a valid vault token (scoped, payload-bound, single-use,
 *    unexpired). There is no "trusted caller" flag.
 *  - In this demo the token redeems against an in-app SANDBOX workspace
 *    (see README "Honest scope"): the sandbox records exactly what would
 *    have been sent to the real service. In production the same call would
 *    exchange the vault token for the service's real access token (Auth0
 *    Token Vault) and perform the API write — the gating logic is identical.
 */
export function executeAction(
  action: NonNullable<ReturnType<typeof getAction>>,
  token: string | undefined,
): { ok: true; result: string } | { ok: false; error: string } {
  if (action.status === "EXECUTED") {
    return { ok: false, error: "ALREADY_EXECUTED: this action already ran" };
  }
  if (action.status === "VETOED") {
    logAudit(
      "EXECUTION_FAILED",
      `Execution attempted on vetoed action "${action.title}" — refused. A veto is final.`,
      action.id,
    );
    return { ok: false, error: "VETOED: a human vetoed this action; it can never execute" };
  }
  if (action.status !== "APPROVED") {
    logAudit(
      "EXECUTION_FAILED",
      `Execution attempted on action "${action.title}" with status ${action.status} — refused. Approval must come first.`,
      action.id,
    );
    return { ok: false, error: "NOT_APPROVED: this action has not been approved by a human" };
  }

  const consumed = consumeToken(token, action.id, action.payloadHash);
  if (!consumed.ok) {
    logAudit(
      "EXECUTION_FAILED",
      `Action "${action.title}" did not execute: ${consumed.error}.`,
      action.id,
    );
    return { ok: false, error: consumed.error };
  }

  // --- Sandbox execution: records the exact effect, harms nothing. ---
  const op = String(action.payload.operation ?? action.kind);
  const detail =
    action.kind === "CREATE_ISSUE"
      ? `Issue "${String(action.payload.title)}" created in the sandbox copy of ${String(action.payload.repo)}.`
      : action.kind === "POST_COMMENT"
        ? `Comment posted in the sandbox on ${String(action.payload.issue ?? "the plan's issue")}.`
        : action.kind === "SEND_NOTIFICATION"
          ? `Notification delivered to sandbox channel ${String(action.payload.channel)}.`
          : `Operation recorded in the sandbox workspace.`;
  store.sandbox.push({
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: action.kind,
    title: action.title,
    detail,
  });

  action.status = "EXECUTED";
  action.executedAt = new Date().toISOString();
  action.result = `${op} executed in sandbox with token ${consumed.fingerprint}… (consumed). ${detail}`;
  logAudit(
    "EXECUTED",
    `Action "${action.title}" executed — ${op} — token ${consumed.fingerprint}… consumed.`,
    action.id,
  );
  return { ok: true, result: action.result };
}
