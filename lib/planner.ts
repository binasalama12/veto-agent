import { randomUUID } from "crypto";
import { fetchOpenIssues, fetchRepo, type IssueInfo, type RepoInfo } from "./github";
import { summarizePlan } from "./narrative";
import { logAudit, payloadHash, store } from "./store";
import type { Plan, PlanStep, StepKind, VaultAction } from "./types";

/**
 * Deterministic planner. No LLM is needed to decide what happens: the task
 * text is decomposed by an explicit rule table into steps, and every step is
 * classified READ_ONLY (safe to auto-execute — pure GETs against a public
 * API) or HIGH_IMPACT (anything that would change state on the connected
 * service — these are NEVER executed by the planner; they become pending
 * actions in the approval queue).
 */

export function extractRepo(task: string, explicit?: string): string | null {
  if (explicit && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(explicit.trim())) {
    return explicit.trim();
  }
  const url = task.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (url) return url[1];
  const bare = task.match(
    /(?:^|[\s:(])([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+)(?=$|[\s).,;:])/,
  );
  if (bare && !bare[1].startsWith("http")) return bare[1];
  return null;
}

interface WriteRule {
  kind: StepKind;
  test: RegExp;
  title: (repo: string) => string;
}

const WRITE_RULES: WriteRule[] = [
  {
    kind: "SEND_NOTIFICATION",
    test: /\b(notif\w*|send|post|push|email|slack|ping|alert|message)\b[^.]{0,60}\b(notification|email|slack|alert|message|maintainers|team|channel)\b|\bnotify\b/i,
    title: (r) => `Send a notification about ${r}`,
  },
  {
    kind: "CREATE_ISSUE",
    test: /\b(create|open|file|raise|submit|log|add)\b[^.]{0,40}\bissue\b/i,
    title: (r) => `Create an issue in ${r}`,
  },
  {
    kind: "POST_COMMENT",
    test: /\b(comment|reply|respond|post a comment|leave a comment)\b/i,
    title: (r) => `Post a comment in ${r}`,
  },
  {
    kind: "GENERIC_WRITE",
    test: /\b(close|merge|delete|remove|assign|label|update|change|deploy|publish)\b/i,
    title: (r) => `Perform a state-changing operation on ${r}`,
  },
];

function buildPayload(
  kind: StepKind,
  repo: string,
  repoInfo: RepoInfo | null,
  issues: IssueInfo[],
): Record<string, unknown> {
  const target = repoInfo?.fullName ?? repo;
  switch (kind) {
    case "CREATE_ISSUE":
      return {
        service: "GitHub",
        operation: `POST /repos/${target}/issues`,
        repo: target,
        title: repoInfo
          ? `Health check: ${target} — ${repoInfo.stars.toLocaleString()}★, ${repoInfo.openIssues} open issues`
          : `Health check: ${target}`,
        body: repoInfo
          ? `Automated health check proposed by VetoAgent.\n\n- Stars: ${repoInfo.stars}\n- Open issues: ${repoInfo.openIssues}\n- Primary language: ${repoInfo.language ?? "unknown"}\n- Last push: ${repoInfo.pushedAt ?? "unknown"}\n- Archived: ${repoInfo.archived}\n\nThis issue was proposed by an AI agent and only filed after explicit human approval (asynchronous authorization); execution used a scoped, single-use token from the token vault.`
          : "Automated health check proposed by VetoAgent (repo data unavailable at plan time). Filed only after explicit human approval via a scoped, single-use vault token.",
        labels: ["veto-agent", "health-check"],
      };
    case "POST_COMMENT": {
      const first = issues[0];
      return {
        service: "GitHub",
        operation: first
          ? `POST /repos/${target}/issues/${first.number}/comments`
          : `POST /repos/${target}/issues/{new}/comments`,
        repo: target,
        issue: first ? `#${first.number} ${first.title}` : "(the issue created by this plan)",
        body: "Follow-up from VetoAgent: the read-only health check is complete and the findings issue has been proposed for maintainer review. This comment was gated behind human approval and executed with a scoped, single-use token.",
      };
    }
    case "SEND_NOTIFICATION":
      return {
        service: "Slack-style webhook",
        operation: "POST /webhooks/maintainer-alerts",
        channel: "#repo-maintainers",
        message: repoInfo
          ? `VetoAgent health check for ${target}: ${repoInfo.stars.toLocaleString()}★, ${repoInfo.openIssues} open issues, last push ${repoInfo.pushedAt?.slice(0, 10) ?? "unknown"}. A findings issue is awaiting maintainer review.`
          : `VetoAgent health check for ${target} is complete; findings are awaiting maintainer review.`,
      };
    default:
      return {
        service: "GitHub",
        operation: `State-changing operation on ${target} (exact verb taken from the task text)`,
        repo: target,
        note: "Generic high-impact step: the planner could not map the task to a specific write API, so it is gated as an opaque state change. A human must approve the exact intent before any token is issued.",
      };
  }
}

export async function createPlan(task: string, explicitRepo?: string): Promise<Plan> {
  const planId = randomUUID();
  const repo = extractRepo(task, explicitRepo);
  const steps: PlanStep[] = [];
  let repoInfo: RepoInfo | null = null;
  let issues: IssueInfo[] = [];

  // ---- Read-only phase: executes immediately, no approval needed. ----
  if (repo) {
    repoInfo = await fetchRepo(repo);
    steps.push({
      id: randomUUID(),
      kind: "FETCH_REPO",
      classification: "READ_ONLY",
      title: `Fetch repository info for ${repo}`,
      detail: "GET https://api.github.com/repos/" + repo + " (public, unauthenticated)",
      status: "DONE",
      result: repoInfo
        ? `${repoInfo.fullName}: ${repoInfo.stars.toLocaleString()}★, ${repoInfo.forks.toLocaleString()} forks, ${repoInfo.openIssues} open issues, ${repoInfo.language ?? "unknown"}${repoInfo.archived ? ", ARCHIVED" : ""}.`
        : `GitHub returned no data for ${repo} (not found or rate-limited) — plan continues; gated payloads use sandbox data.`,
    });
    logAudit(
      "READ_EXECUTED",
      `Read-only step executed: GET /repos/${repo} → ${repoInfo ? "200 OK" : "no data"}.`,
    );

    issues = await fetchOpenIssues(repo);
    steps.push({
      id: randomUUID(),
      kind: "LIST_ISSUES",
      classification: "READ_ONLY",
      title: `List recent open issues in ${repo}`,
      detail: "GET /repos/" + repo + "/issues?state=open (public, unauthenticated)",
      status: "DONE",
      result: issues.length
        ? issues.map((i) => `#${i.number} ${i.title}`).join(" · ")
        : "No open issues returned.",
    });
    logAudit(
      "READ_EXECUTED",
      `Read-only step executed: GET /repos/${repo}/issues → ${issues.length} open issue(s).`,
    );
  }

  steps.push({
    id: randomUUID(),
    kind: "SUMMARIZE",
    classification: "READ_ONLY",
    title: "Summarize findings locally",
    detail: "Pure local computation over the fetched evidence — touches no external state.",
    status: "DONE",
    result: "Summary generated below.",
  });

  // ---- High-impact phase: NEVER executed here. Becomes queue entries. ----
  const target = repo ?? "demo/sandbox-workspace";
  const matched = WRITE_RULES.filter((r) => r.test.test(task));
  for (const rule of matched) {
    const payload = buildPayload(rule.kind, target, repoInfo, issues);
    const action: VaultAction = {
      id: randomUUID(),
      planId,
      kind: rule.kind,
      title: rule.title(target),
      service: String(payload.service ?? "GitHub"),
      payload,
      payloadHash: payloadHash(payload),
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    store.actions.push(action);
    steps.push({
      id: action.id,
      kind: rule.kind,
      classification: "HIGH_IMPACT",
      title: rule.title(target),
      detail:
        "HIGH-IMPACT: state-changing. Not executed — queued for asynchronous human approval.",
      status: "QUEUED",
    });
    logAudit(
      "ACTION_PROPOSED",
      `Agent proposed high-impact action "${action.title}" — payload hash ${action.payloadHash.slice(0, 12)}… — parked in the approval queue.`,
      action.id,
    );
  }

  const summary = await summarizePlan({
    task,
    repo,
    repoInfo,
    issues,
    readSteps: steps.filter((s) => s.classification === "READ_ONLY").length,
    gatedSteps: matched.length,
  });

  const plan: Plan = {
    id: planId,
    task,
    repo,
    createdAt: new Date().toISOString(),
    summary: summary.text,
    summarySource: summary.source,
    steps,
  };
  store.plans.push(plan);
  logAudit(
    "PLAN_CREATED",
    `Plan created for task "${task.slice(0, 80)}" — ${steps.length} step(s), ${matched.length} gated.`,
  );
  return plan;
}
