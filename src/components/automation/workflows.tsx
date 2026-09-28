"use client";
import { useState } from "react";
import { useAutomation, AutomationError } from "./context";
import { AgentSelect } from "./settings";
import { Badge, Field, Modal } from "../dealfinder/primitives";
import {
  runSchema,
  type RunInput,
  type ResearchWindow,
  type Schedule,
  type Batch,
} from "@/lib/automation";
import type { Search, Company, Draft } from "@/lib/types";
import type { Mutate } from "../dealfinder/ui-types";
import { wallTime, zonedTimeToIso } from "@/lib/dates";
export function JobsPanel({
  searchId,
  companyId,
}: {
  searchId?: string;
  companyId?: string;
}) {
  const { state, command, busy } = useAutomation();
  const list =
    state?.jobs.filter(
      (j) =>
        (!searchId || j.searchId === searchId) &&
        (!companyId || j.companyId === companyId),
    ) ?? [];
  return (
    <section className="panel">
      <h2>Jobs</h2>
      <p className="small-muted">
        Scheduler:{" "}
        {state?.schedulerHeartbeat
          ? new Date(state.schedulerHeartbeat).toLocaleString()
          : "not started"}{" "}
        · HTTP worker:{" "}
        {state?.workerHeartbeat
          ? new Date(state.workerHeartbeat).toLocaleString()
          : "not started"}
      </p>
      {!list.length && <p className="muted">No jobs yet.</p>}
      {list.map((j) => (
        <details className="job-row" key={j.id}>
          <summary>
            <strong>{j.role}</strong>{" "}
            <Badge
              tone={
                j.status === "failed"
                  ? "amber"
                  : j.status === "succeeded"
                    ? "green"
                    : "neutral"
              }
            >
              {j.status}
            </Badge>{" "}
            {j.snapshot.agent.name} · {new Date(j.dueAt).toLocaleString()}
          </summary>
          <p>{j.progress || j.error || j.id}</p>
          <p>
            Attempt {j.attempt}/{j.maxAttempts} · {j.trigger} · Budget $
            {j.snapshot.budgetUsd}
          </p>
          {j.snapshot.window && (
            <p>
              Research window: {j.snapshot.window.from ?? "All dates"} →{" "}
              {j.snapshot.window.to ?? "Present"}
            </p>
          )}
          <p className="preserve-lines">{j.snapshot.prompt}</p>
          {j.result !== undefined && (
            <pre className="code-block">
              {JSON.stringify(j.result, null, 2)}
            </pre>
          )}
          {["queued", "running"].includes(j.status) && (
            <button
              disabled={busy}
              className="button"
              onClick={() => command("job.cancel", { id: j.id })}
            >
              Cancel job
            </button>
          )}
          {j.status === "failed" && (
            <button
              disabled={busy || j.attempt >= j.maxAttempts}
              className="button"
              onClick={() => command("job.retry", { id: j.id })}
            >
              Retry failed job
            </button>
          )}
        </details>
      ))}
    </section>
  );
}
function WindowFields({
  value,
  onChange,
}: {
  value: ResearchWindow;
  onChange: (v: ResearchWindow) => void;
}) {
  return (
    <>
      <Field label="Research date window">
        <select
          value={value.mode}
          onChange={(e) =>
            onChange({
              ...value,
              mode: e.target.value as ResearchWindow["mode"],
            })
          }
        >
          <option value="all">All dates</option>
          <option value="range">Specific date range</option>
          <option value="rolling">Rolling lookback</option>
          <option value="since-success">Since last successful search</option>
        </select>
      </Field>
      {value.mode === "range" && (
        <div className="form-grid">
          <Field label="Research from (UTC)">
            <input
              type="date"
              required
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </Field>
          <Field label="Research through (UTC)">
            <input
              type="date"
              required
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </Field>
        </div>
      )}
      {["rolling", "since-success"].includes(value.mode) && (
        <Field
          label={
            value.mode === "rolling" ? "Lookback days" : "Initial lookback days"
          }
        >
          <input
            type="number"
            min="1"
            max="3650"
            value={value.days}
            onChange={(e) => onChange({ ...value, days: +e.target.value })}
          />
        </Field>
      )}
    </>
  );
}
function RunFields({
  value,
  onChange,
}: {
  value: RunInput;
  onChange: (v: RunInput) => void;
}) {
  return (
    <>
      <div className="form-grid">
        <AgentSelect
          role="research"
          value={value.researchAgentId}
          onChange={(v) => onChange({ ...value, researchAgentId: v })}
        />
        <AgentSelect
          role="judge"
          none
          value={value.judgeAgentId}
          onChange={(v) => onChange({ ...value, judgeAgentId: v })}
        />
        <AgentSelect
          role="writer"
          value={value.writerAgentId}
          onChange={(v) => onChange({ ...value, writerAgentId: v })}
        />
      </div>
      <WindowFields
        value={value.window}
        onChange={(window) => onChange({ ...value, window })}
      />
      <Field
        label="Additional instructions"
        hint="Added to the saved base prompt. These instructions do not change hard filters."
      >
        <textarea
          rows={3}
          value={value.instructions}
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field label="Maximum companies">
          <input
            type="number"
            min="1"
            max="100"
            value={value.companyLimit}
            onChange={(e) =>
              onChange({ ...value, companyLimit: +e.target.value })
            }
          />
        </Field>
        <Field label="Budget per job (USD)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={value.budgetUsd}
            onChange={(e) => onChange({ ...value, budgetUsd: +e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
export function SearchAutomation({ search }: { search: Search }) {
  const { state, command, busy } = useAutomation();
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState(() =>
    runSchema.parse({
      searchId: search.id,
      window: { mode: "all" },
      researchAgentId: search.researchAgentId,
      judgeAgentId: search.judgeAgentId,
      writerAgentId: search.writerAgentId,
      companyLimit: state?.defaults.companyLimit,
      budgetUsd: state?.defaults.budgetUsd,
    }),
  );
  const [when, setWhen] = useState(""),
    [error, setError] = useState("");
  const timezone = state?.defaults.timezone ?? "America/Los_Angeles";
  const saved = state?.schedules.find((s) => s.searchId === search.id);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Run search</h2>
          <button
            className="button button-primary"
            disabled={search.status !== "active"}
            onClick={() => setOpen(true)}
          >
            Run / schedule once
          </button>
        </div>
        <p className="preserve-lines">
          {search.basePrompt || search.description}
        </p>
        <p className="muted">
          Choose an execution date separately from the date range to research.
        </p>
        <AutomationError />
      </section>
      {open && (
        <Modal title="Run search" onClose={() => setOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setError("");
                const result = await command(
                  "run.start",
                  { ...run, runAt: when ? zonedTimeToIso(when, timezone) : "" },
                  state?.workspace.version,
                );
                if (result) setOpen(false);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <div className="modal-body">
              <AutomationError />
              {error && <p role="alert">{error}</p>}
              <Field
                label={`Execute at (${timezone})`}
                hint="Leave empty to queue now."
              >
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </Field>
              <RunFields value={run} onChange={setRun} />
            </div>
            <div className="modal-footer">
              <button className="button button-primary" disabled={busy}>
                Queue search
              </button>
            </div>
          </form>
        </Modal>
      )}
      {state && (
        <ScheduleEditor
          key={`${search.id}-${saved?.version ?? 0}`}
          search={search}
          saved={saved}
        />
      )}
      <JobsPanel searchId={search.id} />
    </>
  );
}
function ScheduleEditor({
  search,
  saved,
}: {
  search: Search;
  saved?: Schedule;
}) {
  const { state, command, busy } = useAutomation();
  const tz = state?.defaults.timezone ?? "America/Los_Angeles";
  const [d, set] = useState(
    () =>
      saved ?? {
        searchId: search.id,
        enabled: false,
        frequency: "weekly" as Schedule["frequency"],
        cron: "0 9 * * 1",
        timezone: tz,
        startAt: new Date(Date.now() + 60000).toISOString(),
        endAt: "",
        config: runSchema.parse({
          searchId: search.id,
          window: { mode: "since-success" },
          companyLimit: state?.defaults.companyLimit,
          budgetUsd: state?.defaults.budgetUsd,
        }),
        nextOverride: null,
      },
  );
  const [start, setStart] = useState(wallTime(d.startAt, d.timezone)),
    [end, setEnd] = useState(d.endAt ? wallTime(d.endAt, d.timezone) : ""),
    [overlay, setOverlay] = useState(saved?.nextOverride?.instructions ?? ""),
    [preview, setPreview] = useState<string[]>([]),
    [error, setError] = useState("");
  const [nextOverrides, setNextOverrides] = useState<
    NonNullable<Schedule["nextOverride"]>
  >(saved?.nextOverride ?? {});
  const [overrideWindow, setOverrideWindow] = useState(
    !!saved?.nextOverride?.window,
  );
  async function submit(commandName: string) {
    try {
      setError("");
      const input = {
        ...d,
        startAt: zonedTimeToIso(start, d.timezone),
        endAt: end ? zonedTimeToIso(end, d.timezone) : "",
        nextOverride: {
          ...nextOverrides,
          instructions: overlay,
          window: overrideWindow ? nextOverrides.window : undefined,
        },
      };
      const r = await command<string[]>(commandName, input);
      if (commandName === "schedule.preview" && r) setPreview(r);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <details className="panel">
      <summary>
        <strong>Recurring schedule</strong> ·{" "}
        {saved?.enabled ? "Enabled" : "Disabled"}
        {saved?.nextAt
          ? ` · Next ${new Date(saved.nextAt).toLocaleString()}`
          : ""}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit("schedule.save");
        }}
      >
        <AutomationError />
        {error && <p role="alert">{error}</p>}
        {saved?.lastError && (
          <p role="alert">Last scheduling error: {saved.lastError}</p>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => set({ ...d, enabled: e.target.checked })}
          />
          Enable schedule
        </label>
        <div className="form-grid">
          <Field label="Frequency">
            <select
              value={d.frequency}
              onChange={(e) => {
                const f = e.target.value as Schedule["frequency"];
                set({
                  ...d,
                  frequency: f,
                  cron:
                    f === "daily"
                      ? "0 9 * * *"
                      : f === "weekly"
                        ? "0 9 * * 1"
                        : f === "monthly"
                          ? "0 9 1 * *"
                          : d.cron,
                });
              }}
            >
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="cron">Custom cron</option>
            </select>
          </Field>
          <Field label="Timezone">
            <input
              required
              value={d.timezone}
              onChange={(e) => set({ ...d, timezone: e.target.value })}
            />
          </Field>
          {["daily", "weekly", "monthly"].includes(d.frequency) && (
            <>
              <Field label="Run time">
                <input
                  type="time"
                  required
                  value={`${(d.cron.split(" ")[1] ?? "9").padStart(2, "0")}:${(d.cron.split(" ")[0] ?? "0").padStart(2, "0")}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":");
                    const parts = d.cron.split(" ");
                    parts[0] = String(Number(m));
                    parts[1] = String(Number(h));
                    set({ ...d, cron: parts.join(" ") });
                  }}
                />
              </Field>
              {d.frequency === "weekly" && (
                <Field label="Weekday">
                  <select
                    value={d.cron.split(" ")[4]}
                    onChange={(e) => {
                      const parts = d.cron.split(" ");
                      parts[4] = e.target.value;
                      set({ ...d, cron: parts.join(" ") });
                    }}
                  >
                    {[
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ].map((day, i) => (
                      <option key={day} value={i}>
                        {day}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {d.frequency === "monthly" && (
                <Field
                  label="Day of month"
                  hint="Months without this date are skipped."
                >
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={d.cron.split(" ")[2]}
                    onChange={(e) => {
                      const parts = d.cron.split(" ");
                      parts[2] = e.target.value;
                      set({ ...d, cron: parts.join(" ") });
                    }}
                  />
                </Field>
              )}
            </>
          )}
          {d.frequency === "cron" && (
            <Field
              label="Cron expression"
              hint="Minute hour day-of-month month weekday. Example: 0 9 * * 1 = Monday at 9 AM."
            >
              <input
                required
                value={d.cron}
                onChange={(e) => set({ ...d, cron: e.target.value })}
              />
            </Field>
          )}
          <Field label="Start date and time">
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="End date and time (optional)">
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <RunFields
          value={{ ...d.config, searchId: search.id, runAt: "" }}
          onChange={(config) => set({ ...d, config })}
        />
        <Field label="Temporary prompt for next run only">
          <textarea
            value={overlay}
            onChange={(e) => setOverlay(e.target.value)}
          />
        </Field>
        <details>
          <summary>Next-run-only agents and dates</summary>
          <p className="muted">
            Consumed after one run is queued; blank agent choices inherit the
            recurring settings.
          </p>
          <AgentSelect
            role="research"
            label="Next run: research agent"
            value={nextOverrides.researchAgentId ?? ""}
            onChange={(v) =>
              setNextOverrides({
                ...nextOverrides,
                researchAgentId: v || undefined,
              })
            }
          />
          <AgentSelect
            role="judge"
            label="Next run: company judge"
            none
            value={nextOverrides.judgeAgentId ?? ""}
            onChange={(v) =>
              setNextOverrides({
                ...nextOverrides,
                judgeAgentId: v || undefined,
              })
            }
          />
          <AgentSelect
            role="writer"
            label="Next run: outreach writer"
            value={nextOverrides.writerAgentId ?? ""}
            onChange={(v) =>
              setNextOverrides({
                ...nextOverrides,
                writerAgentId: v || undefined,
              })
            }
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={overrideWindow}
              onChange={(e) => {
                setOverrideWindow(e.target.checked);
                if (e.target.checked && !nextOverrides.window)
                  setNextOverrides({
                    ...nextOverrides,
                    window: d.config.window,
                  });
              }}
            />
            Override the next research date window
          </label>
          {overrideWindow && (
            <WindowFields
              value={nextOverrides.window ?? d.config.window}
              onChange={(window) =>
                setNextOverrides({ ...nextOverrides, window })
              }
            />
          )}
        </details>
        <p className="muted">
          The scheduler must be running: <code>npm run automation</code>. Missed
          executions coalesce into one catch-up run. Searches do not overlap.
          Nonexistent daylight-saving times are skipped; repeated times run
          once.
        </p>
        <div className="heading-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => submit("schedule.preview")}
          >
            Preview next dates
          </button>
          <button className="button button-primary" disabled={busy}>
            Save schedule
          </button>
        </div>
        {preview.map((t) => (
          <p key={t}>
            {new Date(t).toLocaleString("en-US", { timeZone: d.timezone })} (
            {d.timezone})
          </p>
        ))}
      </form>
    </details>
  );
}
export function BatchLauncher({
  companies,
  role = "writer",
  label,
}: {
  companies: Company[];
  role?: "writer" | "judge";
  label?: string;
}) {
  const { state, command, busy } = useAutomation();
  const [open, setOpen] = useState(false),
    [agentId, setAgent] = useState(""),
    [judgeAgentId, setJudge] = useState(""),
    [instructions, setInstructions] = useState(""),
    [regenerate, setRegenerate] = useState(false),
    [budget, setBudget] = useState(state?.defaults.budgetUsd ?? 10),
    [result, setResult] = useState<Batch | null>(null);
  return (
    <>
      <button
        className="button"
        disabled={!companies.length}
        onClick={() => {
          setOpen(true);
          setResult(null);
        }}
      >
        {label ??
          (role === "writer" ? "Generate emails" : "Run secondary review")}
      </button>
      {open && (
        <Modal
          title={
            role === "writer"
              ? "Generate outreach emails"
              : "Company secondary review"
          }
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setResult(
                await command<Batch>(
                  "batch.start",
                  {
                    companyIds: companies.map((c) => c.id),
                    role,
                    agentId,
                    judgeAgentId,
                    instructions,
                    budgetUsd: budget,
                    regenerate,
                  },
                  state?.workspace.version,
                ),
              );
            }}
          >
            <div className="modal-body">
              <AutomationError />
              <p>
                {companies.length} selected:{" "}
                {companies.map((c) => c.name).join(", ")}.
              </p>
              <AgentSelect role={role} value={agentId} onChange={setAgent} />
              {role === "writer" && (
                <>
                  <AgentSelect
                    role="draft-judge"
                    none
                    value={judgeAgentId}
                    onChange={setJudge}
                  />
                  <p className="muted">
                    Only human-approved companies qualify. Existing drafts are
                    skipped unless regeneration is selected.
                  </p>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={regenerate}
                      onChange={(e) => setRegenerate(e.target.checked)}
                    />
                    Regenerate and supersede existing drafts when the new result
                    succeeds
                  </label>
                </>
              )}
              <Field label="Temporary instructions">
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </Field>
              <Field label="Budget per job (USD)">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(+e.target.value)}
                />
              </Field>
              <p className="small-muted">
                Up to ${budget * companies.length} for these jobs; optional
                judges each use their own job budget.
              </p>
              {result && (
                <div role="status">
                  <strong>
                    {result.jobIds.length} jobs queued · {result.skipped.length}{" "}
                    skipped
                  </strong>
                  {result.skipped.map((s) => (
                    <p key={s.companyId}>
                      {companies.find((c) => c.id === s.companyId)?.name}:{" "}
                      {s.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="button button-primary"
                disabled={busy || !!result}
              >
                Queue jobs
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function CompanyAgentSettings({ company }: { company: Company }) {
  const { state, command, busy } = useAutomation();
  const [d, set] = useState({
    id: company.id,
    writerAgentId: company.writerAgentId ?? "",
    judgeAgentId: company.judgeAgentId ?? "",
    draftJudgeAgentId: company.draftJudgeAgentId ?? "",
  });
  return (
    <details className="panel">
      <summary>
        <strong>Company agents</strong>
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void command("company.agents", d, state?.workspace.version);
        }}
      >
        <AgentSelect
          role="writer"
          value={d.writerAgentId}
          onChange={(v) => set({ ...d, writerAgentId: v })}
        />
        <AgentSelect
          role="judge"
          value={d.judgeAgentId}
          onChange={(v) => set({ ...d, judgeAgentId: v })}
        />
        <AgentSelect
          role="draft-judge"
          none
          value={d.draftJudgeAgentId}
          onChange={(v) => set({ ...d, draftJudgeAgentId: v })}
        />
        <AutomationError />
        <button className="button" disabled={busy}>
          Save company agents
        </button>
      </form>
    </details>
  );
}
export function JudgePanel({
  company,
  draft,
  mutate,
}: {
  company: Company;
  draft?: Draft;
  mutate?: Mutate;
}) {
  const { state, command, busy } = useAutomation();
  const reviews =
    state?.reviews.filter(
      (r) =>
        r.companyId === company.id &&
        (draft ? r.draftId === draft.id : !r.draftId),
    ) ?? [];
  const [agent, setAgent] = useState("");
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Secondary review</h2>
        {!draft && <BatchLauncher companies={[company]} role="judge" />}
      </div>
      <AutomationError />
      {draft && (
        <>
          <AgentSelect role="draft-judge" value={agent} onChange={setAgent} />
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              command("draft.judge", {
                draftId: draft.id,
                agentId: agent,
                instructions: "",
              })
            }
          >
            Review this draft
          </button>
        </>
      )}
      <p className="muted">
        Advisory findings. Human review is required before outreach approval.
      </p>
      {reviews.length === 0 && <p>No secondary review yet.</p>}
      {state?.jobs
        .filter(
          (j) =>
            j.companyId === company.id &&
            j.role === (draft ? "draft-judge" : "judge") &&
            (!draft || j.draftId === draft.id),
        )
        .slice(0, 1)
        .map((j) => (
          <p key={j.id}>
            Latest review job: <Badge>{j.status}</Badge> {j.error}
          </p>
        ))}
      {reviews.map((r, i) => (
        <details key={r.id} open={i === 0}>
          <summary>
            {r.agentName} · {r.recommendation} ·{" "}
            {r.stale ? "Outdated" : new Date(r.at).toLocaleString()}
          </summary>
          <p className="small-muted">
            Model: {r.model || "Executor default"} · Memo v{r.memoVersion}
            {r.draftRevision ? ` · Draft v${r.draftRevision}` : ""}
          </p>
          <p>{r.rationale}</p>
          {r.concerns.map((c, j) => (
            <p key={j}>Concern: {c}</p>
          ))}
          <p>Uncertainty: {r.uncertainty || "None reported"}</p>
          {r.evidenceRefs.map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
          ))}
          {!draft &&
            mutate &&
            !r.stale &&
            r.recommendation !== "insufficient-evidence" && (
              <button
                className="button"
                onClick={() =>
                  mutate({
                    type: "company.decision",
                    id: company.id,
                    decision: r.recommendation as
                      "talking" | "reach-out" | "priority" | "pass",
                    notes: `Accepted secondary review: ${r.rationale}`,
                  })
                }
              >
                Accept recommendation as my decision
              </button>
            )}
        </details>
      ))}
    </section>
  );
}
