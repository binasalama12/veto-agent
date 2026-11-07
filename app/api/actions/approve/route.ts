import { NextResponse } from "next/server";
import { getAction, logAudit } from "@/lib/store";
import { mintToken } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * The human decision point (the CIBA "backchannel" answer). Approving an
 * action is what authorizes the vault to mint a token — approval itself
 * still does not execute anything. The raw token is returned exactly once,
 * to be handed to the executor.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const action = body.id ? getAction(body.id) : undefined;
  if (!action) {
    return NextResponse.json({ error: "action not found" }, { status: 404 });
  }
  if (action.status === "EXECUTED" || action.status === "VETOED") {
    return NextResponse.json(
      { error: `cannot approve an action with status ${action.status}` },
      { status: 409 },
    );
  }
  const firstApproval = action.status !== "APPROVED";
  action.status = "APPROVED";
  action.decidedAt = new Date().toISOString();
  if (firstApproval) {
    logAudit(
      "APPROVED",
      `Human approved "${action.title}". Approval alone executes nothing — the vault now issues a scoped single-use token.`,
      action.id,
    );
  }
  const issued = mintToken(action.id, action.payloadHash);
  return NextResponse.json({
    ok: true,
    token: issued.token,
    tokenFingerprint: issued.fingerprint,
    tokenExpiresAt: issued.expiresAt,
  });
}
