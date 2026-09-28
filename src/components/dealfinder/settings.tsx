"use client";
import { StepAgentSettings } from "../automation/settings";
import Link from "next/link";
import { useState } from "react";
import {
  Cable,
  Check,
  ChevronRight,
  LoaderCircle,
  Plug,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { stepLabels, type Settings, type Step } from "@/lib/types";
import type { ViewProps } from "./ui-types";
import { Badge, Field } from "./primitives";

export function SettingsView({
  data,
  mutate,
  busy,
  scope,
}: ViewProps & { scope: "general" | Step }) {
  const [draft, setDraft] = useState<Settings>(structuredClone(data.settings));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    tools?: { name: string; description?: string }[];
  } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((p) => ({ ...p, [key]: value }));
    if (key === "connection") setTestResult(null);
  };
  const title =
    scope === "general" ? "General Settings" : `${stepLabels[scope]} settings`;
  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      if (
        dirty &&
        !(await mutate(
          { type: "settings.save", settings: draft },
          "Settings saved",
        ))
      )
        return;
      const response = await fetch("/api/connections/test", { method: "POST" });
      const result = await response.json();
      setTestResult({
        ok: response.ok,
        message: result.error ?? result.message,
        tools: result.tools,
      });
    } catch {
      setTestResult({
        ok: false,
        message: "Could not test the connection. Please try again.",
      });
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="page-content settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {scope === "general"
              ? "GENERAL SETTINGS"
              : `${stepLabels[scope].toUpperCase()} / PREFERENCES`}
          </div>
          <h1>{title}</h1>
          <p>
            {scope === "general"
              ? ""
              : "Fine-tune this step. Shared preferences live in General Settings."}
          </p>
        </div>
        {scope !== "general" && (
          <Link href="/settings" className="button">
            <Settings2 size={15} />
            General settings
          </Link>
        )}
      </div>
      <nav className="automation-tabs">
        <Link href="/settings">General</Link>
        <Link href="/settings/agents">Agents</Link>
        <Link href="/settings/access">Agent access / MCP</Link>
        <Link href="/settings/jobs">Jobs</Link>
      </nav>
      {scope !== "general" && <StepAgentSettings scope={scope} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutate({ type: "settings.save", settings: draft }, "Settings saved");
        }}
      >
        {scope === "general" && (
          <>
            <section className="settings-section">
              <div className="settings-section-label">
                <h2>Workspace</h2>
                <p>Workspace name, reviewer, and sender details.</p>
              </div>
              <div className="panel form-section">
                <div className="form-grid">
                  <Field label="Workspace name">
                    <input
                      required
                      value={draft.workspace}
                      onChange={(e) => set("workspace", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Reviewer name"
                    hint="Recorded with every decision in this local workspace."
                  >
                    <input
                      required
                      value={draft.reviewer}
                      onChange={(e) => set("reviewer", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="form-grid">
                  <Field label="Sender name">
                    <input
                      placeholder="Your full name"
                      value={draft.sender}
                      onChange={(e) => set("sender", e.target.value)}
                    />
                  </Field>
                  <Field label="Role / firm">
                    <input
                      placeholder="e.g. Partner, Northstar Capital"
                      value={draft.senderRole}
                      onChange={(e) => set("senderRole", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Investment thesis">
                  <textarea
                    rows={3}
                    value={draft.thesis}
                    onChange={(e) => set("thesis", e.target.value)}
                  />
                </Field>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section-label">
                <h2>Advanced: outgoing research tools</h2>
                <p>
                  Test an external MCP server or API. Agent access keys are
                  configured separately.
                </p>
                <span className="connection-illustration">
                  <Cable size={34} strokeWidth={1.3} />
                </span>
              </div>
              <div className="panel form-section">
                <div className="panel-heading">
                  <h2>
                    <Plug size={17} />
                    External connection
                  </h2>
                  <Badge tone={testResult?.ok ? "green" : "neutral"}>
                    {testResult?.ok
                      ? "Test passed"
                      : draft.connection.endpoint
                        ? "Not verified"
                        : "Not connected"}
                  </Badge>
                </div>
                <div className="form-grid">
                  <Field label="Connection name">
                    <input
                      required
                      value={draft.connection.name}
                      onChange={(e) =>
                        set("connection", {
                          ...draft.connection,
                          name: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Connection type">
                    <select
                      value={draft.connection.type}
                      onChange={(e) =>
                        set("connection", {
                          ...draft.connection,
                          type: e.target.value as "mcp" | "api",
                        })
                      }
                    >
                      <option value="mcp">MCP · Streamable HTTP</option>
                      <option value="api">HTTP API · GET health check</option>
                    </select>
                  </Field>
                </div>
                <Field
                  label={
                    draft.connection.type === "mcp"
                      ? "MCP server endpoint"
                      : "API health endpoint"
                  }
                  hint={
                    draft.connection.type === "mcp"
                      ? "The server’s HTTP MCP endpoint, usually ending in /mcp."
                      : "A read-only endpoint that returns a successful HTTP status."
                  }
                >
                  <input
                    type="url"
                    placeholder={
                      draft.connection.type === "mcp"
                        ? "https://your-server.com/mcp"
                        : "https://api.example.com/health"
                    }
                    value={draft.connection.endpoint}
                    onChange={(e) =>
                      set("connection", {
                        ...draft.connection,
                        endpoint: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Authentication">
                  <select
                    value={draft.connection.auth}
                    onChange={(e) =>
                      set("connection", {
                        ...draft.connection,
                        auth: e.target.value as "none" | "bearer",
                      })
                    }
                  >
                    <option value="none">No authentication</option>
                    <option value="bearer">
                      Bearer token · server environment
                    </option>
                  </select>
                </Field>
                <div className="info-note">
                  Allow the endpoint’s origin with{" "}
                  <code>DEALFINDER_CONNECTION_ORIGINS</code> in{" "}
                  <code>.env.local</code>.
                  {draft.connection.auth === "bearer" && (
                    <>
                      {" "}
                      Set the secret in <code>DEALFINDER_CONNECTION_TOKEN</code>
                      ; it is never stored in the browser.
                    </>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    className="button"
                    disabled={busy || testing || !draft.connection.endpoint}
                    onClick={testConnection}
                  >
                    {testing ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Plug size={15} />
                    )}
                    {testing
                      ? "Testing connection…"
                      : dirty
                        ? "Save & test connection"
                        : "Test connection"}
                  </button>
                </div>
                {testResult && (
                  <div
                    className={`connection-result ${testResult.ok ? "success" : "failure"}`}
                    role="status"
                  >
                    <strong>{testResult.message}</strong>
                    {testResult.tools?.map((t) => (
                      <div key={t.name}>
                        <code>{t.name}</code>
                        <p>{t.description}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="small-muted">
                  Tests connection and lists MCP tools. Tool execution and live
                  research orchestration are not enabled yet.
                </p>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section-label">
                <h2>Step preferences</h2>
                <p>Each step has its own settings.</p>
              </div>
              <div className="panel setting-links">
                {(
                  ["searches", "companies", "review", "outreach"] as Step[]
                ).map((s) => (
                  <Link key={s} href={`/${s}/settings`}>
                    <span>
                      <Settings2 size={16} />
                      {stepLabels[s]}
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
        {scope === "searches" && (
          <section className="settings-section">
            <div className="settings-section-label">
              <h2>New search defaults</h2>
              <p>
                A starting point for new searches. Existing searches keep their
                own filters.
              </p>
            </div>
            <div className="panel form-section">
              <div className="form-grid">
                <Field label="Minimum employees">
                  <input
                    type="number"
                    min={0}
                    required
                    value={draft.searches.defaultEmployees}
                    onChange={(e) =>
                      set("searches", {
                        ...draft.searches,
                        defaultEmployees: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Minimum scale (USD millions)">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    required
                    value={draft.searches.defaultRevenue}
                    onChange={(e) =>
                      set("searches", {
                        ...draft.searches,
                        defaultRevenue: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Scale metric">
                <select
                  value={draft.searches.defaultMetric}
                  onChange={(e) =>
                    set("searches", {
                      ...draft.searches,
                      defaultMetric: e.target.value as "Revenue" | "ARR",
                    })
                  }
                >
                  <option>Revenue</option>
                  <option>ARR</option>
                </select>
              </Field>
              <div className="info-note">
                Each saved search has separate hard filters and preferred
                sources. Edit those from the search’s own settings.
              </div>
            </div>
          </section>
        )}
        {scope === "companies" && (
          <section className="settings-section">
            <div className="settings-section-label">
              <h2>Company research</h2>
              <p>
                Control how research is presented and when it needs a fresh
                look.
              </p>
            </div>
            <div className="panel form-section">
              <Field label="Flag research after (days)">
                <input
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={draft.companies.freshnessDays}
                  onChange={(e) =>
                    set("companies", {
                      ...draft.companies,
                      freshnessDays: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <label className="toggle-row">
                <span>
                  <strong>Show uncertain companies</strong>
                  <small>
                    Missing information should remain visible for human
                    judgment.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.companies.showUncertain}
                  onChange={(e) =>
                    set("companies", {
                      ...draft.companies,
                      showUncertain: e.target.checked,
                    })
                  }
                />
              </label>
              <div className="info-note">
                Companies are normalized by domain. Existing records are reused
                across searches; an already-talking decision suppresses outreach
                everywhere.
              </div>
            </div>
          </section>
        )}
        {scope === "review" && (
          <section className="settings-section">
            <div className="settings-section-label">
              <h2>Human review</h2>
            </div>
            <div className="panel form-section">
              <Field label="Default review view">
                <select
                  value={draft.review.defaultView}
                  onChange={(e) =>
                    set("review", {
                      ...draft.review,
                      defaultView: e.target.value as "pending" | "all",
                    })
                  }
                >
                  <option value="pending">Companies needing review</option>
                  <option value="all">All companies and decisions</option>
                </select>
              </Field>
              <label className="toggle-row">
                <span>
                  <strong>Require a note with each decision</strong>
                  <small>
                    A short explanation makes the decision history more useful.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.review.requireNotes}
                  onChange={(e) =>
                    set("review", {
                      ...draft.review,
                      requireNotes: e.target.checked,
                    })
                  }
                />
              </label>
              <div className="info-note">
                <ShieldCheck size={16} />
                Human approval is always required before outreach. Each decision
                records the memo version, reviewer, and timestamp.
              </div>
            </div>
          </section>
        )}
        {scope === "outreach" && (
          <section className="settings-section">
            <div className="settings-section-label">
              <h2>Your writing style</h2>
            </div>
            <div className="panel form-section">
              <Field
                label="Style guidance"
                hint="Saved for the future email agent. Current starter templates still need your personal edits."
              >
                <textarea
                  rows={4}
                  value={draft.style}
                  onChange={(e) => set("style", e.target.value)}
                />
              </Field>
              <Field label="Successful email examples">
                <textarea
                  rows={7}
                  placeholder="Paste a few emails that sound like you…"
                  value={draft.examples}
                  onChange={(e) => set("examples", e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Sign-off">
                  <input
                    value={draft.outreach.signoff}
                    onChange={(e) =>
                      set("outreach", {
                        ...draft.outreach,
                        signoff: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Subject prefix (optional)">
                  <input
                    placeholder="Leave blank for a natural subject"
                    value={draft.outreach.subjectPrefix}
                    onChange={(e) =>
                      set("outreach", {
                        ...draft.outreach,
                        subjectPrefix: e.target.value,
                      })
                    }
                  />
                </Field>
              </div>
              <div className="info-note">
                Email approval always applies to the exact text. Editing an
                approved email resets it to a draft. Automatic sending is off.
              </div>
            </div>
          </section>
        )}
        <div className="settings-save">
          <span>
            {dirty ? "You have unsaved changes" : "All settings saved"}
          </span>
          <button className="button button-primary" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save settings"}
            <Check size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
