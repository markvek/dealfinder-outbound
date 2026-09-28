export const steps = ["searches", "companies", "review", "outreach"] as const;
export type Step = (typeof steps)[number];
export const stepLabels: Record<Step, string> = {
  searches: "Searches",
  companies: "Companies",
  review: "Review Queue",
  outreach: "Outreach",
};
export type Qualification = "Pass" | "Likely pass" | "Uncertain" | "Fail";
export type Decision = "talking" | "reach-out" | "priority" | "pass";
export const decisionLabels: Record<Decision, string> = {
  talking: "Good — already talking with them",
  "reach-out": "Good — I’ll reach out",
  priority: "Great — top priority",
  pass: "No — not a priority",
};
export interface Search {
  basePrompt?: string;
  researchAgentId?: string;
  judgeAgentId?: string;
  writerAgentId?: string;
  id: string;
  name: string;
  description: string;
  status: "active" | "past";
  employees: number;
  revenue: number;
  metric: "Revenue" | "ARR";
  geography: string[];
  categories: string[];
  exclusions: string[];
  sources: string[];
  domains: string[];
  ownership: string;
  companyType: string;
  dealSize: string;
  createdAt: string;
  version: number;
}
export interface Evidence {
  title: string;
  url: string;
  detail: string;
}
export interface Company {
  searchIds?: string[];
  writerAgentId?: string;
  judgeAgentId?: string;
  draftJudgeAgentId?: string;
  id: string;
  searchId: string;
  name: string;
  domain: string;
  initials: string;
  color: string;
  category: string;
  geography: string;
  employees: number;
  revenue: number | null;
  qualification: Qualification;
  description: string;
  customers: string;
  criticality: string;
  concern: string;
  evidence: Evidence[];
  memoVersion: number;
  decision?: Decision;
  notes: string;
  discoveredAt: string;
  sample: boolean;
}
export interface Draft {
  jobId?: string;
  agentName?: string;
  id: string;
  companyId: string;
  subject: string;
  body: string;
  recipient: string;
  status: "draft" | "approved" | "rejected" | "handed-off";
  revision: number;
  memoVersion: number;
  decision: Decision;
  approvedRevision?: number;
  updatedAt: string;
}
export interface HistoryEvent {
  id: string;
  companyId?: string;
  title: string;
  detail: string;
  at: string;
  reviewer: string;
}
export interface Run {
  id: string;
  searchId: string;
  searchVersion: number;
  at: string;
  status: "awaiting-provider" | "complete";
  detail: string;
}
export interface Settings {
  workspace: string;
  reviewer: string;
  sender: string;
  senderRole: string;
  thesis: string;
  style: string;
  examples: string;
  connection: {
    name: string;
    type: "mcp" | "api";
    endpoint: string;
    auth: "none" | "bearer";
  };
  searches: {
    defaultEmployees: number;
    defaultRevenue: number;
    defaultMetric: "Revenue" | "ARR";
  };
  companies: { freshnessDays: number; showUncertain: boolean };
  review: { defaultView: "pending" | "all"; requireNotes: boolean };
  outreach: { signoff: string; subjectPrefix: string };
}
export interface Workspace {
  version: number;
  searches: Search[];
  companies: Company[];
  drafts: Draft[];
  history: HistoryEvent[];
  runs: Run[];
  settings: Settings;
}
