import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Everything the UI needs in one poll: queue, sandbox effects, audit trail. */
export async function GET() {
  return NextResponse.json({
    actions: [...store.actions].reverse(),
    audit: [...store.audit].reverse(),
    sandbox: [...store.sandbox].reverse(),
    plans: store.plans.length,
  });
}
