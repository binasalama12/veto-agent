import { createHash, randomBytes } from "crypto";
import { logAudit } from "./store";

/**
 * Token-vault broker (simulation).
 *
 * The pattern this mirrors — Auth0 Token Vault + CIBA-style asynchronous
 * authorization:
 *
 *  1. The agent NEVER holds the third-party service's credentials. They sit
 *     in the vault.
 *  2. A high-impact action can only run after an out-of-band human approval
 *     (the "backchannel" decision).
 *  3. Only then does the broker mint an execution token that is:
 *       - scoped    — bound to exactly one action id,
 *       - payload-bound — it carries the SHA-256 hash of the exact payload
 *         the human saw and approved; any later edit invalidates it,
 *       - single-use — consumed by the first execution attempt that
 *         presents it, so it cannot be replayed,
 *       - short-lived — 120 second TTL, like a CIBA auth_req that expires.
 *  4. Only the token's SHA-256 hash is stored broker-side; the raw token is
 *     shown to the caller exactly once, mirroring how a real vault hands a
 *     short-lived access token to the executor at run time.
 */

export const TOKEN_TTL_MS = 120_000;

interface TokenRecord {
  hash: string;
  actionId: string;
  payloadHash: string;
  expiresAt: number;
  used: boolean;
}

const tokens = new Map<string, TokenRecord>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(
  actionId: string,
  payloadHashValue: string,
): { token: string; fingerprint: string; expiresAt: string } {
  const token = randomBytes(24).toString("base64url");
  const hash = hashToken(token);
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(hash, {
    hash,
    actionId,
    payloadHash: payloadHashValue,
    expiresAt,
    used: false,
  });
  const fingerprint = hash.slice(0, 12);
  logAudit(
    "TOKEN_ISSUED",
    `Vault issued single-use execution token ${fingerprint}… for action ${actionId.slice(0, 8)}… (TTL 120s, payload-bound).`,
    actionId,
  );
  return { token, fingerprint, expiresAt: new Date(expiresAt).toISOString() };
}

export type ConsumeResult =
  | { ok: true; fingerprint: string }
  | { ok: false; error: string };

/**
 * Validate-and-burn. Any token that is presented is consumed by the attempt
 * if it exists — a token can never be used twice, even after a failed run.
 */
export function consumeToken(
  token: string | undefined,
  actionId: string,
  payloadHashValue: string,
): ConsumeResult {
  if (!token) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: no execution token presented. The agent holds no service credentials, so there is no other way in.`,
      actionId,
    );
    return { ok: false, error: "NO_TOKEN: an execution token is required" };
  }
  const hash = hashToken(token);
  const rec = tokens.get(hash);
  const fingerprint = hash.slice(0, 12);
  if (!rec) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: unknown token ${fingerprint}….`,
      actionId,
    );
    return { ok: false, error: "UNKNOWN_TOKEN: token was not issued by the vault" };
  }
  if (rec.used) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: token ${fingerprint}… was already consumed (single-use).`,
      actionId,
    );
    return { ok: false, error: "TOKEN_REUSED: execution tokens are single-use" };
  }
  rec.used = true; // burn on presentation, whatever happens next
  if (rec.actionId !== actionId) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: token ${fingerprint}… is scoped to a different action.`,
      actionId,
    );
    return { ok: false, error: "WRONG_SCOPE: token is bound to another action" };
  }
  if (rec.payloadHash !== payloadHashValue) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: payload changed after approval (hash mismatch). Re-approval required.`,
      actionId,
    );
    return { ok: false, error: "PAYLOAD_CHANGED: payload no longer matches what was approved" };
  }
  if (Date.now() > rec.expiresAt) {
    logAudit(
      "TOKEN_REJECTED",
      `Executor refused action ${actionId.slice(0, 8)}…: token ${fingerprint}… expired (TTL 120s). Re-approval required.`,
      actionId,
    );
    return { ok: false, error: "TOKEN_EXPIRED: approve again to mint a fresh token" };
  }
  return { ok: true, fingerprint };
}
