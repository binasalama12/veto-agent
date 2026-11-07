import { request } from "https";

/**
 * Read-only GitHub integration: unauthenticated public REST API reads.
 * This is the "connected third-party service" the agent investigates with.
 * It deliberately has NO credentials and NO write path — writes are exactly
 * what the approval queue + token vault exist to gate.
 *
 * Uses node:https with IPv4 first because plain fetch can stall on IPv6 in
 * some sandboxes; these are plain public GETs either way.
 */

export interface RepoInfo {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  pushedAt: string | null;
  archived: boolean;
  license: string | null;
}

export interface IssueInfo {
  number: number;
  title: string;
  state: string;
  comments: number;
  createdAt: string;
}

function getJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        family: 4,
        headers: {
          "User-Agent": "veto-agent-demo",
          Accept: "application/vnd.github+json",
        },
        timeout: 12000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: null });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("github timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchRepo(repo: string): Promise<RepoInfo | null> {
  const { status, body } = await getJson(
    `https://api.github.com/repos/${repo}`,
  );
  if (status !== 200 || !body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  return {
    fullName: String(b.full_name ?? repo),
    description: (b.description as string | null) ?? null,
    stars: Number(b.stargazers_count ?? 0),
    forks: Number(b.forks_count ?? 0),
    openIssues: Number(b.open_issues_count ?? 0),
    language: (b.language as string | null) ?? null,
    pushedAt: (b.pushed_at as string | null) ?? null,
    archived: Boolean(b.archived),
    license:
      ((b.license as Record<string, unknown> | null)?.spdx_id as
        | string
        | null) ?? null,
  };
}

export async function fetchOpenIssues(repo: string): Promise<IssueInfo[]> {
  const { status, body } = await getJson(
    `https://api.github.com/repos/${repo}/issues?state=open&per_page=50`,
  );
  if (status !== 200 || !Array.isArray(body)) return [];
  return body
    .filter(
      (i) =>
        i && typeof i === "object" && !("pull_request" in (i as object)),
    )
    .slice(0, 5)
    .map((i) => {
      const o = i as Record<string, unknown>;
      return {
        number: Number(o.number ?? 0),
        title: String(o.title ?? ""),
        state: String(o.state ?? "open"),
        comments: Number(o.comments ?? 0),
        createdAt: String(o.created_at ?? ""),
      };
    });
}
