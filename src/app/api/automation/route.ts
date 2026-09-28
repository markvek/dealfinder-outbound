import { z } from "zod";
import {
  authenticate,
  ApiError,
  requireOwner,
  requireScope,
  createKey,
  revokeKey,
  listKeys,
} from "@/server/automation/auth";
import {
  defaults,
  saveAgent,
  saveDefaults,
  testAgent,
  registerAgent,
} from "@/server/automation/agents";
import { docs, getDoc, jobs, job, audit } from "@/server/automation/repository";
import {
  enqueueSearch,
  enqueueBatch,
  enqueueDraftJudge,
  changeJob,
  claimJob,
  heartbeatJob,
  completeJob,
  failJob,
  reviewIsStale,
  checkRevision,
} from "@/server/automation/jobs";
import {
  saveSchedule,
  previewSchedule,
  tickSchedules,
} from "@/server/automation/schedules";
import {
  readWorkspace,
  database,
  saveWorkspace,
  mutateWorkspace,
} from "@/server/store";
import { actionSchema } from "@/server/workflow";
import type { Agent, JudgeReview } from "@/lib/automation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    },
    { status: e instanceof ApiError ? e.status : 400 },
  );
}
export async function GET(request: Request) {
  try {
    const actor = authenticate(request);
    requireScope(actor, "read");
    const workspace = readWorkspace();
    return Response.json(
      {
        workspace,
        agents: docs<Agent>("agents"),
        defaults: defaults(),
        schedules: docs("schedules"),
        jobs: jobs()
          .slice(0, 200)
          .map((j) => ({ ...j, leaseToken: undefined })),
        reviews: docs<JudgeReview>("judge_reviews").map((r) => ({
          ...r,
          stale: reviewIsStale(r, workspace),
        })),
        batches: docs("batches").slice(0, 100),
        keys: actor.browser ? listKeys() : [],
        events: actor.browser ? docs("automation_events").slice(0, 100) : [],
        schedulerHeartbeat: getDoc("automation_meta", "schedulerHeartbeat"),
        workerHeartbeat: getDoc("automation_meta", "workerHeartbeat"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = authenticate(request);
    const raw = await request.text();
    if (raw.length > 2000000) throw new ApiError("Request exceeds 2 MB.", 413);
    const { command, input, key, version } = z
      .object({
        command: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
        key: z.string().max(200).default(""),
        version: z.number().int().optional(),
      })
      .parse(JSON.parse(raw));
    const id = () => z.string().min(1).parse(input.id);
    let result: unknown;
    switch (command) {
      case "agent.save":
        result = saveAgent(actor, input);
        break;
      case "agent.test":
        result = await testAgent(actor, id());
        break;
      case "defaults.save":
        result = saveDefaults(actor, input);
        break;
      case "key.create":
        result = createKey(actor, input);
        break;
      case "key.revoke":
        result = revokeKey(actor, id());
        break;
      case "run.start":
        result = enqueueSearch(actor, input, key, version);
        break;
      case "batch.start":
        result = enqueueBatch(
          actor,
          z
            .object({
              companyIds: z.array(z.string()).min(1).max(100),
              role: z.enum(["writer", "judge"]),
              agentId: z.string().optional(),
              judgeAgentId: z.string().optional(),
              instructions: z.string().max(12000).optional(),
              budgetUsd: z.number().positive().max(10000).optional(),
              regenerate: z.boolean().optional(),
            })
            .parse(input),
          key,
          version,
        );
        break;
      case "draft.judge":
        result = enqueueDraftJudge(
          actor,
          z.string().parse(input.draftId),
          z.string().parse(input.agentId ?? ""),
          z
            .string()
            .max(12000)
            .parse(input.instructions ?? ""),
          key,
        );
        break;
      case "schedule.save":
        result = saveSchedule(actor, input);
        break;
      case "schedule.preview":
        requireScope(actor, "schedules");
        result = previewSchedule(input);
        break;
      case "schedule.tick":
        requireScope(actor, "schedules");
        result = tickSchedules();
        break;
      case "job.cancel":
      case "job.retry":
        result = changeJob(
          actor,
          id(),
          command === "job.cancel" ? "cancel" : "retry",
        );
        break;
      case "search.save":
      case "search.archive":
        requireScope(actor, "searches");
        result = mutateWorkspace(
          z.number().parse(version),
          actionSchema.parse({ ...input, type: command }),
        );
        break;
      case "company.agents":
        requireOwner(actor);
        result = database().transaction(() => {
          checkRevision(z.number().parse(version));
          const current = readWorkspace(),
            next = structuredClone(current);
          const c = next.companies.find((c) => c.id === id());
          if (!c) throw new ApiError("Company not found.", 404);
          for (const field of [
            "writerAgentId",
            "judgeAgentId",
            "draftJudgeAgentId",
          ] as const) {
            const value = z.string().parse(input[field] ?? "");
            const role =
              field === "writerAgentId"
                ? "writer"
                : field === "judgeAgentId"
                  ? "judge"
                  : "draft-judge";
            if (value && value !== "none") {
              const a = getDoc<Agent>("agents", value);
              if (!a?.enabled || !a.roles.includes(role))
                throw new ApiError("Agent does not support this role.");
            }
            c[field] = value;
          }
          audit(actor.id, "company.agents", c.id);
          return saveWorkspace(current, next);
        })();
        break;
      case "worker.register":
      case "worker.claim":
      case "worker.heartbeat":
      case "worker.complete":
      case "worker.fail": {
        requireScope(actor, "execute");
        if (actor.browser) throw new ApiError("Use an executor API key.", 403);
        if (command === "worker.register") {
          result = registerAgent(
            actor,
            z.string().parse(input.agentId),
            input.capabilities,
          );
          break;
        }
        if (command === "worker.claim") {
          const agentId = z.string().parse(input.agentId);
          if (!actor.agentIds.includes(agentId))
            throw new ApiError("Agent is outside this key’s permissions.", 403);
          result = claimJob(agentId, actor.id) ?? null;
          break;
        }
        const target = job(id());
        if (!target || !actor.agentIds.includes(target.agentId))
          throw new ApiError("Job is outside this key’s permissions.", 403);
        const token = z.string().parse(input.leaseToken);
        result =
          command === "worker.heartbeat"
            ? heartbeatJob(
                id(),
                token,
                actor.id,
                z.string().parse(input.progress ?? ""),
              )
            : command === "worker.complete"
              ? completeJob(id(), token, actor.id, input.result)
              : failJob(id(), token, actor.id, z.string().parse(input.error));
        break;
      }
      default:
        throw new ApiError("Unknown command.");
    }
    return Response.json({ result });
  } catch (e) {
    return failure(e);
  }
}
