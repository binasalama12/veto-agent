"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AuditEvent,
  Plan,
  SandboxItem,
  VaultAction,
} from "@/lib/types";

interface StateResp {
  actions: VaultAction[];
  audit: AuditEvent[];
  sandbox: SandboxItem[];
  plans: number;
}

const SAMPLES = [
  "Audit vercel/next.js: check the repo health, list its open issues, then create an issue with the summary, post a comment, and send a notification to the maintainers.",
  "Check facebook/react and open an issue with a health summary if it looks active.",
  "Look at sindresorhus/awesome, list open issues, and notify the team on Slack.",
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

export default function Home() {
  const [task, setTask] = useState(SAMPLES[0]);
  const [repo, setRepo] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<StateResp | null>(null);
  const [tokens, setTokens] = useState<Record<string, { token: string; fp: string; exp: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vetoReasons, setVetoReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as StateResp);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function runPlan() {
    setPlanning(true);
    setPlanError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, repo: repo || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "planning failed");
      setPlan(data.plan as Plan);
      await refresh();
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "planning failed");
    } finally {
      setPlanning(false);
    }
  }

  async function approve(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/actions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "approve failed");
      setTokens((t) => ({
        ...t,
        [id]: { token: data.token, fp: data.tokenFingerprint, exp: data.tokenExpiresAt },
      }));
      await refresh();
    } catch (e) {
      setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "failed" }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function execute(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, token: tokens[id]?.token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "execute failed");
      setTokens((t) => {
        const copy = { ...t };
        delete copy[id];
        return copy;
      });
      await refresh();
    } catch (e) {
      setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "failed" }));
      await refresh();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function veto(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch("/api/actions/veto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reason: vetoReasons[id] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "veto failed");
      setTokens((t) => {
        const copy = { ...t };
        delete copy[id];
        return copy;
      });
      await refresh();
    } catch (e) {
      setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : "failed" }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const auditColor = (type: AuditEvent["type"]): string =>
    ({
      PLAN_CREATED: "var(--blue)",
      READ_EXECUTED: "var(--green)",
      ACTION_PROPOSED: "var(--amber)",
      APPROVED: "var(--blue)",
      VETOED: "var(--red)",
      TOKEN_ISSUED: "var(--violet)",
      TOKEN_REJECTED: "var(--red)",
      EXECUTED: "var(--green)",
      EXECUTION_FAILED: "var(--red)",
    })[type];

  return (
    <main>
      <h1>
        <span className="veto">Veto</span>Agent
      </h1>
      <p className="tagline">
        An AI agent that investigates freely — real read-only work against a
        live third-party service — but can <strong>never</strong> take a
        high-impact action on its own. Writes wait in an approval queue for an
        asynchronous human yes, and only then does a token vault issue a
        scoped, single-use execution token. The agent never holds the
        service&rsquo;s credentials. One human veto ends an action forever.
      </p>

      <div className="pattern">
        <div className="cell">
          <b>1 · Agent proposes</b>
          <span>Read-only steps run immediately. Anything state-changing is decomposed into an exact, reviewable payload.</span>
        </div>
        <div className="cell gate">
          <b>2 · Human decides — later</b>
          <span>Asynchronous authorization: the action waits in a queue until a human approves or vetoes it. No timeout pressure, no rubber-stamping mid-run.</span>
        </div>
        <div className="cell vault">
          <b>3 · Vault issues a token</b>
          <span>Only after approval: a scoped, single-use, 120-second token bound to the hash of the exact approved payload.</span>
        </div>
        <div className="cell">
          <b>4 · Executor redeems it</b>
          <span>The executor refuses to run without a valid token — no exceptions — and burns it on use. Every step lands in the audit log.</span>
        </div>
      </div>

      <div className="honest">
        <strong>Honest scope:</strong> reads hit the real public GitHub API.
        Approved writes execute against an in-app <em>sandbox workspace</em>{" "}
        (an audit-grade record of exactly what would be sent), not real GitHub
        writes — because a demo must never be able to spam a real service. The
        gating design maps 1:1 to Auth0 Token Vault + CIBA-style backchannel
        approval; swapping the sandbox for the real write API changes nothing
        about the approval/token flow.
      </div>

      <h2>Give the agent a task</h2>
      <div className="panel">
        <textarea
          rows={3}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="e.g. Audit owner/repo, list its open issues, then create an issue with the summary and notify the maintainers."
        />
        <div className="chips">
          {SAMPLES.map((s, i) => (
            <button key={i} className="chip" onClick={() => setTask(s)}>
              Sample {i + 1}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            type="text"
            className="grow"
            placeholder="Repository (optional, e.g. vercel/next.js) — also detected from the task text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <button onClick={runPlan} disabled={planning || !task.trim()}>
            {planning ? "Planning + investigating…" : "Plan task"}
          </button>
        </div>
        {planError && <div className="err">{planError}</div>}
      </div>

      {plan && (
        <>
          <h2>Plan — {plan.steps.length} steps</h2>
          <div className="panel">
            <p style={{ marginTop: 0 }}>
              {plan.summary}{" "}
              <span className="hash">
                (summary: {plan.summarySource === "llm" ? "LLM" : "deterministic"})
              </span>
            </p>
            {plan.steps.map((s) => (
              <div className="step" key={s.id}>
                <div className="row">
                  <span
                    className={
                      "badge " + (s.classification === "READ_ONLY" ? "read" : "gated")
                    }
                  >
                    {s.classification === "READ_ONLY" ? "READ-ONLY · auto" : "HIGH-IMPACT · gated"}
                  </span>
                  <b>{s.title}</b>
                </div>
                <div className="result">{s.detail}</div>
                {s.result && <div className="result">→ {s.result}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Approval queue</h2>
      {!state || state.actions.length === 0 ? (
        <div className="panel empty">
          No proposed actions yet. Plan a task that includes a write (create
          an issue, post a comment, send a notification) and it will wait here
          — unexecuted — for a human decision.
        </div>
      ) : (
        state.actions.map((a) => (
          <div className="panel" key={a.id}>
            <div className="row">
              <span className={"badge " + a.status.toLowerCase()}>{a.status}</span>
              <h3>{a.title}</h3>
              <span className="hash">payload sha256 {a.payloadHash.slice(0, 16)}…</span>
            </div>
            <details className="payload" open={a.status === "PENDING"}>
              <summary>Exact payload the human is approving</summary>
              <pre>{JSON.stringify(a.payload, null, 2)}</pre>
            </details>

            {a.status === "EXECUTED" && <div className="ok">✓ {a.result}</div>}
            {a.status === "VETOED" && (
              <div className="err">
                ✕ Vetoed{a.vetoReason ? ` — "${a.vetoReason}"` : ""}. This action
                can never execute and no token will be issued for it.
              </div>
            )}
            {errors[a.id] && <div className="err">{errors[a.id]}</div>}

            {(a.status === "PENDING" || a.status === "APPROVED") && (
              <>
                <div className="row">
                  <button
                    className="approve"
                    onClick={() => approve(a.id)}
                    disabled={busy[a.id]}
                  >
                    {a.status === "APPROVED" ? "Re-approve (mint fresh token)" : "Approve"}
                  </button>
                  <input
                    type="text"
                    className="grow"
                    placeholder="Veto reason (optional — a veto needs no reason)"
                    value={vetoReasons[a.id] ?? ""}
                    onChange={(e) =>
                      setVetoReasons((v) => ({ ...v, [a.id]: e.target.value }))
                    }
                  />
                  <button className="veto" onClick={() => veto(a.id)} disabled={busy[a.id]}>
                    Veto
                  </button>
                </div>
                {tokens[a.id] && (
                  <div className="tokenbox">
                    🔑 Vault token issued: <span className="hash">{tokens[a.id].fp}…</span>{" "}
                    — scoped to this action + payload hash, single-use, expires{" "}
                    {new Date(tokens[a.id].exp).toLocaleTimeString([], { hour12: false })}.
                    The executor will refuse anything else.
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="exec" onClick={() => execute(a.id)} disabled={busy[a.id]}>
                        Execute with token
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))
      )}

      <h2>Sandbox workspace — what actually executed</h2>
      {!state || state.sandbox.length === 0 ? (
        <div className="panel empty">
          Nothing has executed yet. Approved actions redeem their vault token
          here, against the sandbox, with the exact payload shown above.
        </div>
      ) : (
        <div className="panel">
          {state.sandbox.map((s) => (
            <div className="step" key={s.id}>
              <b>{s.title}</b>
              <div className="result">{s.detail}</div>
            </div>
          ))}
        </div>
      )}

      <h2>Audit log</h2>
      <div className="panel audit">
        {!state || state.audit.length === 0 ? (
          <div className="empty">No events yet.</div>
        ) : (
          state.audit.map((ev) => (
            <div className="ev" key={ev.id}>
              <time>{fmtTime(ev.ts)}</time>
              <span className="t" style={{ color: auditColor(ev.type) }}>
                {ev.type}
              </span>
              <span>{ev.message}</span>
            </div>
          ))
        )}
      </div>

      <footer>
        VetoAgent — a demonstration of the token-vault + asynchronous
        authorization pattern (Auth0 Token Vault / CIBA-style backchannel
        approval) for AI agents. Reads: public GitHub API, no credentials.
        Writes: human-approved, token-gated, sandbox-executed, fully audited.
      </footer>
    </main>
  );
}
