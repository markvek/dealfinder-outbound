"use client";
import { useState } from "react";
import Link from "next/link";
import {
  roles,
  roleLabels,
  type Role,
  type Agent,
  type AgentInput,
  type AgentDefaults,
  type Scope,
} from "@/lib/automation";
import { Field, Modal, Badge } from "../dealfinder/primitives";
import { useAutomation, AutomationError } from "./context";
import { JobsPanel } from "./workflows";
export function AgentSelect({
  role,
  value,
  onChange,
  none = false,
  label,
}: {
  role: Role;
  value: string;
  onChange: (v: string) => void;
  none?: boolean;
  label?: string;
}) {
  const { state } = useAutomation();
  return (
    <Field label={label ?? roleLabels[role]}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Inherit saved settings</option>
        {none && <option value="none">No automatic secondary review</option>}
        {state?.agents
          .filter((a) => a.enabled && a.roles.includes(role))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ·{" "}
              {a.testedVersion === a.version ? "ready" : "not verified"}
            </option>
          ))}
      </select>
    </Field>
  );
}
export function AutomationSettings({ view }: { view: string }) {
  const { state } = useAutomation();
  return (
    <div className="page-content">
      <h1>
        {view === "access"
          ? "Agent access"
          : view === "jobs"
            ? "Jobs"
            : "Agents"}
      </h1>
      <nav className="automation-tabs">
        <Link href="/settings">General</Link>
        <Link href="/settings/agents">Agents</Link>
        <Link href="/settings/access">Agent access / MCP</Link>
        <Link href="/settings/jobs">Jobs</Link>
      </nav>
      <AutomationError />
      {state &&
        (view === "access" ? (
          <Access />
        ) : view === "jobs" ? (
          <JobsPanel />
        ) : (
          <>
            <DefaultsForm
              key={JSON.stringify(state.defaults)}
              value={state.defaults}
            />
            <Agents />
          </>
        ))}
    </div>
  );
}
function DefaultsForm({ value }: { value: AgentDefaults }) {
  const [draft, set] = useState(value);
  const { command, busy } = useAutomation();
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        void command("defaults.save", draft);
      }}
    >
      <h2>Default agents</h2>
      <p className="muted">
        Search, company, and launch settings can override these defaults. Judges
        provide advice; your review decision controls outreach.
      </p>
      <div className="form-grid">
        {roles.map((role) => (
          <AgentSelect
            key={role}
            role={role}
            value={draft[role]}
            onChange={(v) => set({ ...draft, [role]: v })}
          />
        ))}
        <Field label="Schedule timezone">
          <input
            required
            value={draft.timezone}
            onChange={(e) => set({ ...draft, timezone: e.target.value })}
          />
        </Field>
        <Field label="Companies per search">
          <input
            type="number"
            min="1"
            max="100"
            value={draft.companyLimit}
            onChange={(e) => set({ ...draft, companyLimit: +e.target.value })}
          />
        </Field>
        <Field label="Budget per job (USD)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.budgetUsd}
            onChange={(e) => set({ ...draft, budgetUsd: +e.target.value })}
          />
        </Field>
      </div>
      <button className="button button-primary" disabled={busy}>
        Save agent defaults
      </button>
    </form>
  );
}
function Agents() {
  const { state, command, busy } = useAutomation();
  const [editing, setEditing] = useState<Agent | null | undefined>();
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Available agents</h2>
        <button className="button" onClick={() => setEditing(null)}>
          Add agent
        </button>
      </div>
      {!state?.agents.length && (
        <p className="muted">
          Add an HTTP agent endpoint or an external agent using the MCP
          connector.
        </p>
      )}
      {state?.agents.map((a) => (
        <div className="automation-row" key={a.id}>
          <div>
            <strong>{a.name}</strong>{" "}
            <Badge>
              {a.enabled
                ? a.testedVersion === a.version
                  ? "Ready"
                  : "Needs verification"
                : "Disabled"}
            </Badge>
            <p>{a.roles.map((r) => roleLabels[r]).join(" · ")}</p>
            <small>
              {a.adapter === "http" ? a.endpoint : "External MCP worker"} ·{" "}
              {a.provider} {a.model}
            </small>
            {a.lastError && <p>{a.lastError}</p>}
            <small>Agent ID: {a.id}</small>
          </div>
          <div className="heading-actions">
            <button className="button" onClick={() => setEditing(a)}>
              Edit
            </button>
            {a.adapter === "http" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => command("agent.test", { id: a.id })}
              >
                Test connection
              </button>
            )}
          </div>
        </div>
      ))}
      {editing !== undefined && (
        <Modal
          title={editing ? "Edit agent" : "Add agent"}
          onClose={() => setEditing(undefined)}
        >
          <AgentEditor agent={editing} done={() => setEditing(undefined)} />
        </Modal>
      )}
    </section>
  );
}
function AgentEditor({
  agent,
  done,
}: {
  agent: Agent | null;
  done: () => void;
}) {
  const [d, set] = useState<AgentInput>(
    agent ?? {
      name: "",
      adapter: "http",
      endpoint: "",
      tokenEnv: "",
      provider: "",
      model: "",
      roles: ["research"],
      enabled: true,
    },
  );
  const { command, busy } = useAutomation();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await command("agent.save", d)) done();
      }}
    >
      <div className="modal-body">
        <AutomationError />
        <Field label="Agent name">
          <input
            required
            value={d.name}
            onChange={(e) => set({ ...d, name: e.target.value })}
          />
        </Field>
        <Field label="Connection type">
          <select
            value={d.adapter}
            onChange={(e) =>
              set({ ...d, adapter: e.target.value as AgentInput["adapter"] })
            }
          >
            <option value="http">HTTP agent endpoint</option>
            <option value="external">External agent via MCP</option>
          </select>
        </Field>
        {d.adapter === "http" ? (
          <>
            <Field label="Agent endpoint">
              <input
                type="url"
                required
                value={d.endpoint}
                onChange={(e) => set({ ...d, endpoint: e.target.value })}
              />
            </Field>
            <Field
              label="Server credential environment variable"
              hint="Optional. Use a DEALFINDER_AGENT_… variable; the key itself stays on the server."
            >
              <input
                value={d.tokenEnv}
                onChange={(e) => set({ ...d, tokenEnv: e.target.value })}
              />
            </Field>
            <p className="muted">
              The endpoint must implement the DealFinder agent protocol. See
              docs/agent-protocol.md; direct model API URLs need an adapter.
            </p>
          </>
        ) : (
          <p className="muted">
            Save this agent, then create an executor key in Agent access. The
            external agent registers its capabilities before it can receive
            jobs.
          </p>
        )}
        <div className="form-grid">
          <Field label="Provider">
            <input
              value={d.provider}
              onChange={(e) => set({ ...d, provider: e.target.value })}
            />
          </Field>
          <Field label="Model">
            <input
              value={d.model}
              onChange={(e) => set({ ...d, model: e.target.value })}
            />
          </Field>
        </div>
        {roles.map((r) => (
          <label className="check-row" key={r}>
            <input
              type="checkbox"
              checked={d.roles.includes(r)}
              onChange={(e) =>
                set({
                  ...d,
                  roles: e.target.checked
                    ? [...d.roles, r]
                    : d.roles.filter((x) => x !== r),
                })
              }
            />
            {roleLabels[r]}
          </label>
        ))}
        <label className="check-row">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => set({ ...d, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>
      <div className="modal-footer">
        <button
          className="button button-primary"
          disabled={busy || !d.roles.length}
        >
          Save agent
        </button>
      </div>
    </form>
  );
}
function Access() {
  const { state, command, busy } = useAutomation();
  const [name, setName] = useState(""),
    [days, setDays] = useState(90),
    [scopes, setScopes] = useState<Scope[]>([
      "read",
      "searches",
      "jobs",
      "schedules",
    ]),
    [agentIds, setAgents] = useState<string[]>([]),
    [token, setToken] = useState("");
  const configuration = JSON.stringify(
    {
      mcpServers: {
        dealfinder: {
          command: "node",
          args: ["/absolute/path/to/connector.mjs"],
          env: {
            DEALFINDER_URL:
              typeof window === "undefined"
                ? "http://127.0.0.1:55210"
                : window.location.origin,
            DEALFINDER_TOKEN: "PASTE_YOUR_API_KEY",
          },
        },
      },
    },
    null,
    2,
  );
  function downloadConfig() {
    const url = URL.createObjectURL(
      new Blob([configuration], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "dealfinder-mcp.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await command<{ token: string }>("key.create", {
            name,
            days,
            scopes,
            agentIds,
          });
          if (r) setToken(r.token);
        }}
      >
        <h2>Create an API key</h2>
        <p className="muted">
          Connect an agent to orchestrate searches, schedules, and email
          generation. Human decisions, approval, and sending are excluded.
        </p>
        <div className="form-grid">
          <Field label="Key name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Expires in days">
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(+e.target.value)}
            />
          </Field>
        </div>
        {(["read", "searches", "jobs", "schedules", "execute"] as Scope[]).map(
          (s) => (
            <label className="check-row" key={s}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, s]
                      : scopes.filter((x) => x !== s),
                  )
                }
              />
              {s === "execute"
                ? "Execute jobs as a registered external agent"
                : s}
            </label>
          ),
        )}
        {scopes.includes("execute") &&
          state?.agents
            .filter((a) => a.adapter === "external")
            .map((a) => (
              <label className="check-row" key={a.id}>
                <input
                  type="checkbox"
                  checked={agentIds.includes(a.id)}
                  onChange={(e) =>
                    setAgents(
                      e.target.checked
                        ? [...agentIds, a.id]
                        : agentIds.filter((x) => x !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
        <button className="button button-primary" disabled={busy}>
          Generate API key
        </button>
      </form>
      {token && (
        <section className="panel">
          <h2>Copy your key</h2>
          <p>This is the only time the full key is displayed.</p>
          <pre className="code-block">{token}</pre>
          <button
            className="button"
            onClick={() => navigator.clipboard.writeText(token)}
          >
            Copy key
          </button>
          <button className="button" onClick={() => setToken("")}>
            Dismiss key
          </button>
        </section>
      )}
      <section className="panel">
        <h2>MCP connector</h2>
        <p>
          Download both files into a folder, run <code>npm install</code> there,
          then add this configuration to your agent.
        </p>
        <p>
          <a className="text-link" href="/api/agent-kit/connector.mjs" download>
            Download connector.mjs
          </a>{" "}
          ·{" "}
          <a className="text-link" href="/api/agent-kit/package.json" download>
            Download package.json
          </a>
        </p>
        <pre className="code-block">{configuration}</pre>
        <div className="heading-actions">
          <button
            className="button"
            onClick={() => navigator.clipboard.writeText(configuration)}
          >
            Copy MCP configuration
          </button>
          <button className="button" onClick={downloadConfig}>
            Download MCP configuration
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>API keys</h2>
        {state?.keys.map((k) => (
          <div className="automation-row" key={k.id}>
            <div>
              <strong>{k.name}</strong>
              <p>
                {k.prefix}… · {k.scopes.join(", ")} · Expires{" "}
                {new Date(k.expiresAt).toLocaleDateString()}
              </p>
              <small>
                Last used:{" "}
                {k.lastUsedAt
                  ? new Date(k.lastUsedAt).toLocaleString()
                  : "Never"}
              </small>
            </div>
            <button
              className="button"
              disabled={busy || !!k.revokedAt}
              onClick={() => command("key.revoke", { id: k.id })}
            >
              {k.revokedAt ? "Revoked" : "Revoke"}
            </button>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Agent activity</h2>
        {state?.events?.slice(0, 25).map((e) => (
          <div className="job-row" key={e.id}>
            <strong>{e.action}</strong>
            <p>
              {new Date(e.at).toLocaleString()} ·{" "}
              {state.keys.find((k) => k.id === e.actor)?.name ?? e.actor}
            </p>
            <small>{e.detail}</small>
          </div>
        ))}
      </section>
    </>
  );
}

export function StepAgentSettings({
  scope,
}: {
  scope: "searches" | "companies" | "review" | "outreach";
}) {
  const { state } = useAutomation();
  return state ? (
    <StepDefaults
      key={JSON.stringify(state.defaults.steps?.[scope])}
      scope={scope}
      value={state.defaults}
    />
  ) : null;
}
function StepDefaults({
  scope,
  value,
}: {
  scope: "searches" | "companies" | "review" | "outreach";
  value: AgentDefaults;
}) {
  const [d, set] = useState(value.steps?.[scope] ?? {});
  const [limits, setLimits] = useState({
    timezone: value.timezone,
    companyLimit: value.companyLimit,
    budgetUsd: value.budgetUsd,
  });
  const { command, busy } = useAutomation();
  const fields: Role[] =
    scope === "searches"
      ? ["research", "judge"]
      : scope === "outreach"
        ? ["writer", "draft-judge"]
        : scope === "review"
          ? ["judge"]
          : ["writer", "judge", "draft-judge"];
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        void command("defaults.save", {
          ...value,
          steps: { ...value.steps, [scope]: d },
          ...(scope === "searches" ? limits : {}),
        });
      }}
    >
      <h2>Step agent defaults</h2>
      <div className="form-grid">
        {fields.map((role) => (
          <AgentSelect
            role={role}
            key={role}
            value={d[role] ?? ""}
            onChange={(v) => set({ ...d, [role]: v })}
          />
        ))}
      </div>
      {scope === "searches" && (
        <div className="form-grid">
          <Field label="Default execution timezone">
            <input
              value={limits.timezone}
              onChange={(e) =>
                setLimits({ ...limits, timezone: e.target.value })
              }
            />
          </Field>
          <Field label="Default company limit">
            <input
              type="number"
              min="1"
              max="100"
              value={limits.companyLimit}
              onChange={(e) =>
                setLimits({ ...limits, companyLimit: +e.target.value })
              }
            />
          </Field>
          <Field label="Default budget per job (USD)">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={limits.budgetUsd}
              onChange={(e) =>
                setLimits({ ...limits, budgetUsd: +e.target.value })
              }
            />
          </Field>
        </div>
      )}
      <AutomationError />
      <button className="button" disabled={busy}>
        Save step agents
      </button>
    </form>
  );
}
