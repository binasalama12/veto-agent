import { NextResponse } from "next/server";
import { getAction, logAudit } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A veto is final and needs no justification; a reason is logged if given. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    reason?: string;
  };
  const action = body.id ? getAction(body.id) : undefined;
  if (!action) {
    return NextResponse.json({ error: "action not found" }, { status: 404 });
  }
  if (action.status === "EXECUTED") {
    return NextResponse.json(
      { error: "cannot veto an action that already executed" },
      { status: 409 },
    );
  }
  action.status = "VETOED";
  action.decidedAt = new Date().toISOString();
  action.vetoReason = body.reason?.trim() || undefined;
  logAudit(
    "VETOED",
    `Human VETOED "${action.title}"${action.vetoReason ? ` — reason: ${action.vetoReason}` : " (no reason given)"}. No token will ever be issued for it.`,
    action.id,
  );
  return NextResponse.json({ ok: true });
}
