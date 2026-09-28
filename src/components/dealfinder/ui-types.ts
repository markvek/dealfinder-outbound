import type { Workspace } from "@/lib/types";
import type { Action } from "@/server/workflow";
export type Mutate = (
  action: Action,
  message?: string,
) => Promise<Workspace | null>;
export interface ViewProps {
  data: Workspace;
  mutate: Mutate;
  busy: boolean;
}
