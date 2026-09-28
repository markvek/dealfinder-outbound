import { CronExpressionParser } from "cron-parser";
import { database, readWorkspace } from "../store";
import { scheduleSchema, type Schedule, type Job } from "../../lib/automation";
import { wallTime, zonedParts } from "../../lib/dates";
import { ApiError, requireScope, type Actor } from "./auth";
import { audit, docs, getDoc, putDoc, jobs } from "./repository";
import { enqueueSearch } from "./jobs";
import { readyAgent, stepDefault } from "./agents";
export function validateSchedule(s: Schedule) {
  new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
  if (!Number.isFinite(Date.parse(s.startAt)))
    throw new ApiError("Choose a valid start date.");
  if (
    s.endAt &&
    (!Number.isFinite(Date.parse(s.endAt)) ||
      Date.parse(s.endAt) < Date.parse(s.startAt))
  )
    throw new ApiError("End date must follow the start date.");
  if (s.frequency !== "once") {
    if (s.cron.trim().split(/\s+/).length !== 5 || s.cron.includes("H"))
      throw new ApiError("Use a deterministic five-field cron expression.");
    CronExpressionParser.parse(s.cron, { tz: s.timezone });
  }
}
export function nextOccurrence(s: Schedule, after: string): string | null {
  if (s.frequency === "once")
    return Date.parse(s.startAt) > Date.parse(after) ? s.startAt : null;
  const date = new Date(Math.max(Date.parse(after), Date.parse(s.startAt) - 1));
  const expression = CronExpressionParser.parse(s.cron, {
    currentDate: date,
    tz: s.timezone,
  });
  // Cron-parser may shift a nonexistent hour forward; skip shifted wall times.
  for (let i = 0; i < 500; i++) {
    const candidate = expression.next().toDate(),
      p = zonedParts(candidate, s.timezone);
    if (s.endAt && +candidate > Date.parse(s.endAt)) return null;
    if (
      !expression.fields.hour.values.some((v) => v === Number(p.hour)) ||
      !expression.fields.minute.values.some((v) => v === Number(p.minute))
    )
      continue;
    if (
      s.lastOccurrence &&
      wallTime(candidate, s.timezone) === s.lastOccurrence
    )
      continue;
    return candidate.toISOString();
  }
  throw new ApiError("Could not determine a schedule occurrence.");
}
export function previewSchedule(input: unknown) {
  const parsed = scheduleSchema.parse(input);
  const s = {
    ...parsed,
    version: parsed.version ?? 1,
    nextAt: null,
  } as Schedule;
  validateSchedule(s);
  const out: string[] = [];
  let after = new Date(
    Math.max(Date.now(), Date.parse(s.startAt)) - 1,
  ).toISOString();
  for (let i = 0; i < 5; i++) {
    const next = nextOccurrence(s, after);
    if (!next) break;
    out.push(next);
    s.lastOccurrence = wallTime(next, s.timezone);
    after = next;
  }
  return out;
}
export function saveSchedule(actor: Actor, input: unknown) {
  requireScope(actor, "schedules");
  return database().transaction(() => {
    const parsed = scheduleSchema.parse(input);
    const state = readWorkspace(),
      search = state.searches.find((s) => s.id === parsed.searchId);
    if (!search) throw new ApiError("Search not found.");
    const old = getDoc<Schedule>("schedules", parsed.searchId);
    if (old && parsed.version !== old.version)
      throw new ApiError("Schedule changed. Refresh before saving.", 409);
    const record: Schedule = {
      ...parsed,
      version: (old?.version ?? 0) + 1,
      nextAt: null,
      lastRunId: old?.lastRunId,
    };
    validateSchedule(record);
    if (record.enabled) {
      if (search.status !== "active")
        throw new ApiError("Restore the search before enabling a schedule.");
      readyAgent(
        record.config.researchAgentId ||
          search.researchAgentId ||
          stepDefault("searches", "research"),
        "research",
        record.config.window.mode !== "all",
      );
      record.nextAt = nextOccurrence(
        record,
        new Date(
          Math.max(Date.now(), Date.parse(record.startAt)) - 1,
        ).toISOString(),
      );
      if (!record.nextAt)
        throw new ApiError("This schedule has no future occurrence.");
    }
    putDoc("schedules", record.searchId, record);
    audit(actor.id, "schedule.saved", record.searchId);
    return record;
  })();
}
export function tickSchedules(at = new Date()): {
  enqueued: number;
  errors: number;
} {
  return database().transaction(() => {
    putDoc("automation_meta", "schedulerHeartbeat", at.toISOString());
    let enqueued = 0,
      errors = 0;
    const actor: Actor = {
      id: "scheduler",
      browser: true,
      scopes: [],
      agentIds: [],
    };
    for (const s of docs<Schedule>("schedules")) {
      if (!s.enabled || !s.nextAt || Date.parse(s.nextAt) > +at) continue;
      const state = readWorkspace();
      if (state.searches.find((x) => x.id === s.searchId)?.status !== "active")
        continue;
      // Coalesce missed periods into one catch-up, wait while a queued follow-up exists.
      if (
        jobs().some(
          (j) =>
            j.searchId === s.searchId &&
            j.role === "research" &&
            ["queued", "running"].includes(j.status),
        )
      )
        continue;
      const due = s.nextAt,
        key = `schedule:${s.searchId}:${s.version}:${wallTime(due, s.timezone)}`;
      try {
        const config = {
          ...s.config,
          ...Object.fromEntries(
            Object.entries(s.nextOverride ?? {}).filter(
              ([, v]) => v !== undefined,
            ),
          ),
          instructions: [s.config.instructions, s.nextOverride?.instructions]
            .filter(Boolean)
            .join("\n\n"),
          searchId: s.searchId,
          runAt: at.toISOString(),
        };
        const queued = enqueueSearch(actor, config, key, undefined, {
          trigger: "schedule",
          scheduleId: s.searchId,
          scheduleVersion: s.version,
        }) as Job;
        s.lastRunId = queued.id;
        s.lastError = undefined;
        s.lastOccurrence = wallTime(due, s.timezone);
        s.nextOverride = null;
        s.nextAt = nextOccurrence(s, at.toISOString());
        if (!s.nextAt) s.enabled = false;
        putDoc("schedules", s.searchId, s);
        enqueued++;
      } catch (error) {
        s.lastError =
          error instanceof Error ? error.message : "Schedule failed";
        putDoc("schedules", s.searchId, s);
        errors++;
      }
    }
    return { enqueued, errors };
  })();
}
