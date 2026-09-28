"use client";
import { SearchAutomation } from "../automation/workflows";
import { AgentSelect } from "../automation/settings";
import Link from "next/link";
import { useState } from "react";
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  Compass,
  Globe2,
  Layers2,
  Plus,
  Search as SearchIcon,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { Search } from "@/lib/types";
import type { ViewProps } from "./ui-types";
import { Badge, Empty, Field, Modal, Tags, niceDate } from "./primitives";

export function SearchView({
  data,
  view,
  mutate,
  busy,
  onNew,
}: ViewProps & { view: string; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const search = data.searches.find((s) => s.id === view);
  const active = data.searches.filter((s) => s.status === "active");
  const pending = data.companies.filter(
    (c) => !c.decision && c.qualification !== "Fail",
  ).length;
  if (search) {
    const companies = data.companies.filter((c) =>
      (c.searchIds ?? [c.searchId]).includes(search.id),
    );

    return (
      <div className="page-content">
        <Link href="/searches" className="back-link">
          ← All searches
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              SAVED SEARCH · VERSION {search.version}
            </div>
            <h1>{search.name}</h1>
            <p>{search.description}</p>
          </div>
          <div className="heading-actions">
            <button className="button" onClick={() => setEditing(true)}>
              <SlidersHorizontal size={15} />
              Edit settings
            </button>
          </div>
        </div>
        <div className="detail-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>Search criteria</h2>
              <Badge tone={search.status === "active" ? "green" : "neutral"}>
                {search.status === "active" ? "Active" : "Archived"}
              </Badge>
            </div>
            <dl className="definition-list">
              <div>
                <dt>Employees</dt>
                <dd>{search.employees}+ employees</dd>
              </div>
              <div>
                <dt>{search.metric}</dt>
                <dd>${search.revenue}M+ USD</dd>
              </div>
              <div>
                <dt>Geography</dt>
                <dd>{search.geography.join(", ")}</dd>
              </div>
              <div>
                <dt>Company type</dt>
                <dd>{search.companyType || "Any"}</dd>
              </div>
              <div>
                <dt>Ownership</dt>
                <dd>{search.ownership || "Any"}</dd>
              </div>
              <div>
                <dt>Deal size</dt>
                <dd>{search.dealSize || "Open"}</dd>
              </div>
            </dl>
            <div className="tags">
              {search.categories.map((c) => (
                <span className="tag" key={c}>
                  {c}
                </span>
              ))}
            </div>
            {search.exclusions.length > 0 && (
              <p className="small-muted">
                Excluding {search.exclusions.join(", ")}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Preferred sources</h2>
              <Compass size={17} />
            </div>
            <p className="muted">
              A starting point for research, with room for other credible
              sources.
            </p>
            <div className="source-list">
              {[...search.sources, ...search.domains].map((s) => (
                <div key={s}>
                  <Globe2 size={15} />
                  <span>{s}</span>
                  <Check size={14} />
                </div>
              ))}
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              Companies in this search{" "}
              <span className="count-inline">{companies.length}</span>
            </h2>
            <Link href={`/companies/search-${search.id}`} className="text-link">
              View companies
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {companies.length ? (
            <div className="compact-company-list">
              {companies.map((c) => (
                <Link key={c.id} href={`/companies/${c.id}`}>
                  <strong>{c.name}</strong>
                  <span>{c.category}</span>
                  <Badge
                    tone={c.qualification === "Uncertain" ? "amber" : "green"}
                  >
                    {c.qualification}
                  </Badge>
                  <ChevronRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No companies">
              Add a researched company from Companies, or request a run once a
              discovery provider is available.
            </Empty>
          )}
        </section>
        <SearchAutomation
          key={`${search.id}-${search.version}`}
          search={search}
        />
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() =>
            mutate(
              { type: "search.archive", id: search.id },
              search.status === "active"
                ? "Search moved to past searches"
                : "Search restored",
            )
          }
        >
          <Archive size={15} />
          {search.status === "active"
            ? "Move to past searches"
            : "Restore search"}
        </button>
        {editing && (
          <Modal title="Search settings" onClose={() => setEditing(false)}>
            <SearchEditor
              data={data}
              mutate={mutate}
              busy={busy}
              search={search}
              onDone={() => setEditing(false)}
            />
          </Modal>
        )}
      </div>
    );
  }
  if (view && view !== "past")
    return (
      <Empty title="Search not found">Choose a search from the sidebar.</Empty>
    );
  const list = data.searches.filter(
    (s) =>
      s.status === (view === "past" ? "past" : "active") &&
      `${s.name} ${s.categories.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>Searches</h1>
        </div>
        <button className="button button-primary" onClick={onNew}>
          <Plus size={16} />
          New search
        </button>
      </div>
      <div className="metrics-strip">
        <div>
          <span className="metric-icon">
            <SearchIcon size={18} />
          </span>
          <section>
            <span>Active searches</span>
            <strong>{active.length.toString().padStart(2, "0")}</strong>
          </section>
        </div>
        <div>
          <span className="metric-icon">
            <Building2 size={18} />
          </span>
          <section>
            <span>Companies discovered</span>
            <strong>{data.companies.length.toString().padStart(2, "0")}</strong>
          </section>
        </div>
        <div>
          <span className="metric-icon">
            <Layers2 size={18} />
          </span>
          <section>
            <span>Ready for review</span>
            <strong>{pending.toString().padStart(2, "0")}</strong>
          </section>
          <Link href="/review" aria-label="Go to Review Queue">
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
      <div className="section-toolbar">
        <div className="segmented">
          <Link href="/searches" className={!view ? "selected" : ""}>
            Active searches <span>{active.length}</span>
          </Link>
          <Link
            href="/searches/past"
            className={view === "past" ? "selected" : ""}
          >
            Past searches <span>{data.searches.length - active.length}</span>
          </Link>
        </div>
        <label className="search-input">
          <SearchIcon size={15} />
          <input
            aria-label="Find a search"
            placeholder="Find a search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌕</kbd>
        </label>
      </div>
      <div className="search-card-grid">
        {list.map((s, index) => (
          <Link key={s.id} href={`/searches/${s.id}`} className="search-card">
            <div className="search-card-top">
              <span className={`search-card-icon ${index % 2 ? "sand" : ""}`}>
                {index % 2 ? (
                  <Building2 size={23} strokeWidth={1.4} />
                ) : (
                  <Layers2 size={23} strokeWidth={1.4} />
                )}
              </span>
              <Badge tone={s.status === "active" ? "green" : "neutral"}>
                <span className="tiny-dot" />
                {s.status === "active" ? "Active" : "Past"}
              </Badge>
              <ArrowUpRight size={17} className="card-arrow" />
            </div>
            <h2>{s.name}</h2>
            <p>{s.description}</p>
            <div className="search-card-filters">
              <span>
                <Users size={14} />
                {s.employees}+ employees
              </span>
              <span>
                ${s.revenue}M+ {s.metric.toLowerCase()}
              </span>
              <span>
                <Globe2 size={14} />
                {s.geography.length === 2 &&
                s.geography.includes("United States") &&
                s.geography.includes("Canada")
                  ? "US & Canada"
                  : s.geography.join(", ")}
              </span>
            </div>
            <div className="tags">
              {s.categories.slice(0, 2).map((c) => (
                <span className="tag" key={c}>
                  {c}
                </span>
              ))}
              {s.categories.length > 2 && (
                <span className="tag">+{s.categories.length - 2}</span>
              )}
            </div>
            <div className="search-card-footer">
              <span>
                <Building2 size={14} />
                <strong>
                  {data.companies.filter((c) => c.searchId === s.id).length}
                </strong>{" "}
                companies
              </span>
              <span>Created {niceDate(s.createdAt)}</span>
            </div>
          </Link>
        ))}
        {!query && view !== "past" && (
          <button className="new-search-card" onClick={onNew}>
            <span>
              <Plus size={23} strokeWidth={1.3} />
            </span>
            <h3>New search</h3>

            <strong>
              Create a search <ArrowRight size={14} />
            </strong>
          </button>
        )}
      </div>
      {list.length === 0 && query && (
        <Empty title="No matching searches">
          Try a different name or category.
        </Empty>
      )}
      <div className="page-footnote">
        <span className="sample-indicator" />
        Example data.{" "}
        <Link href="/companies">
          Companies <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

export function SearchEditor({
  data,
  mutate,
  busy,
  search,
  onDone,
}: ViewProps & { search?: Search; onDone: () => void }) {
  const [draft, setDraft] = useState({
    id: search?.id,
    name: search?.name ?? "",
    basePrompt: search?.basePrompt ?? "",
    researchAgentId: search?.researchAgentId ?? "",
    judgeAgentId: search?.judgeAgentId ?? "",
    writerAgentId: search?.writerAgentId ?? "",
    description: search?.description ?? "",
    employees: search?.employees ?? data.settings.searches.defaultEmployees,
    revenue: search?.revenue ?? data.settings.searches.defaultRevenue,
    metric: search?.metric ?? data.settings.searches.defaultMetric,
    geography: search?.geography ?? ["United States", "Canada"],
    categories: search?.categories ?? ["Industrial software"],
    exclusions: search?.exclusions ?? ["Consumer", "Pre-revenue"],
    sources: search?.sources ?? [
      "Company websites",
      "PE portfolios",
      "Industry publications",
    ],
    domains: search?.domains ?? [],
    ownership: search?.ownership ?? "Private / PE-backed",
    companyType: search?.companyType ?? "B2B",
    dealSize: search?.dealSize ?? "",
  });
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutate(
            { type: "search.save", search: draft },
            "Search settings saved",
          )
        )
          onDone();
      }}
    >
      <div className="modal-body">
        <div className="form-section">
          <Field label="Search name">
            <input
              required
              placeholder="e.g. Industrial software"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Investment focus">
            <textarea
              rows={2}
              placeholder="What kind of business are you looking for?"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
        <div className="form-section">
          <Field label="Base research prompt">
            <textarea
              rows={4}
              value={draft.basePrompt}
              onChange={(e) => set("basePrompt", e.target.value)}
            />
          </Field>
          <AgentSelect
            role="research"
            value={draft.researchAgentId}
            onChange={(v) => set("researchAgentId", v)}
          />
          <AgentSelect
            role="judge"
            none
            value={draft.judgeAgentId}
            onChange={(v) => set("judgeAgentId", v)}
          />
          <AgentSelect
            role="writer"
            value={draft.writerAgentId}
            onChange={(v) => set("writerAgentId", v)}
          />
        </div>
        <div className="form-section">
          <div className="form-section-heading">
            <h3>Hard filters</h3>
            <Badge>Qualification criteria</Badge>
          </div>
          <p className="muted">
            Companies are checked against these requirements before deeper
            research.
          </p>
          <div className="form-grid">
            <Field label="Minimum employees">
              <input
                type="number"
                required
                min={0}
                value={draft.employees}
                onChange={(e) => set("employees", Number(e.target.value))}
              />
            </Field>
            <Field label="Minimum scale (USD millions)">
              <div className="input-with-select">
                <input
                  aria-label="Minimum scale (USD millions)"
                  type="number"
                  required
                  min={0}
                  step="any"
                  value={draft.revenue}
                  onChange={(e) => set("revenue", Number(e.target.value))}
                />
                <select
                  aria-label="Scale metric"
                  value={draft.metric}
                  onChange={(e) =>
                    set("metric", e.target.value as "Revenue" | "ARR")
                  }
                >
                  <option>Revenue</option>
                  <option>ARR</option>
                </select>
              </div>
            </Field>
          </div>
          <Field label="Geography">
            <Tags
              label="geography"
              values={draft.geography}
              onChange={(v) => set("geography", v)}
            />
          </Field>
          <Field label="Categories">
            <Tags
              label="category"
              values={draft.categories}
              onChange={(v) => set("categories", v)}
            />
          </Field>
          <div className="form-grid">
            <Field label="Ownership">
              <input
                value={draft.ownership}
                onChange={(e) => set("ownership", e.target.value)}
              />
            </Field>
            <Field label="Company type">
              <input
                value={draft.companyType}
                onChange={(e) => set("companyType", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Deal size">
            <input
              placeholder="e.g. $50–150M, or leave open"
              value={draft.dealSize}
              onChange={(e) => set("dealSize", e.target.value)}
            />
          </Field>
          <Field label="Exclude">
            <Tags
              label="exclusion"
              values={draft.exclusions}
              onChange={(v) => set("exclusions", v)}
            />
          </Field>
        </div>
        <div className="form-section">
          <div className="form-section-heading">
            <h3>Preferred research sources</h3>
            <Badge tone="blue">Soft preferences</Badge>
          </div>
          <p className="muted">
            Prioritize these sources without limiting the research to them.
          </p>
          <Tags
            label="source"
            values={draft.sources}
            onChange={(v) => set("sources", v)}
          />
          <Field label="Preferred domains">
            <Tags
              label="domain"
              values={draft.domains}
              onChange={(v) => set("domains", v)}
            />
          </Field>
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="button" onClick={onDone}>
          Cancel
        </button>
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : search ? "Save settings" : "Create search"}
          <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}
