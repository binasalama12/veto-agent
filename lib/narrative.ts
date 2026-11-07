import type { IssueInfo, RepoInfo } from "./github";

/**
 * Optional plan-summary narration, pluggable exactly like Rug Radar's
 * verdict layer: if LLM_API_KEY is set, one OpenAI-compatible
 * chat-completions call (LLM_API_URL / LLM_MODEL) writes the summary;
 * otherwise a deterministic summary is assembled from the plan itself, so
 * the app always works with zero keys.
 */
export async function summarizePlan(input: {
  task: string;
  repo: string | null;
  repoInfo: RepoInfo | null;
  issues: IssueInfo[];
  readSteps: number;
  gatedSteps: number;
}): Promise<{ text: string; source: "llm" | "rules" }> {
  const apiKey = process.env.LLM_API_KEY;
  if (apiKey) {
    try {
      const text = await llmSummary(input, apiKey);
      if (text) return { text, source: "llm" };
    } catch {
      /* fall through to deterministic summary */
    }
  }
  return { text: ruleSummary(input), source: "rules" };
}

function ruleSummary(input: {
  repo: string | null;
  repoInfo: RepoInfo | null;
  issues: IssueInfo[];
  readSteps: number;
  gatedSteps: number;
}): string {
  const parts: string[] = [];
  if (input.repoInfo) {
    const r = input.repoInfo;
    parts.push(
      `Read-only investigation of ${r.fullName} completed: ${r.stars.toLocaleString()} stars, ${r.openIssues} open issues, primary language ${r.language ?? "unknown"}, last push ${r.pushedAt ? r.pushedAt.slice(0, 10) : "unknown"}.`,
    );
    if (input.issues.length) {
      parts.push(
        `Looked at the ${input.issues.length} most recent open issues (top: #${input.issues[0].number} "${input.issues[0].title}").`,
      );
    }
  } else if (input.repo) {
    parts.push(
      `Could not read ${input.repo} from the public GitHub API (not found or rate-limited); the plan continues with sandbox data.`,
    );
  }
  parts.push(
    input.gatedSteps > 0
      ? `${input.gatedSteps} high-impact action(s) were NOT executed — they are waiting in the approval queue below. Nothing reaches the executor without a human approval and a scoped single-use token from the vault.`
      : `No high-impact actions were detected in this task, so nothing needed approval.`,
  );
  return parts.join(" ");
}

async function llmSummary(
  input: Parameters<typeof ruleSummary>[0] & { task: string },
  apiKey: string,
): Promise<string> {
  const url =
    process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions";
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Summarize an agent's investigation plan in 2-3 plain sentences. State clearly which actions were gated for human approval. Never claim anything was executed that was gated.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: input.task,
            deterministicSummary: ruleSummary(input),
          }),
        },
      ],
      max_tokens: 180,
    }),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}
