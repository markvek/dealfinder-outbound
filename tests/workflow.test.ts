import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/lib/seed";
import { transition, eligible, actionSchema } from "../src/server/workflow";

function approvedCompany() {
  const seed = createSeed();
  seed.settings.sender = "Test Reviewer";
  return transition(seed, {
    type: "company.decision",
    id: "forgeworks",
    decision: "reach-out",
    notes: "Embedded production workflow.",
  });
}
test("uncertain companies remain reviewable and every decision has a memo version and actor", () => {
  const seed = createSeed();
  seed.companies[0].id = "meridian";
  seed.companies[0].qualification = "Uncertain";
  const state = transition(seed, {
    type: "company.decision",
    id: "meridian",
    decision: "priority",
    notes: "Verify scale before outreach.",
  });
  assert.equal(
    state.companies.find((c) => c.id === "meridian")?.qualification,
    "Uncertain",
  );
  assert.equal(state.history[0].reviewer, "Local reviewer");
  assert.match(state.history[0].detail, /Memo v1/);
  assert.equal(eligible(state, "meridian"), true);
});
test("already-talking suppresses the domain across searches and invalidates existing drafts", () => {
  let state = transition(approvedCompany(), {
    type: "draft.create",
    id: "forgeworks",
  });
  state.companies.push({
    ...state.companies[0],
    id: "duplicate",
    searchId: "business-services",
  });
  state = transition(state, {
    type: "company.decision",
    id: "duplicate",
    decision: "talking",
    notes: "",
  });
  assert.equal(eligible(state, "forgeworks"), false);
  assert.equal(state.drafts[0].status, "rejected");
  assert.throws(
    () => transition(state, { type: "draft.create", id: "forgeworks" }),
    /eligible|Approve/,
  );
});
test("exact-revision approval is invalidated when an email changes", () => {
  let state = transition(approvedCompany(), {
    type: "draft.create",
    id: "forgeworks",
  });
  const id = state.drafts[0].id;
  assert.throws(
    () => transition(state, { type: "draft.approve", id }),
    /placeholders/,
  );
  state = transition(state, {
    type: "draft.save",
    id,
    subject: "A conversation",
    body: "Hi Sam,\nCould we discuss your production software?",
    recipient: "sam@example.com",
  });
  state = transition(state, { type: "draft.approve", id });
  assert.equal(state.drafts[0].approvedRevision, 2);
  state = transition(state, {
    type: "draft.save",
    id,
    subject: "A revised conversation",
    body: "Hi Sam,\nCould we speak next week?",
    recipient: "sam@example.com",
  });
  assert.equal(state.drafts[0].status, "draft");
  assert.equal(state.drafts[0].approvedRevision, undefined);
  assert.throws(
    () => transition(state, { type: "draft.handoff", id }),
    /Approve/,
  );
});
test("stop decisions invalidate approvals and sample handoffs are blocked", () => {
  let state = transition(approvedCompany(), {
    type: "draft.create",
    id: "forgeworks",
  });
  const id = state.drafts[0].id;
  state = transition(state, {
    type: "draft.save",
    id,
    subject: "Hello",
    body: "Hello Sam",
    recipient: "sam@example.com",
  });
  state = transition(state, { type: "draft.approve", id });
  assert.throws(
    () => transition(state, { type: "draft.handoff", id }),
    /Sample/,
  );
  state = transition(state, {
    type: "company.decision",
    id: "forgeworks",
    decision: "pass",
    notes: "Not a fit.",
  });
  assert.equal(state.drafts[0].status, "rejected");
  assert.throws(
    () => transition(state, { type: "draft.approve", id }),
    /no longer eligible/,
  );
});
test("hard failures cannot be approved, and notes are enforced when configured", () => {
  const seed = createSeed();
  seed.companies[0].qualification = "Fail";
  assert.throws(
    () =>
      transition(seed, {
        type: "company.decision",
        id: "forgeworks",
        decision: "priority",
        notes: "",
      }),
    /failed company/,
  );
  seed.settings.review.requireNotes = true;
  assert.throws(
    () =>
      transition(seed, {
        type: "company.decision",
        id: "forgeworks",
        decision: "pass",
        notes: "",
      }),
    /Add a note/,
  );
});
test("search requests retain versions and duplicate pending requests are rejected", () => {
  let state = transition(createSeed(), {
    type: "search.run",
    id: "industrial-software",
  });
  assert.equal(state.runs[0].searchVersion, 1);
  assert.throws(
    () => transition(state, { type: "search.run", id: "industrial-software" }),
    /already waiting/,
  );
  state = transition(state, {
    type: "search.save",
    search: { ...state.searches[0], employees: 100 },
  });
  assert.equal(state.searches[0].version, 2);
  assert.equal(state.runs[0].searchVersion, 1);
});
test("normalization blocks repeat domains in a search and incomplete qualification remains uncertain", () => {
  const company = {
    searchId: "industrial-software",
    name: "Acme",
    domain: "https://www.ACME.com/products",
    category: "Industrial software",
    geography: "United States",
    employees: 100,
    revenue: 80,
    description: "Operational infrastructure",
    customers: "",
    criticality: "Dispatch and billing",
    concern: "",
    source: "https://acme.com/product",
  };
  const state = transition(createSeed(), { type: "company.add", company });
  assert.equal(state.companies[0].domain, "acme.com");
  assert.equal(state.companies[0].qualification, "Uncertain");
  assert.throws(
    () =>
      transition(state, {
        type: "company.add",
        company: { ...company, domain: "acme.com" },
      }),
    /already exists/,
  );
  const failed = transition(createSeed(), {
    type: "company.add",
    company: { ...company, employees: 20 },
  });
  assert.equal(failed.companies[0].qualification, "Fail");
});
test("memo changes prevent old draft approval and raw requests validate email addresses", () => {
  const state = transition(approvedCompany(), {
    type: "draft.create",
    id: "forgeworks",
  });
  state.companies.find((c) => c.id === "forgeworks")!.memoVersion++;
  assert.throws(
    () => transition(state, { type: "draft.approve", id: state.drafts[0].id }),
    /memo or decision has changed/,
  );
  assert.equal(
    actionSchema.safeParse({
      type: "draft.save",
      id: "x",
      subject: "Hi",
      body: "Hi",
      recipient: "not-email",
    }).success,
    false,
  );
});
