# VetoAgent

**An AI agent that can investigate anything — but can never act on its own.**
Read-only work runs freely against a real third-party service. Every
high-impact action is decomposed into an exact payload, parked in an
approval queue, and can only execute after an explicit, asynchronous human
approval — at which point a token-vault broker issues a **scoped,
single-use, short-lived execution token** bound to the hash of the exact
payload the human approved. The agent never holds the service's
credentials. One human **veto** kills an action permanently.

Built for MLH Global Hack Week: Builders Week — challenge *"The Veto Agent
(Focus: Token Vault & Asynchronous Authorization)"*.

## The problem

Agents are being handed real API keys and told to "go do things." That
inverts the security model: the least predictable component in the system
(the model) holds the most dangerous capability (raw write credentials),
and "approval" — if it exists at all — is a synchronous prompt the agent
itself can often route around. What we actually want is the pattern human
organizations already use for dangerous operations: **propose → independent
review → time-boxed, narrowly-scoped authorization → execution with an
audit trail.** VetoAgent implements exactly that loop for an AI agent.

## How it works

```
┌────────────┐   task    ┌──────────────┐  read-only   ┌────────────────┐
│   Human    │ ────────► │   Planner    │ ───────────► │  GitHub API    │
│  (the boss)│           │ (determin-   │  public GETs │  (no auth)     │
└────────────┘           │  istic rules)│              └────────────────┘
      ▲                  └──────────────┘
      │                         │ high-impact steps become
      │                         ▼ exact-payload proposals
      │                  ┌──────────────┐
      │   approve/veto   │   Approval   │   nothing executes here;
      └───────────────── │    queue     │   decisions can happen
                         └──────────────┘   minutes or days later
                                │ approval
                                ▼
                         ┌──────────────┐  mint scoped, single-use,
                         │  Token vault │  payload-bound, 120s token
                         │   (broker)   │ ─────────────┐
                         └──────────────┘              ▼
                                                ┌──────────────┐
                                                │   Executor   │─► sandbox
                                                │ refuses w/o  │   workspace
                                                │ valid token  │   + audit log
                                                └──────────────┘
```

1. **Plan.** Type a task (e.g. *"Audit vercel/next.js, list its open
   issues, then create an issue with the summary, post a comment, and send
   a notification to the maintainers"*). A deterministic rule-table planner
   — no LLM required — decomposes it into steps and classifies each one
   `READ_ONLY` or `HIGH_IMPACT`.
2. **Investigate.** Read-only steps execute immediately against the real
   public GitHub API (repo info, open issues) with **no credentials at
   all**. An optional OpenAI-compatible LLM hook (`LLM_API_KEY`) can polish
   the plan summary; a deterministic summary is generated otherwise.
3. **Propose.** Each high-impact step becomes a queue entry showing the
   **exact payload** (service, operation, repo, title, body…) and its
   SHA-256 hash. Nothing has executed. Nothing can.
4. **Decide — asynchronously.** The human approves or vetoes whenever they
   get to it. A veto needs no reason (one is logged if given) and is
   **final**: no token will ever be issued for a vetoed action.
5. **Token issuance.** On approval — and only on approval — the vault
   broker mints an execution token that is:
   - **scoped** to exactly one action id,
   - **payload-bound**: it carries the SHA-256 of the approved payload, so
     editing the payload after approval invalidates the token,
   - **single-use**: burned on first presentation (replay is refused and
     audited),
   - **short-lived**: 120-second TTL.
   Only the token's hash is stored broker-side; the raw token is handed to
   the caller exactly once.
6. **Execute.** The executor has *no code path* that runs an action
   without consuming a valid token — no session, header, or "trusted
   caller" bypass. Every proposal, read, approval, veto, token issue,
   token rejection, and execution is written to the audit log with a
   timestamp.

## How this maps to Auth0 Token Vault & asynchronous authorization

| VetoAgent component | Production counterpart |
|---|---|
| Agent holds **no** GitHub credentials; reads are unauthenticated | Agent identity in Auth0; connected-account credentials live in **Token Vault**, never in the agent |
| Approval queue with exact payload | **CIBA** (Client-Initiated Backchannel Authentication) / Auth0 async authorization: the authorization request is decoupled from the agent's execution flow and answered out-of-band by the user |
| Broker mints a token only after approval | Token Vault exchanging the user's grant for the third-party provider's access token, at execution time only |
| Token bound to action id + payload hash | Scoped / audience-restricted tokens (RFC 8707 resource indicators, sender-constraining): the grant covers *this* operation on *this* resource with *these* parameters |
| 120 s TTL, single-use, hash-at-rest | Short-lived access tokens + replay protection |
| Veto = permanent, no override path | Denied authorization request — the grant simply never exists; there is nothing to steal or reuse |
| Audit log | Auth0 logs / SIEM trail for the whole grant lifecycle |

## Honest scope

- **Reads are real**: the public GitHub API, unauthenticated.
- **Writes execute against an in-app sandbox workspace**, not real GitHub
  issues/comments. This is deliberate: a public demo must never be able to
  spam a real service, and the sandbox records *exactly* what payload would
  have been sent. Replacing the sandbox with the real write API changes
  nothing about the planner, queue, vault, or executor gating — that is
  the point of the exercise.
- State is in-memory (single Node process) so the demo is trivial to run
  and inspect; a production deployment would persist the queue/audit and
  put the broker behind the identity provider.
- The planner is a transparent rule table, not a model. That is a feature
  for a security demo — classification decisions are auditable in
  `lib/planner.ts` — and the LLM hook is confined to prose summaries.

## Run it

```bash
npm install
npm run build
npm start            # http://localhost:3000
# or: npm run dev
```

Try the sample tasks on the landing page. A good first run: plan the
`vercel/next.js` audit, approve "Create an issue", watch the vault issue a
token, execute with it, then try replaying the same token or executing a
vetoed action and read the refusals in the audit log.

Optional: set `LLM_API_KEY` (plus `LLM_API_URL` / `LLM_MODEL`) to have an
OpenAI-compatible model write the plan summaries; everything else is
identical with zero keys.

## Layout

```
app/page.tsx                  landing + task form + queue + sandbox + audit UI
app/api/plan/route.ts         POST a task -> plan (+ immediate read-only steps)
app/api/state/route.ts        queue / sandbox / audit snapshot for the UI
app/api/actions/approve       human approval -> vault mints the token
app/api/actions/execute       redeems a token (403 on any violation)
app/api/actions/veto          human veto (final)
lib/planner.ts                deterministic decomposition + classification
lib/github.ts                 unauthenticated public GitHub reads
lib/vault.ts                  token broker: mint / validate-and-burn
lib/executor.ts               refuses to run without a valid token
lib/narrative.ts              optional LLM summary hook, deterministic fallback
lib/store.ts                  in-memory store + append-only audit log
```
