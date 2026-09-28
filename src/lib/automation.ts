import { z } from "zod";
import type { Company, Draft, Search, Settings } from "./types";
export const roles = ["research", "judge", "writer", "draft-judge"] as const;
export type Role = (typeof roles)[number];
export const roleLabels: Record<Role, string> = {
  research: "Internet research",
  judge: "Company secondary review",
  writer: "Outreach writing",
  "draft-judge": "Email secondary review",
};
const label = z.string().trim().min(1).max(150);
const text = z.string().trim().max(12000);
const identifier = z.string().max(100);
export const agentSchema = z.object({
  id: identifier.optional(),
  version: z.number().int().optional(),
  name: label,
  adapter: z.enum(["http", "external"]),
  endpoint: z.string().max(2000).default(""),
  tokenEnv: z
    .string()
    .regex(/^(DEALFINDER_AGENT_[A-Z0-9_]+)?$/)
    .default(""),
  provider: z.string().max(100).default(""),
  model: z.string().max(150).default(""),
  roles: z.array(z.enum(roles)).min(1),
  enabled: z.boolean().default(true),
});
export type AgentInput = z.infer<typeof agentSchema>;
export interface Agent extends Omit<AgentInput, "id" | "version"> {
  id: string;
  version: number;
  testedVersion?: number;
  webSearch?: boolean;
  dateFiltering?: boolean;
  lastSeen?: string;
  lastError?: string;
}
export const windowSchema = z.object({
  mode: z.enum(["all", "range", "rolling", "since-success"]).default("all"),
  from: z.string().default(""),
  to: z.string().default(""),
  days: z.number().int().min(1).max(3650).default(7),
});
export type ResearchWindow = z.infer<typeof windowSchema>;
export const runSchema = z.object({
  searchId: identifier.min(1),
  researchAgentId: identifier.default(""),
  judgeAgentId: identifier.default(""),
  writerAgentId: identifier.default(""),
  instructions: text.default(""),
  runAt: z.string().default(""),
  window: windowSchema,
  companyLimit: z.number().int().min(1).max(100).default(20),
  budgetUsd: z.number().min(0.01).max(10000).default(10),
});
export type RunInput = z.infer<typeof runSchema>;
export const scheduleSchema = z.object({
  searchId: identifier.min(1),
  version: z.number().int().optional(),
  enabled: z.boolean(),
  frequency: z.enum(["once", "daily", "weekly", "monthly", "cron"]),
  cron: z.string().max(100).default("0 9 * * 1"),
  timezone: z.string().min(1).max(100),
  startAt: z.string().min(1),
  endAt: z.string().default(""),
  config: runSchema.omit({ searchId: true, runAt: true }),
  nextOverride: z
    .object({
      instructions: text.optional(),
      researchAgentId: identifier.optional(),
      judgeAgentId: identifier.optional(),
      writerAgentId: identifier.optional(),
      window: windowSchema.optional(),
    })
    .nullable()
    .default(null),
});
export interface Schedule extends z.infer<typeof scheduleSchema> {
  version: number;
  nextAt: string | null;
  lastRunId?: string;
  lastError?: string;
  lastOccurrence?: string;
}
export const defaultsSchema = z.object({
  steps: z
    .partialRecord(
      z.enum(["searches", "companies", "review", "outreach"]),
      z.object({
        research: identifier.optional(),
        judge: identifier.optional(),
        writer: identifier.optional(),
        "draft-judge": identifier.optional(),
      }),
    )
    .optional(),
  research: identifier.default(""),
  judge: identifier.default(""),
  writer: identifier.default(""),
  "draft-judge": identifier.default(""),
  timezone: z.string().default("America/Los_Angeles"),
  companyLimit: z.number().int().min(1).max(100).default(20),
  budgetUsd: z.number().min(0.01).max(10000).default(10),
});
export type AgentDefaults = z.infer<typeof defaultsSchema>;
export interface Snapshot {
  search?: Search;
  company?: Company;
  draft?: Draft;
  sender?: Pick<
    Settings,
    "sender" | "senderRole" | "thesis" | "style" | "examples" | "outreach"
  >;
  window?: { from: string | null; to: string | null };
  prompt: string;
  instructions: string;
  companyLimit?: number;
  budgetUsd: number;
  judgeAgentId?: string;
  writerAgentId?: string;
  draftJudgeAgentId?: string;
  agent: Agent;
  regenerate?: boolean;
  activeDraftIds?: string[];
  activeDraftVersions?: { id: string; revision: number; status: string }[];
}
export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export interface Job {
  id: string;
  role: Role;
  agentId: string;
  status: JobStatus;
  searchId?: string;
  companyId?: string;
  draftId?: string;
  batchId?: string;
  scheduleId?: string;
  scheduleVersion?: number;
  trigger: string;
  actor: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  maxAttempts: number;
  leaseUntil?: string;
  workerId?: string;
  leaseToken?: string;
  error?: string;
  progress?: string;
  snapshot: Snapshot;
  result?: unknown;
  idempotencyKey: string;
  inputHash: string;
}
export interface JudgeReview {
  id: string;
  jobId: string;
  companyId: string;
  draftId?: string;
  memoVersion: number;
  draftRevision?: number;
  agentId: string;
  agentName: string;
  model: string;
  at: string;
  recommendation:
    "talking" | "reach-out" | "priority" | "pass" | "insufficient-evidence";
  rationale: string;
  concerns: string[];
  evidenceRefs: string[];
  uncertainty: string;
  stale: boolean;
}
export interface Batch {
  id: string;
  at: string;
  role: Role;
  jobIds: string[];
  skipped: { companyId: string; reason: string }[];
}
export type Scope = "read" | "searches" | "jobs" | "schedules" | "execute";
export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  agentIds: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
export interface AutomationState {
  agents: Agent[];
  defaults: AgentDefaults;
  schedules: Schedule[];
  jobs: Job[];
  reviews: JudgeReview[];
  batches: Batch[];
  keys: ApiKeyInfo[];
  schedulerHeartbeat?: string;
  workerHeartbeat?: string;
  events?: {
    id: string;
    actor: string;
    action: string;
    detail: string;
    at: string;
  }[];
}
export const httpUrl = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use an HTTP(S) URL without embedded credentials.");
export const researchResultSchema = z.object({
  companies: z
    .array(
      z.object({
        name: label,
        domain: label,
        category: label,
        geography: label,
        employees: z.number().int().nonnegative(),
        revenue: z.number().nonnegative().nullable(),
        description: text.min(1),
        customers: text,
        criticality: text.min(1),
        concern: text,
        evidence: z
          .array(
            z.object({
              title: label,
              url: httpUrl,
              detail: text.min(1),
              publishedAt: z.string().optional(),
            }),
          )
          .min(1)
          .max(30),
        qualificationNotes: text.default(""),
      }),
    )
    .max(100),
  costUsd: z.number().nonnegative(),
});
export const writerResultSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  costUsd: z.number().nonnegative(),
});
export const judgeResultSchema = z.object({
  recommendation: z.enum([
    "talking",
    "reach-out",
    "priority",
    "pass",
    "insufficient-evidence",
  ]),
  rationale: text.min(1),
  concerns: z.array(text).max(30),
  evidenceRefs: z.array(z.string().max(2000)).max(40),
  uncertainty: text,
  costUsd: z.number().nonnegative(),
});
