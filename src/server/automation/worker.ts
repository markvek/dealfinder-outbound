import { randomUUID } from "node:crypto";
import { database } from "../store";
import type { Agent } from "../../lib/automation";
import { callHttpAgent } from "./agents";
import { docs, job, putDoc } from "./repository";
import {
  claimJob,
  completeJob,
  failJob,
  heartbeatJob,
  recoverExpired,
} from "./jobs";
export async function workerTick() {
  putDoc("automation_meta", "workerHeartbeat", new Date().toISOString());
  database().transaction(() => recoverExpired())();
  const agents = docs<Agent>("agents").filter(
    (a) => a.enabled && a.adapter === "http",
  );
  for (const agent of agents) {
    const workerId = `http-worker:${process.pid}:${randomUUID()}`;
    const claimed = claimJob(agent.id, workerId);
    if (!claimed) continue;
    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    const heartbeat = setInterval(() => {
      try {
        heartbeatJob(
          claimed.id,
          claimed.leaseToken!,
          workerId,
          "Agent executing",
        );
      } catch {
        controller.abort();
      }
    }, 30000);
    try {
      const result = await callHttpAgent(
        claimed.snapshot.agent,
        {
          operation: "execute",
          protocol: "dealfinder-agent-v1",
          jobId: claimed.id,
          attempt: claimed.attempt,
          idempotencyKey: claimed.idempotencyKey,
          role: claimed.role,
          input: claimed.snapshot,
        },
        controller.signal,
      );
      completeJob(claimed.id, claimed.leaseToken!, workerId, result);
    } catch (error) {
      if (job(claimed.id)?.status === "running") {
        try {
          failJob(
            claimed.id,
            claimed.leaseToken!,
            workerId,
            error instanceof Error && error.name === "ApiError"
              ? error.message
              : "Agent execution failed or returned an invalid result. Check the executor and retry.",
          );
        } catch {
          /* Lease expired or job cancelled. */
        }
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(hardTimeout);
    }
    return { processed: 1 };
  }
  return { processed: 0 };
}
