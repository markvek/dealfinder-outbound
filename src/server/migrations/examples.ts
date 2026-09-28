import legacy from "./legacy-examples.json";
import type { Workspace } from "../../lib/types";
function normalized(record: object) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !["createdAt", "discoveredAt"].includes(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
export function simplifyExamples(input: Workspace): Workspace {
  const state = structuredClone(input);
  state.companies = state.companies.filter((c) => {
    const original = legacy.companies.find((old) => old.id === c.id);
    const referenced =
      state.drafts.some((d) => d.companyId === c.id) ||
      state.history.some((h) => h.companyId === c.id);
    const remove =
      !!original && !referenced && normalized(c) === normalized(original);
    return !remove;
  });
  state.searches = state.searches.filter((s) => {
    const original = legacy.searches.find((old) => old.id === s.id);
    return (
      !original ||
      normalized(s) !== normalized(original) ||
      state.companies.some((c) => c.searchId === s.id) ||
      state.runs.some((r) => r.searchId === s.id)
    );
  });
  const seed = state.history.find((h) => h.id === "seed");
  if (seed?.detail.startsWith("Six fictional"))
    seed.detail = "Example data loaded. No live research has run.";
  return state;
}
