import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createSeed } from "../src/lib/seed";
import { database, readWorkspace, mutateWorkspace } from "../src/server/store";
import {
  saveAgent,
  registerAgent,
  saveDefaults,
  testAgent,
} from "../src/server/automation/agents";
import {
  createKey,
  authenticate,
  revokeKey,
  requireScope,
  type Actor,
} from "../src/server/automation/auth";
import {
  enqueueSearch,
  enqueueBatch,
  claimJob,
  completeJob,
  heartbeatJob,
  recoverExpired,
  changeJob,
  enqueueDraftJudge,
  reviewIsStale,
  resolveWindow,
} from "../src/server/automation/jobs";
import {
  job,
  jobs,
  getDoc,
  putDoc,
  docs,
} from "../src/server/automation/repository";
import {
  saveSchedule,
  tickSchedules,
  nextOccurrence,
} from "../src/server/automation/schedules";
import { workerTick } from "../src/server/automation/worker";
import { zonedTimeToIso } from "../src/lib/dates";
import type { JudgeReview, Schedule } from "../src/lib/automation";
import { simplifyExamples } from "../src/server/migrations/examples";
import legacy from "../src/server/migrations/legacy-examples.json";
const dir = mkdtempSync(join(tmpdir(), "dealfinder-tests-"));
process.env.DEALFINDER_DB_PATH = join(dir, "test.sqlite");
const owner: Actor = { id: "browser", browser: true, scopes: [], agentIds: [] };
function setup() {
  const a = saveAgent(owner, {
    name: "Test executor",
    adapter: "external",
    roles: ["research", "writer", "judge", "draft-judge"],
  });
  registerAgent(
    { id: "executor", browser: false, scopes: ["execute"], agentIds: [a.id] },
    a.id,
    { roles: a.roles, webSearch: true, dateFiltering: true },
  );
  saveDefaults(owner, {
    research: a.id,
    writer: a.id,
    judge: a.id,
    "draft-judge": a.id,
  });
  return a.id;
}
function approve() {
  const s = readWorkspace();
  s.settings.sender = "Taylor";
  database().prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
  return mutateWorkspace(s.version, {
    type: "company.decision",
    id: "forgeworks",
    decision: "reach-out",
    notes: "Reviewed evidence",
  });
}
const run = {
  searchId: "industrial-software",
  window: { mode: "all" },
  judgeAgentId: "none",
};
const written = {
  subject: "Introduction",
  body: "Hi Sam, could we discuss the production planning workflow?",
  costUsd: 0.01,
};
const judged = {
  recommendation: "reach-out",
  rationale: "Relevant operations workflow.",
  concerns: ["Verify private-company scale"],
  evidenceRefs: [],
  uncertainty: "Scale is not independently verified.",
  costUsd: 0.01,
};
beforeEach(() => {
  for (const table of [
    "agents",
    "schedules",
    "jobs",
    "judge_reviews",
    "batches",
    "automation_meta",
    "api_keys",
    "automation_events",
    "submissions",
    "revisions",
  ])
    database().prepare(`DELETE FROM ${table}`).run();
  database()
    .prepare("UPDATE workspace SET body=?")
    .run(JSON.stringify(createSeed()));
});
after(() => {
  database().close();
  rmSync(dir, { recursive: true, force: true });
});
test("single example and migration preserve edited or referenced examples", () => {
  const seed = createSeed();
  assert.equal(seed.searches.length, 1);
  assert.equal(seed.companies.length, 1);
  assert.equal(seed.drafts.length, 0);
  const old = structuredClone(seed);
  old.companies.push(
    ...(legacy.companies.map((c) => ({
      ...c,
      discoveredAt: new Date().toISOString(),
    })) as typeof old.companies),
  );
  old.searches.push(
    ...(legacy.searches.map((s) => ({
      ...s,
      createdAt: new Date().toISOString(),
    })) as typeof old.searches),
  );
  assert.equal(simplifyExamples(old).companies.length, 1);
  old.companies[1].notes = "Keep this edited record";
  assert.equal(simplifyExamples(old).companies.length, 2);
});
test("search snapshots and idempotency, leases expire and stale leases cannot commit", () => {
  const agent = setup();
  const j = enqueueSearch(
    owner,
    { ...run, instructions: "Recent ownership changes" },
    "same",
  );
  assert.equal(
    enqueueSearch(
      owner,
      { ...run, instructions: "Recent ownership changes" },
      "same",
    ).id,
    j.id,
  );
  assert.throws(
    () => enqueueSearch(owner, { ...run, instructions: "Different" }, "same"),
    /different input/,
  );
  const first = claimJob(agent, "worker")!;
  assert.equal(first.id, j.id);
  assert.equal(claimJob(agent, "other"), undefined);
  heartbeatJob(j.id, first.leaseToken!, "worker", "Researching");
  recoverExpired(Date.now() + 121000);
  const retry = claimJob(agent, "worker-2")!;
  assert.equal(retry.attempt, 2);
  assert.throws(
    () =>
      completeJob(j.id, first.leaseToken!, "worker", {
        companies: [],
        costUsd: 0,
      }),
    /lease/,
  );
  completeJob(j.id, retry.leaseToken!, "worker-2", {
    companies: [],
    costUsd: 0,
  });
  assert.equal(job(j.id)?.status, "succeeded");
});
test("human decision change during writer execution discards result and suppresses future batches", () => {
  const agent = setup();
  approve();
  const b = enqueueBatch(
    owner,
    { companyIds: ["forgeworks"], role: "writer" },
    "write",
  );
  const lease = claimJob(agent, "worker")!;
  mutateWorkspace(readWorkspace().version, {
    type: "company.decision",
    id: "forgeworks",
    decision: "talking",
    notes: "Existing contact",
  });
  completeJob(lease.id, lease.leaseToken!, "worker", written);
  assert.equal(job(b.jobIds[0])?.status, "skipped");
  assert.equal(readWorkspace().drafts.length, 0);
  assert.equal(
    enqueueBatch(owner, { companyIds: ["forgeworks"], role: "writer" }, "again")
      .skipped.length,
    1,
  );
});
test("research deduplicates domains, qualifies conservatively, and creates advisory review", () => {
  const agent = setup();
  enqueueSearch(owner, { ...run, judgeAgentId: agent }, "discover");
  const lease = claimJob(agent, "worker")!;
  const candidate = {
    name: "Research Example",
    domain: "research.example",
    category: "Industrial software",
    geography: "United States",
    employees: 100,
    revenue: 80,
    description: "Production scheduling software.",
    customers: "Manufacturers",
    criticality: "Daily scheduling",
    concern: "Private estimates",
    evidence: [
      {
        title: "Product",
        url: "https://research.example/product",
        detail: "Scheduling systems",
      },
    ],
  };
  completeJob(lease.id, lease.leaseToken!, "worker", {
    companies: [
      candidate,
      { ...candidate, domain: "https://www.research.example/product" },
    ],
    costUsd: 1,
  });
  assert.equal(readWorkspace().companies.length, 2);
  const c = readWorkspace().companies.find(
    (c) => c.domain === "research.example",
  )!;
  assert.equal(c.qualification, "Uncertain");
  const judge = claimJob(agent, "worker")!;
  assert.equal(judge.role, "judge");
  completeJob(judge.id, judge.leaseToken!, "worker", {
    ...judged,
    evidenceRefs: ["https://research.example/product"],
  });
  assert.equal(
    readWorkspace().companies.find((x) => x.id === c.id)?.decision,
    undefined,
  );
  assert.equal(docs<JudgeReview>("judge_reviews").length, 1);
});
test("writing and draft judging retain revisions; edited drafts make advisory findings stale", () => {
  const agent = setup();
  approve();
  enqueueBatch(owner, { companyIds: ["forgeworks"], role: "writer" }, "write");
  const w = claimJob(agent, "worker")!;
  completeJob(w.id, w.leaseToken!, "worker", written);
  const draft = readWorkspace().drafts[0];
  assert.equal(draft.status, "draft");
  const j = claimJob(agent, "worker")!;
  assert.equal(j.role, "draft-judge");
  completeJob(j.id, j.leaseToken!, "worker", judged);
  const review = docs<JudgeReview>("judge_reviews")[0];
  assert.equal(reviewIsStale(review, readWorkspace()), false);
  mutateWorkspace(readWorkspace().version, {
    type: "draft.save",
    id: draft.id,
    subject: "Changed",
    body: "Changed body",
    recipient: "",
  });
  assert.equal(reviewIsStale(review, readWorkspace()), true);
  enqueueDraftJudge(owner, draft.id, agent, "", "judge-again");
  const next = claimJob(agent, "worker")!;
  changeJob(owner, next.id, "cancel");
  assert.throws(
    () => completeJob(next.id, next.leaseToken!, "worker", judged),
    /lease/,
  );
});
test("API keys are hashed, scoped, expiring, revocable, and cannot mutate browser workflow", () => {
  const agent = setup();
  const issued = createKey(owner, {
    name: "Reader",
    days: 1,
    scopes: ["read"],
    agentIds: [],
  });
  const rows = database().prepare("SELECT * FROM api_keys").all();
  assert.ok(!JSON.stringify(rows).includes(issued.token));
  const req = () =>
    new Request("http://127.0.0.1:55210/api/automation", {
      headers: { Authorization: `Bearer ${issued.token}` },
    });
  const actor = authenticate(req());
  assert.throws(() => requireScope(actor, "jobs"), /Missing permission/);
  assert.throws(
    () =>
      createKey(actor, {
        name: "Escalate",
        scopes: ["execute"],
        agentIds: [agent],
      }),
    /owner/,
  );
  revokeKey(owner, issued.key.id);
  assert.throws(() => authenticate(req()), /expired or revoked/);
  assert.throws(
    () =>
      authenticate(
        new Request("http://127.0.0.1:55210/api/automation", {
          method: "POST",
        }),
      ),
    /same-origin/,
  );
});
test("schedules coalesce downtime once, preserve recurring prompt, and consume next-only overlay", () => {
  setup();
  const schedule = saveSchedule(owner, {
    searchId: run.searchId,
    enabled: true,
    frequency: "daily",
    cron: "0 9 * * *",
    timezone: "America/Los_Angeles",
    startAt: new Date(Date.now() + 86400000).toISOString(),
    config: {
      window: { mode: "since-success" },
      instructions: "Recurring instruction",
    },
    nextOverride: { instructions: "One time instruction" },
  });
  schedule.nextAt = new Date(Date.now() - 3 * 86400000).toISOString();
  putDoc("schedules", schedule.searchId, schedule);
  assert.equal(tickSchedules().enqueued, 1);
  assert.equal(tickSchedules().enqueued, 0);
  assert.equal(jobs().length, 1);
  assert.match(
    jobs()[0].snapshot.instructions,
    /Recurring instruction\n\nOne time instruction/,
  );
  assert.equal(
    getDoc<Schedule>("schedules", schedule.searchId)?.nextOverride,
    null,
  );
});
test("date ranges, daylight saving gaps and repeated hours have deterministic behavior", () => {
  assert.throws(
    () => zonedTimeToIso("2026-03-08T02:30", "America/Los_Angeles"),
    /does not exist/,
  );
  const s = {
    frequency: "daily",
    cron: "30 2 * * *",
    timezone: "America/Los_Angeles",
    startAt: "2026-03-01T00:00:00Z",
    endAt: "",
  } as Schedule;
  assert.equal(
    nextOccurrence(s, "2026-03-08T00:00:00Z"),
    "2026-03-09T09:30:00.000Z",
  );
  const fall = { ...s, cron: "30 1 * * *", lastOccurrence: "2026-11-01T01:30" };
  assert.equal(
    nextOccurrence(fall, "2026-11-01T08:30:00Z"),
    "2026-11-02T09:30:00.000Z",
  );
  assert.deepEqual(
    resolveWindow(
      { mode: "range", from: "2026-09-01", to: "2026-09-02", days: 7 },
      new Date().toISOString(),
      run.searchId,
    ),
    { from: "2026-09-01T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" },
  );
});
test("HTTP agent capability check and real worker dispatch apply validated output", async () => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const data = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        data.operation === "capabilities"
          ? { roles: ["research"], webSearch: true, dateFiltering: true }
          : { companies: [], costUsd: 0 },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const address = server.address() as { port: number };
    const endpoint = `http://127.0.0.1:${address.port}`;
    process.env.DEALFINDER_CONNECTION_ORIGINS = endpoint;
    const a = saveAgent(owner, {
      name: "HTTP test",
      adapter: "http",
      endpoint,
      roles: ["research"],
    });
    await testAgent(owner, a.id);
    const j = enqueueSearch(owner, { ...run, researchAgentId: a.id }, "http");
    assert.equal((await workerTick()).processed, 1);
    assert.equal(job(j.id)?.status, "succeeded");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("regeneration cannot supersede a draft edited after the job was queued", () => {
  const agent = setup();
  approve();
  enqueueBatch(
    owner,
    { companyIds: ["forgeworks"], role: "writer", judgeAgentId: "none" },
    "first",
  );
  const first = claimJob(agent, "worker")!;
  completeJob(first.id, first.leaseToken!, "worker", written);
  const original = readWorkspace().drafts[0];
  enqueueBatch(
    owner,
    {
      companyIds: ["forgeworks"],
      role: "writer",
      judgeAgentId: "none",
      regenerate: true,
    },
    "regenerate",
  );
  const next = claimJob(agent, "worker")!;
  mutateWorkspace(readWorkspace().version, {
    type: "draft.save",
    id: original.id,
    subject: "Human edit",
    body: "Preserve this edit.",
    recipient: "",
  });
  completeJob(next.id, next.leaseToken!, "worker", written);
  assert.equal(job(next.id)?.status, "skipped");
  assert.equal(readWorkspace().drafts.length, 1);
  assert.equal(readWorkspace().drafts[0].subject, "Human edit");
});

test("step agent defaults and company overrides select the intended writer", () => {
  const first = setup();
  const second = saveAgent(owner, {
    name: "Alternate writer",
    adapter: "external",
    roles: ["writer"],
  });
  registerAgent(
    {
      id: "executor2",
      browser: false,
      scopes: ["execute"],
      agentIds: [second.id],
    },
    second.id,
    { roles: ["writer"] },
  );
  saveDefaults(owner, {
    writer: first,
    steps: { outreach: { writer: second.id } },
  });
  approve();
  const batch = enqueueBatch(
    owner,
    { companyIds: ["forgeworks"], role: "writer" },
    "override",
  );
  assert.equal(job(batch.jobIds[0])?.agentId, second.id);
  assert.equal(claimJob(first, "worker"), undefined);
  assert.equal(claimJob(second.id, "worker")?.role, "writer");
});

test("budgets and invalid evidence are rejected without applying partial results", () => {
  const agent = setup();
  enqueueSearch(owner, { ...run, budgetUsd: 0.5 }, "limited");
  const claim = claimJob(agent, "worker")!;
  assert.throws(
    () =>
      completeJob(claim.id, claim.leaseToken!, "worker", {
        companies: [],
        costUsd: 1,
      }),
    /budget/,
  );
  assert.equal(job(claim.id)?.status, "running");
  assert.equal(readWorkspace().companies.length, 1);
  changeJob(owner, claim.id, "cancel");
  enqueueBatch(owner, { companyIds: ["forgeworks"], role: "judge" }, "judge");
  const judge = claimJob(agent, "worker")!;
  assert.throws(
    () =>
      completeJob(judge.id, judge.leaseToken!, "worker", {
        ...judged,
        evidenceRefs: ["https://invented.example"],
      }),
    /outside the supplied memo/,
  );
  assert.equal(docs("judge_reviews").length, 0);
});

test("one unavailable company override does not roll back other batch jobs", () => {
  setup();
  approve();
  const state = readWorkspace();
  state.companies.push({
    ...structuredClone(state.companies[0]),
    id: "second",
    domain: "second.example",
    name: "Second",
    writerAgentId: "unavailable-agent",
  });
  database().prepare("UPDATE workspace SET body=?").run(JSON.stringify(state));
  const batch = enqueueBatch(
    owner,
    {
      companyIds: ["forgeworks", "second"],
      role: "writer",
      judgeAgentId: "none",
    },
    "partial",
  );
  assert.equal(batch.jobIds.length, 1);
  assert.equal(batch.skipped.length, 1);
  assert.equal(batch.skipped[0].companyId, "second");
  assert.equal(job(batch.jobIds[0])?.companyId, "forgeworks");
});
