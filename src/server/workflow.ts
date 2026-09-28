import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workspace, Decision } from "../lib/types";
import { decisionLabels } from "../lib/types";

const short = z.string().trim().max(300);
const text = z.string().trim().max(20000);
const tags = z.array(z.string().trim().min(1).max(200)).max(30);
export const searchInput = z.object({
  id: short.optional(),
  name: short.min(1),
  description: text,
  employees: z.number().int().min(0).max(10000000),
  revenue: z.number().min(0).max(1000000),
  metric: z.enum(["Revenue", "ARR"]),
  geography: tags.min(1),
  categories: tags.min(1),
  exclusions: tags,
  sources: tags,
  domains: tags,
  ownership: short,
  companyType: short,
  dealSize: short,
  basePrompt: text.optional(),
  researchAgentId: short.optional(),
  judgeAgentId: short.optional(),
  writerAgentId: short.optional(),
});
export const settingsInput = z.object({
  workspace: short.min(1),
  reviewer: short.min(1),
  sender: short,
  senderRole: short,
  thesis: text,
  style: text,
  examples: text,
  connection: z.object({
    name: short.min(1),
    type: z.enum(["mcp", "api"]),
    endpoint: z.union([z.literal(""), z.url().max(2000)]),
    auth: z.enum(["none", "bearer"]),
  }),
  searches: z.object({
    defaultEmployees: z.number().int().min(0).max(10000000),
    defaultRevenue: z.number().min(0).max(1000000),
    defaultMetric: z.enum(["Revenue", "ARR"]),
  }),
  companies: z.object({
    freshnessDays: z.number().int().min(1).max(365),
    showUncertain: z.boolean(),
  }),
  review: z.object({
    defaultView: z.enum(["pending", "all"]),
    requireNotes: z.boolean(),
  }),
  outreach: z.object({ signoff: short, subjectPrefix: short }),
});
const id = z.string().min(1).max(100);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("search.save"), search: searchInput }),
  z.object({ type: z.literal("search.archive"), id }),
  z.object({ type: z.literal("search.run"), id }),
  z.object({
    type: z.literal("company.add"),
    company: z.object({
      searchId: id,
      name: short.min(1),
      domain: short.min(1),
      category: short.min(1),
      geography: short.min(1),
      employees: z.number().int().min(0),
      revenue: z.number().min(0).nullable(),
      description: text.min(1),
      customers: text,
      criticality: text.min(1),
      concern: text,
      source: z.url().max(2000),
    }),
  }),
  z.object({
    type: z.literal("company.decision"),
    id,
    decision: z.enum(["talking", "reach-out", "priority", "pass"]),
    notes: text,
  }),
  z.object({ type: z.literal("draft.create"), id }),
  z.object({
    type: z.literal("draft.save"),
    id,
    subject: short.min(1),
    body: text.min(1),
    recipient: z.union([z.literal(""), z.email()]),
  }),
  z.object({ type: z.literal("draft.approve"), id }),
  z.object({ type: z.literal("draft.reject"), id }),
  z.object({ type: z.literal("draft.handoff"), id }),
  z.object({ type: z.literal("settings.save"), settings: settingsInput }),
]);
export type Action = z.infer<typeof actionSchema>;
export class WorkflowError extends Error {}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkflowError(message);
}
export function eligible(state: Workspace, companyId: string) {
  const company = state.companies.find((c) => c.id === companyId);
  return (
    !!company &&
    ["reach-out", "priority"].includes(company.decision ?? "") &&
    company.qualification !== "Fail" &&
    !state.companies.some(
      (c) => c.domain === company.domain && c.decision === "talking",
    )
  );
}
export function transition(current: Workspace, action: Action): Workspace {
  const state = structuredClone(current);
  const at = new Date().toISOString();
  const event = (title: string, detail: string, companyId?: string) =>
    state.history.unshift({
      id: randomUUID(),
      title,
      detail,
      companyId,
      at,
      reviewer: state.settings.reviewer,
    });
  if (action.type === "settings.save") {
    state.settings = action.settings;
    event("Settings updated", "Workspace preferences saved.");
  } else if (action.type === "search.save") {
    const existing = state.searches.find((s) => s.id === action.search.id);
    assert(!action.search.id || existing, "Search no longer exists.");
    const record = {
      ...action.search,
      id: existing?.id ?? randomUUID(),
      status: existing?.status ?? ("active" as const),
      createdAt: existing?.createdAt ?? at,
      version: (existing?.version ?? 0) + 1,
    };
    if (existing) state.searches[state.searches.indexOf(existing)] = record;
    else state.searches.unshift(record);
    event(
      existing ? "Search updated" : "Search created",
      `${record.name} · version ${record.version}`,
    );
  } else if (action.type === "search.archive" || action.type === "search.run") {
    const search = state.searches.find((s) => s.id === action.id);
    assert(search, "Search not found.");
    if (action.type === "search.archive") {
      search.status = search.status === "active" ? "past" : "active";
      event(
        search.status === "past" ? "Search archived" : "Search restored",
        search.name,
      );
    } else {
      assert(
        search.status === "active",
        "Restore this search before starting a run.",
      );
      assert(
        !state.runs.some(
          (r) =>
            r.searchId === search.id &&
            r.searchVersion === search.version &&
            r.status === "awaiting-provider",
        ),
        "This search version is already waiting for a research provider.",
      );
      state.runs.unshift({
        id: randomUUID(),
        searchId: search.id,
        searchVersion: search.version,
        at,
        status: "awaiting-provider",
        detail:
          "Saved for live research. A discovery provider must be wired to the workflow before this run can execute.",
      });
      event(
        "Search run requested",
        `${search.name} · awaiting research provider`,
      );
    }
  } else if (action.type === "company.add") {
    const input = action.company;
    const search = state.searches.find((s) => s.id === input.searchId);
    assert(search, "Choose an existing search.");
    let url: URL;
    try {
      url = new URL(
        input.domain.includes("://") ? input.domain : `https://${input.domain}`,
      );
    } catch {
      throw new WorkflowError("Enter a valid company domain.");
    }
    assert(
      ["http:", "https:"].includes(url.protocol) &&
        url.hostname.includes(".") &&
        !url.username &&
        !url.password,
      "Enter a valid company website.",
    );
    assert(
      ["http:", "https:"].includes(new URL(input.source).protocol),
      "Evidence must link to an HTTP or HTTPS page.",
    );
    const domain = url.hostname.toLowerCase().replace(/^www\./, "");
    assert(
      !state.companies.some(
        (c) => c.domain === domain && c.searchId === search.id,
      ),
      "This company already exists in this search.",
    );
    const fails =
      (input.employees > 0 && input.employees < search.employees) ||
      (input.revenue !== null && input.revenue < search.revenue) ||
      !search.geography.some(
        (g) => g.toLowerCase() === input.geography.toLowerCase(),
      ) ||
      !search.categories.some(
        (c) => c.toLowerCase() === input.category.toLowerCase(),
      );
    const company = {
      ...input,
      id: randomUUID(),
      domain,
      initials: input.name.slice(0, 2).toUpperCase(),
      color: "blue",
      qualification: fails ? ("Fail" as const) : ("Uncertain" as const),
      evidence: [
        {
          title: "Reviewer-provided source",
          url: input.source,
          detail: input.description,
        },
      ],
      memoVersion: 1,
      notes: "",
      discoveredAt: at,
      sample: false,
    };
    state.companies.unshift(company);
    event(
      "Company added",
      fails
        ? "One or more hard filters fail."
        : "Manual research saved; ownership and scale evidence still need verification.",
      company.id,
    );
  } else if (action.type === "company.decision") {
    const company = state.companies.find((c) => c.id === action.id);
    assert(company, "Company not found.");
    assert(
      company.qualification !== "Fail" ||
        ["pass", "talking"].includes(action.decision),
      "A failed company cannot be approved for outreach.",
    );
    assert(
      !state.settings.review.requireNotes || action.notes.trim(),
      "Add a note before recording this decision.",
    );
    assert(
      !["reach-out", "priority"].includes(action.decision) ||
        !state.companies.some(
          (c) =>
            c.id !== company.id &&
            c.domain === company.domain &&
            c.decision === "talking",
        ),
      "This company is already being pursued in another search.",
    );
    const previous = company.decision;
    company.decision = action.decision;
    company.notes = action.notes;
    if (previous !== action.decision)
      for (const draft of state.drafts) {
        const related = state.companies.find((c) => c.id === draft.companyId);
        if (
          draft.companyId === company.id ||
          (action.decision === "talking" && related?.domain === company.domain)
        ) {
          if (draft.status !== "handed-off") {
            draft.status = "rejected";
            draft.approvedRevision = undefined;
          }
        }
      }
    event(
      decisionLabels[action.decision],
      `Memo v${company.memoVersion}${previous ? ` · previously ${decisionLabels[previous]}` : ""}${action.notes ? ` · ${action.notes}` : ""}`,
      company.id,
    );
  } else if (action.type === "draft.create") {
    const company = state.companies.find((c) => c.id === action.id);
    assert(
      company && eligible(state, company.id),
      "Approve this company for outreach first. Already-talking companies are suppressed.",
    );
    assert(
      !state.drafts.some(
        (d) =>
          d.companyId === company.id &&
          ["draft", "approved"].includes(d.status),
      ),
      "An active draft already exists for this company.",
    );
    assert(
      state.settings.sender.trim(),
      "Add your sender name in General Settings before creating a draft.",
    );
    const priority = company.decision === "priority";
    const body = [
      "Hi [first name],",
      `I’m reaching out about ${company.name}. ${company.description}`,
      priority
        ? `What stood out to me is how the business supports its customers: ${company.criticality}`
        : `The role you play in your customers’ operations caught my attention. ${company.criticality}`,
      state.settings.thesis,
      "Would you be open to a brief conversation about the business and your plans for the next few years?",
      `${state.settings.outreach.signoff}\n${state.settings.sender}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    state.drafts.unshift({
      id: randomUUID(),
      companyId: company.id,
      subject: `${state.settings.outreach.subjectPrefix}${company.name} — a conversation`,
      body,
      recipient: "",
      status: "draft",
      revision: 1,
      memoVersion: company.memoVersion,
      decision: company.decision as Decision,
      updatedAt: at,
    });
    event(
      "Draft prepared",
      "Editable starter template from the approved memo; no AI generation or new research.",
      company.id,
    );
  } else {
    const draft = state.drafts.find((d) => d.id === action.id);
    assert(draft, "Draft not found.");
    const company = state.companies.find((c) => c.id === draft.companyId);
    assert(
      company && eligible(state, company.id),
      "This company is no longer eligible for outreach.",
    );
    assert(
      draft.memoVersion === company.memoVersion &&
        draft.decision === company.decision,
      "The approved memo or decision has changed. Create a fresh draft.",
    );
    assert(
      draft.status !== "handed-off",
      "A handed-off revision is preserved as history.",
    );
    if (action.type === "draft.save") {
      draft.subject = action.subject;
      draft.body = action.body;
      draft.recipient = action.recipient;
      draft.revision++;
      draft.status = "draft";
      draft.approvedRevision = undefined;
      event(
        "Draft edited",
        `Revision ${draft.revision} · approval required`,
        company.id,
      );
    } else if (action.type === "draft.approve") {
      assert(draft.status === "draft", "Only a current draft can be approved.");
      assert(
        !/\[[^\]]+\]/.test(draft.body),
        "Replace placeholders such as [first name] before approving.",
      );
      draft.status = "approved";
      draft.approvedRevision = draft.revision;
      event(
        "Email approved",
        `Exact revision ${draft.revision} approved`,
        company.id,
      );
    } else if (action.type === "draft.reject") {
      draft.status = "rejected";
      draft.approvedRevision = undefined;
      event("Email rejected", `Revision ${draft.revision}`, company.id);
    } else if (action.type === "draft.handoff") {
      assert(
        draft.status === "approved" &&
          draft.approvedRevision === draft.revision,
        "Approve this exact draft revision before handoff.",
      );
      assert(
        draft.recipient,
        "Add a recipient and reapprove before recording handoff.",
      );
      assert(
        !company.sample,
        "Sample companies cannot be handed off. Add a real company to use this action.",
      );
      draft.status = "handed-off";
      event(
        "Manual handoff recorded",
        `Revision ${draft.revision} · ${draft.recipient} · no email sent by DealFinder`,
        company.id,
      );
    }
    draft.updatedAt = at;
  }
  state.version++;
  return state;
}
