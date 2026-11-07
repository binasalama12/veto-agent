import { NextResponse } from "next/server";
import { executeAction } from "@/lib/executor";
import { getAction } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Execution requires the vault token in the request body. There is no
 * session, cookie, or header that bypasses this — possession of a valid,
 * unexpired, unconsumed token bound to this exact action + payload is the
 * only way through, by design.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    token?: string;
  };
  const action = body.id ? getAction(body.id) : undefined;
  if (!action) {
    return NextResponse.json({ error: "action not found" }, { status: 404 });
  }
  const result = executeAction(action, body.token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  return NextResponse.json({ ok: true, result: result.result });
}
