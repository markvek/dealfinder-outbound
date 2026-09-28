import example from "../data/example-workspace.json";
import type { Workspace } from "./types";
export function createSeed(): Workspace {
  const at = new Date().toISOString();
  const seed = structuredClone(example);
  return {
    ...seed,
    searches: seed.searches.map((s) => ({ ...s, createdAt: at })),
    companies: seed.companies.map((c) => ({ ...c, discoveredAt: at })),
    history: [
      {
        id: "seed",
        title: "Example loaded",
        detail: "One fictional search and company. No live research has run.",
        at,
        reviewer: "Workspace",
      },
    ],
  } as Workspace;
}
