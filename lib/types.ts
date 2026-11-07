export type StepKind =
  | "FETCH_REPO"
  | "LIST_ISSUES"
  | "SUMMARIZE"
  | "CREATE_ISSUE"
  | "POST_COMMENT"
  | "SEND_NOTIFICATION"
  | "GENERIC_WRITE";

export type Classification = "READ_ONLY" | "HIGH_IMPACT";

export interface PlanStep {
  id: string;
  kind: StepKind;
  classification: Classification;
  title: string;
  detail: string;
  status: "DONE" | "QUEUED" | "INFO";
  result?: string;
}

export type ActionStatus =
  | "PENDING"
  | "APPROVED"
  | "EXECUTED"
  | "VETOED";

export interface VaultAction {
  id: string;
  planId: string;
  kind: StepKind;
  title: string;
  service: string;
  /** The exact payload the human approves. Bound to the execution token by hash. */
  payload: Record<string, unknown>;
  payloadHash: string;
  status: ActionStatus;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;
  vetoReason?: string;
  result?: string;
}

export type AuditType =
  | "PLAN_CREATED"
  | "READ_EXECUTED"
  | "ACTION_PROPOSED"
  | "APPROVED"
  | "VETOED"
  | "TOKEN_ISSUED"
  | "TOKEN_REJECTED"
  | "EXECUTED"
  | "EXECUTION_FAILED";

export interface AuditEvent {
  id: string;
  ts: string;
  type: AuditType;
  message: string;
  actionId?: string;
}

/** Something the executor "did" inside the demo sandbox workspace. */
export interface SandboxItem {
  id: string;
  ts: string;
  kind: StepKind;
  title: string;
  detail: string;
}

export interface Plan {
  id: string;
  task: string;
  repo: string | null;
  createdAt: string;
  summary: string;
  summarySource: "llm" | "rules";
  steps: PlanStep[];
}
