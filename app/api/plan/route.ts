import { NextResponse } from "next/server";
import { createPlan } from "@/lib/planner";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    task?: string;
    repo?: string;
  };
  const task = (body.task ?? "").trim();
  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }
  const plan = await createPlan(task, body.repo);
  return NextResponse.json({ plan });
}
