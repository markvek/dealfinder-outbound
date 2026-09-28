"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { AutomationState } from "@/lib/automation";
import type { Workspace } from "@/lib/types";
type State = AutomationState & { workspace: Workspace };
type Context = {
  state: State | null;
  error: string;
  busy: boolean;
  command: <T = unknown>(
    command: string,
    input?: unknown,
    version?: number,
    key?: string,
  ) => Promise<T | null>;
  refresh: () => Promise<void>;
};
const Context = createContext<Context | null>(null);
export function AutomationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pendingKeys = useRef(new Map<string, string>());
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/automation");
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setState(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load automation.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 4000);
    window.addEventListener("workspace-updated", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("workspace-updated", refresh);
    };
  }, [refresh]);
  async function command<T = unknown>(
    command: string,
    input: unknown = {},
    version?: number,
    suppliedKey?: string,
  ): Promise<T | null> {
    const fingerprint = JSON.stringify({ command, input, version });
    const key =
      suppliedKey ??
      pendingKeys.current.get(fingerprint) ??
      crypto.randomUUID();
    pendingKeys.current.set(fingerprint, key);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, input, version, key }),
      });
      const v = await r.json();
      if (!r.ok) {
        pendingKeys.current.delete(fingerprint);
        throw new Error(v.error);
      }
      pendingKeys.current.delete(fingerprint);
      await refresh();
      window.dispatchEvent(new Event("automation-updated"));
      return v.result as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ state, error, busy, command, refresh }}>
      {children}
    </Context.Provider>
  );
}
export function useAutomation() {
  const c = useContext(Context);
  if (!c) throw new Error("Automation context missing");
  return c;
}
export function AutomationError() {
  const { error } = useAutomation();
  return error ? (
    <p className="error-banner" role="alert">
      {error}
    </p>
  ) : null;
}
