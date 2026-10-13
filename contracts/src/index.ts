import { z } from "zod";
export const CONTRACT_VERSION = 1 as const;
export const states = [
  "queued",
  "capturing",
  "reproducing",
  "diagnosing",
  "proposing",
  "verifying",
  "ready_for_review",
  "publishing",
  "pr_opened",
  "needs_input",
  "unsupported",
  "blocked",
  "failed",
  "cancelled",
  "rejected",
  "superseded",
] as const;
export type CaseState = (typeof states)[number];
export const terminal = new Set<CaseState>([
  "pr_opened",
  "needs_input",
  "unsupported",
  "blocked",
  "failed",
  "cancelled",
  "rejected",
  "superseded",
]);
export const transitions: Record<CaseState, readonly CaseState[]> = {
  queued: [
    "capturing",
    "cancelled",
    "blocked",
    "unsupported",
    "failed",
    "needs_input",
  ],
  capturing: [
    "reproducing",
    "needs_input",
    "unsupported",
    "blocked",
    "failed",
    "cancelled",
  ],
  reproducing: ["diagnosing", "needs_input", "blocked", "failed", "cancelled"],
  diagnosing: ["proposing", "needs_input", "blocked", "failed", "cancelled"],
  proposing: ["verifying", "failed", "blocked", "cancelled"],
  verifying: ["ready_for_review", "failed", "blocked", "cancelled"],
  ready_for_review: ["publishing", "rejected", "cancelled", "superseded"],
  publishing: [
    "pr_opened",
    "ready_for_review",
    "superseded",
    "failed",
    "cancelled",
    "blocked",
  ],
  pr_opened: [],
  needs_input: [],
  unsupported: [],
  blocked: [],
  failed: [],
  cancelled: [],
  rejected: [],
  superseded: [],
};
export const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const createCaseSchema = z
  .object({
    repositoryId: z.string().uuid(),
    branch: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9_./-]+$/),
    baseSha: sha,
    title: z.string().trim().min(4).max(180),
    behaviorContract: z.string().trim().max(4000).default(""),
    reproduction: z
      .object({
        kind: z.enum(["pytest", "ruff"]),
        test: z
          .string()
          .max(500)
          .regex(/^[a-zA-Z0-9_./:[\]-]*$/)
          .default(""),
      })
      .strict()
      .optional(),
    actionsRunId: z.number().int().positive().optional(),
  })
  .strict();
export type CreateCase = z.infer<typeof createCaseSchema>;
export type Check = {
  id: string;
  phase: "base" | "candidate" | "guard_base" | "guard_candidate" | "preflight";
  name: string;
  command: string;
  exitCode: number | null;
  collected: number | null;
  passed: boolean;
  outputHash: string;
  artifactId?: string;
  durationMs: number;
  reason?: string;
};
export type Proposal = {
  digest: string;
  rationale: string;
  diff: string;
  files: { path: string; baseHash: string; content: string }[];
  guard: {
    path: string;
    content: string;
    test: string;
    contract: string;
    paths: string[];
  } | null;
};
export type Case = {
  id: string;
  repository_id: string;
  title: string;
  state: CaseState;
  base_sha: string;
  branch: string;
  reason: string | null;
  cursor: number;
  created_at: string;
  updated_at: string;
  archived: boolean;
  data: {
    request: CreateCase;
    recipe?: Record<string, unknown>;
    checks?: Check[];
    proposal?: Proposal;
    approvedDigest?: string;
    prUrl?: string;
    sourceDigest?: string;
    [key: string]: unknown;
  };
};
export type CaseEvent = {
  version: 1;
  id: string;
  caseId: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
};
export const eventSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  caseId: z.string().uuid(),
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  type: z.string().max(80),
  payload: z.record(z.unknown()),
});
export type Repository = {
  id: string;
  full_name: string;
  default_branch: string;
  installation_id: number;
  connected: boolean;
};
export type Session = {
  user: { login: string; avatarUrl: string };
  csrf: string;
  tenantId: string;
} | null;
