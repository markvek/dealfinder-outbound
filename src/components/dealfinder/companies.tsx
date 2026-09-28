"use client";
import {
  BatchLauncher,
  CompanyAgentSettings,
  JudgePanel,
  JobsPanel,
} from "../automation/workflows";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  FileText,
  Globe2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { decisionLabels, type Company, type Decision } from "@/lib/types";
import type { ViewProps } from "./ui-types";
import {
  Badge,
  CompanyMark,
  Empty,
  Field,
  Modal,
  SourceLink,
  niceDate,
} from "./primitives";

export function CompaniesView({
  data,
  view,
  mutate,
  busy,
  review = false,
}: ViewProps & { view: string; review?: boolean }) {
  const params = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(params.get("query") ?? "");
  const [qualification, setQualification] = useState(
    params.get("qualification") ?? "all",
  );
  const [adding, setAdding] = useState(false);
  const company = data.companies.find((c) => c.id === view);
  const listView = company ? (params.get("list") ?? "") : view;
  const defaultPending =
    review && !listView && data.settings.review.defaultView === "pending";
  const list = data.companies.filter((c) => {
    if (
      !`${c.name} ${c.domain} ${c.category}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      return false;
    if (qualification !== "all" && c.qualification !== qualification)
      return false;
    if (
      !review &&
      !data.settings.companies.showUncertain &&
      c.qualification === "Uncertain"
    )
      return false;
    if (
      listView.startsWith("search-") &&
      !(c.searchIds ?? [c.searchId]).includes(listView.slice(7))
    )
      return false;
    if (listView === "active" && ["pass", "talking"].includes(c.decision ?? ""))
      return false;
    if (
      listView === "past" &&
      (review ? !c.decision : !["pass", "talking"].includes(c.decision ?? ""))
    )
      return false;
    if (
      (listView === "pending" || defaultPending) &&
      (c.decision || c.qualification === "Fail")
    )
      return false;
    if (listView === "priority" && c.decision !== "priority") return false;
    return true;
  });
  const outside = !!company && !list.some((c) => c.id === company.id);
  if (company)
    return (
      <CompanyDetail
        key={company.id}
        data={data}
        company={company}
        review={review}
        list={outside ? data.companies : list}
        resetContext={outside}
        context={new URLSearchParams({
          list: outside ? "all" : listView,
          query: outside ? "" : query,
          qualification: outside ? "all" : qualification,
        }).toString()}
        mutate={mutate}
        busy={busy}
      />
    );
  const pending = data.companies.filter(
    (c) => !c.decision && c.qualification !== "Fail",
  ).length;
  const selectedSearch = data.searches.find((s) => `search-${s.id}` === view);
  const title = review
    ? view === "past"
      ? "Past reviews"
      : view === "priority"
        ? "Top priority"
        : "Review Queue"
    : selectedSearch
      ? selectedSearch.name
      : view === "past"
        ? "Past companies"
        : "Companies";
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {review ? "03 / REVIEW" : "02 / COMPANIES"}
          </div>
          <h1>{title}</h1>
          <p>
            {review ? "Review company research and record a decision." : ""}
          </p>
        </div>
        {!review && (
          <button
            className="button button-primary"
            onClick={() => setAdding(true)}
          >
            <Plus size={16} />
            Add company
          </button>
        )}
      </div>
      {review && (
        <div className="review-summary">
          <div>
            <span className="summary-icon">
              <ShieldCheck size={23} strokeWidth={1.5} />
            </span>
            <section>
              <strong>{pending} companies awaiting review</strong>
              <p>
                Review the memo, follow the sources, and choose the next step.
              </p>
            </section>
          </div>
          <Badge tone="blue">Human approval required</Badge>
        </div>
      )}
      <section className="panel">
        <div className="heading-actions">
          <label className="check-row">
            <input
              type="checkbox"
              checked={
                list.length > 0 && list.every((c) => selected.includes(c.id))
              }
              onChange={(e) =>
                setSelected(e.target.checked ? list.map((c) => c.id) : [])
              }
            />
            Select filtered companies
          </label>
          <BatchLauncher
            companies={list.filter((c) => selected.includes(c.id))}
          />
          <BatchLauncher
            companies={list.filter((c) => selected.includes(c.id))}
            role="judge"
          />
        </div>
        <div className="tags">
          {list.map((c) => (
            <label className="check-row" key={c.id}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, c.id]
                      : selected.filter((id) => id !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      </section>
      <div className="section-toolbar">
        <div className="segmented">
          {review ? (
            <>
              <Link
                href="/review/pending"
                className={
                  view === "pending" || defaultPending ? "selected" : ""
                }
              >
                Needs review <span>{pending}</span>
              </Link>
              <Link
                href="/review/past"
                className={view === "past" ? "selected" : ""}
              >
                Reviewed
              </Link>
            </>
          ) : (
            <>
              <Link href="/companies" className={!view ? "selected" : ""}>
                All companies <span>{data.companies.length}</span>
              </Link>
              <Link
                href="/companies/active"
                className={view === "active" ? "selected" : ""}
              >
                Active
              </Link>
              <Link
                href="/companies/past"
                className={view === "past" ? "selected" : ""}
              >
                Past
              </Link>
            </>
          )}
        </div>
        <div className="table-controls">
          <label className="search-input">
            <Search size={15} />
            <input
              aria-label="Find a company"
              placeholder="Find a company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="filter-select"
            aria-label="Filter by qualification"
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
          >
            <option value="all">All qualifications</option>
            {["Pass", "Likely pass", "Uncertain", "Fail"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-panel">
        <table className="companies-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Category</th>
              <th>Scale</th>
              <th>{review ? "Qualification" : "Status"}</th>
              <th aria-label="Open company" />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link
                    className="company-cell"
                    href={`/${review ? "review" : "companies"}/${c.id}?${new URLSearchParams({ list: listView, query, qualification })}`}
                  >
                    <CompanyMark company={c} />
                    <div>
                      <strong>{c.name}</strong>
                      <span>
                        {c.domain}
                        {c.sample && (
                          <span className="sample-label">Sample</span>
                        )}
                      </span>
                    </div>
                  </Link>
                </td>
                <td>
                  <span className="table-category">{c.category}</span>
                  <small>{c.geography}</small>
                </td>
                <td>
                  <strong className="table-number">
                    {c.revenue === null ? "Unconfirmed" : `$${c.revenue}M`}
                  </strong>
                  <small>{c.employees} employees</small>
                </td>
                <td>
                  <Badge
                    tone={
                      c.decision === "priority"
                        ? "blue"
                        : c.decision === "talking"
                          ? "neutral"
                          : c.qualification === "Uncertain"
                            ? "amber"
                            : c.qualification === "Fail" ||
                                c.decision === "pass"
                              ? "neutral"
                              : "green"
                    }
                  >
                    {review
                      ? c.qualification
                      : c.decision === "priority"
                        ? "Top priority"
                        : c.decision === "talking"
                          ? "Already talking"
                          : c.decision === "reach-out"
                            ? "Reach out"
                            : c.decision === "pass"
                              ? "Not a priority"
                              : c.qualification === "Uncertain"
                                ? "Uncertain"
                                : c.qualification === "Fail"
                                  ? "Excluded"
                                  : "Needs review"}
                  </Badge>
                </td>
                <td>
                  <Link
                    className="row-open"
                    href={`/${review ? "review" : "companies"}/${c.id}?${new URLSearchParams({ list: listView, query, qualification })}`}
                    aria-label={`Open ${c.name}`}
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <Empty title="Nothing here just yet">
            Try another filter, or add a company to begin researching.
          </Empty>
        )}
        <div className="table-footer">
          <span>
            {list.length} {list.length === 1 ? "company" : "companies"}
          </span>
          <span>Research evidence and human decisions stay separate.</span>
        </div>
      </div>
      <div className="page-footnote">
        <span className="sample-indicator" />
        Sample records are fictional and their evidence is illustrative.
      </div>
      {adding && (
        <Modal
          title="Add a researched company"
          onClose={() => setAdding(false)}
        >
          <CompanyEditor
            data={data}
            mutate={mutate}
            busy={busy}
            onDone={() => setAdding(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function CompanyDetail({
  data,
  company,
  list,
  context,
  resetContext,
  review,
  mutate,
  busy,
}: ViewProps & {
  company: Company;
  list: Company[];
  context: string;
  resetContext: boolean;
  review: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(company.notes);
  const search = data.searches.find((s) => s.id === company.searchId);
  const events = data.history.filter((h) => h.companyId === company.id);
  const canDraft = ["reach-out", "priority"].includes(company.decision ?? "");
  const existingDraft = data.drafts.find(
    (d) =>
      d.companyId === company.id && ["draft", "approved"].includes(d.status),
  );
  const [openedAt] = useState(() => Date.now());
  const stale =
    openedAt - new Date(company.discoveredAt).getTime() >
    data.settings.companies.freshnessDays * 86400000;
  const index = list.findIndex((c) => c.id === company.id);
  function navigate(offset: number) {
    const next = list[index + offset];
    if (
      next &&
      (notes === company.notes ||
        window.confirm("Discard unsaved review notes?"))
    )
      router.push(`/${review ? "review" : "companies"}/${next.id}?${context}`);
  }
  return (
    <div className="page-content">
      <Link
        className="back-link"
        href={`/${review ? "review" : "companies"}/${new URLSearchParams(context).get("list") === "all" ? "" : (new URLSearchParams(context).get("list") ?? "")}?${context}`}
      >
        ← {review ? "Review Queue" : "All companies"}
      </Link>
      {resetContext && (
        <p className="small-muted">
          This company no longer matches the selected filter. Navigation now
          includes all companies.
        </p>
      )}
      <div className="heading-actions company-navigation">
        <button
          className="button"
          aria-label="Previous company"
          disabled={index <= 0}
          onClick={() => navigate(-1)}
        >
          ← Previous
        </button>
        <span>
          {index < 0
            ? "Outside current filter"
            : `${index + 1} / ${list.length}`}
        </span>
        <button
          className="button"
          aria-label="Next company"
          disabled={index < 0 || index >= list.length - 1}
          onClick={() => navigate(1)}
        >
          Next →
        </button>
      </div>
      <div className="company-detail-heading">
        <CompanyMark company={company} large />
        <div>
          <div className="eyebrow">{company.category}</div>
          <h1>{company.name}</h1>
          <div className="company-meta">
            <span>
              <Globe2 size={13} />
              {company.domain}
            </span>
            <span>{company.geography}</span>
            {company.sample && <Badge>Sample company</Badge>}
            {stale && <Badge tone="amber">Research needs refreshing</Badge>}
          </div>
        </div>
        <div className="heading-actions">
          {canDraft &&
            (existingDraft ? (
              <Link
                href={`/outreach/${existingDraft.id}`}
                className="button button-primary"
              >
                <Mail size={15} />
                Open email draft
              </Link>
            ) : (
              <BatchLauncher companies={[company]} label="Generate outreach" />
            ))}
        </div>
      </div>
      <div className="company-stats">
        <div>
          <span>{search?.metric ?? "Revenue"}</span>
          <strong>
            {company.revenue === null
              ? "Not confirmed"
              : `$${company.revenue}M`}
          </strong>
        </div>
        <div>
          <span>Employees</span>
          <strong>{company.employees || "Unknown"}</strong>
        </div>
        <div>
          <span>Qualification</span>
          <Badge
            tone={
              company.qualification === "Uncertain"
                ? "amber"
                : company.qualification === "Fail"
                  ? "neutral"
                  : "green"
            }
          >
            {company.qualification}
          </Badge>
        </div>
        <div>
          <span>Search</span>
          <Link href={`/searches/${search?.id}`}>
            {search?.name}
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
      <div className="research-layout">
        <div className="research-main">
          <section className="panel memo-panel">
            <div className="panel-heading">
              <h2>
                <FileText size={17} />
                Company research memo
              </h2>
              <span className="small-muted">
                Version {company.memoVersion} · {niceDate(company.discoveredAt)}
              </span>
            </div>
            <section>
              <h3>What they do</h3>
              <p>{company.description}</p>
            </section>
            <section>
              <h3>Who they sell to</h3>
              <p>
                {company.customers ||
                  "Customer profile has not been confirmed."}
              </p>
            </section>
            <section className="criticality-box">
              <h3>
                <LayersIcon />
                Why it matters to the customer
              </h3>
              <p>{company.criticality}</p>
            </section>
            <section>
              <h3>Why they surfaced</h3>
              <p>
                Included in {search?.name ?? "this search"} for its focus on{" "}
                {company.category.toLowerCase()}.{" "}
                {company.qualification === "Uncertain"
                  ? "Some hard criteria still need verification."
                  : company.qualification === "Fail"
                    ? "One or more hard criteria fail; outreach is blocked."
                    : "The basic profile aligns with the search criteria."}
              </p>
            </section>
            <section>
              <h3>
                <CircleAlert size={15} />
                Open questions
              </h3>
              <p>{company.concern || "No additional concerns recorded."}</p>
            </section>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Evidence & sources</h2>
              <Badge>{company.evidence.length} sources</Badge>
            </div>
            {company.evidence.map((e, i) => (
              <div className="evidence-row" key={i}>
                <span className="evidence-number">0{i + 1}</span>
                <div>
                  <SourceLink href={e.url}>{e.title}</SourceLink>
                  <p>{e.detail}</p>
                </div>
              </div>
            ))}
          </section>
          {events.length > 0 && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Decision history</h2>
                <Clock3 size={16} />
              </div>
              <div className="timeline">
                {events.map((event) => (
                  <div key={event.id}>
                    <span />
                    <section>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                      <small>
                        {event.reviewer} · {niceDate(event.at)}
                      </small>
                    </section>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="research-aside">
          <section className="panel decision-panel">
            <div className="panel-heading">
              <h2>Review decision</h2>
              <ShieldCheck size={17} />
            </div>
            <p className="muted">Select a decision for this memo.</p>
            {company.decision && (
              <div className="current-decision">
                <span>Current decision</span>
                <strong>{decisionLabels[company.decision]}</strong>
              </div>
            )}
            <Field
              label={`Review notes${data.settings.review.requireNotes ? " (required)" : " (optional)"}`}
            >
              <textarea
                rows={3}
                placeholder="What stood out to you?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <div className="decision-options">
              {(["priority", "reach-out", "talking", "pass"] as Decision[]).map(
                (d) => (
                  <button
                    key={d}
                    className={`decision-option ${company.decision === d ? "chosen" : ""}`}
                    disabled={
                      busy ||
                      (company.qualification === "Fail" &&
                        ["priority", "reach-out"].includes(d))
                    }
                    onClick={() =>
                      mutate(
                        {
                          type: "company.decision",
                          id: company.id,
                          decision: d,
                          notes,
                        },
                        "Decision saved to history",
                      )
                    }
                  >
                    <span className={`decision-icon ${d}`}>
                      {d === "priority" ? (
                        <Star size={16} />
                      ) : d === "reach-out" ? (
                        <ArrowUpRight size={16} />
                      ) : d === "talking" ? (
                        <CheckCheck size={16} />
                      ) : (
                        <X size={16} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {d === "priority"
                          ? "Great — top priority"
                          : d === "reach-out"
                            ? "Good — I’ll reach out"
                            : d === "talking"
                              ? "Good — already talking"
                              : "No — not a priority"}
                      </strong>
                      <small>
                        {d === "priority"
                          ? "A more deliberate, personal approach"
                          : d === "reach-out"
                            ? "Prepare a bespoke first email"
                            : d === "talking"
                              ? "Keep the record. Stop outreach."
                              : "No further work for now"}
                      </small>
                    </span>
                    {company.decision === d && <Check size={14} />}
                  </button>
                ),
              )}
            </div>
            <p className="decision-footnote">
              Your decision applies to memo v{company.memoVersion}. Emails use
              only the approved memo.
            </p>
          </section>
          <CompanyAgentSettings
            key={`${company.id}-${company.writerAgentId}-${company.judgeAgentId}-${company.draftJudgeAgentId}`}
            company={company}
          />
          <JudgePanel company={company} mutate={mutate} />
        </aside>
      </div>
      <JobsPanel companyId={company.id} />
    </div>
  );
}
function LayersIcon() {
  return <Building2 size={16} />;
}
function CompanyEditor({
  data,
  mutate,
  busy,
  onDone,
}: ViewProps & { onDone: () => void }) {
  const [draft, setDraft] = useState({
    searchId: data.searches.find((s) => s.status === "active")?.id ?? "",
    name: "",
    domain: "",
    category: "Industrial software",
    geography: "United States",
    employees: 0,
    revenue: "" as string,
    description: "",
    customers: "",
    criticality: "",
    concern: "",
    source: "",
  });
  const set = (key: string, value: string | number) =>
    setDraft((p) => ({ ...p, [key]: value }));
  const selectedSearch = data.searches.find((s) => s.id === draft.searchId);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutate(
            {
              type: "company.add",
              company: {
                ...draft,
                revenue: draft.revenue === "" ? null : Number(draft.revenue),
              },
            },
            "Company and research saved",
          )
        )
          onDone();
      }}
    >
      <div className="modal-body form-section">
        <p className="muted">
          Add your own research. Basic filters are checked immediately;
          unverified criteria stay uncertain.
        </p>
        <Field label="Search">
          <select
            value={draft.searchId}
            onChange={(e) => set("searchId", e.target.value)}
            required
          >
            {data.searches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Company name">
            <input
              required
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Website / domain">
            <input
              required
              placeholder="company.com"
              value={draft.domain}
              onChange={(e) => set("domain", e.target.value)}
            />
          </Field>
          <Field label="Category">
            <input
              required
              value={draft.category}
              onChange={(e) => set("category", e.target.value)}
            />
          </Field>
          <Field label="Geography">
            <input
              required
              value={draft.geography}
              onChange={(e) => set("geography", e.target.value)}
            />
          </Field>
          <Field label="Employees (0 if unknown)">
            <input
              type="number"
              min={0}
              value={draft.employees}
              onChange={(e) => set("employees", Number(e.target.value))}
            />
          </Field>
          <Field
            label={`${selectedSearch?.metric ?? "Revenue"} (USD millions)`}
          >
            <input
              type="number"
              step="any"
              min={0}
              placeholder="Leave blank if unknown"
              value={draft.revenue}
              onChange={(e) => set("revenue", e.target.value)}
            />
          </Field>
        </div>
        <Field label="What they do">
          <textarea
            required
            rows={2}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="Who they sell to">
          <textarea
            rows={2}
            value={draft.customers}
            onChange={(e) => set("customers", e.target.value)}
          />
        </Field>
        <Field label="Why it is critical to their customers">
          <textarea
            required
            rows={3}
            value={draft.criticality}
            onChange={(e) => set("criticality", e.target.value)}
          />
        </Field>
        <Field label="Concerns / open questions">
          <textarea
            rows={2}
            value={draft.concern}
            onChange={(e) => set("concern", e.target.value)}
          />
        </Field>
        <Field label="Supporting source URL">
          <input
            required
            type="url"
            placeholder="https://…"
            value={draft.source}
            onChange={(e) => set("source", e.target.value)}
          />
        </Field>
      </div>
      <div className="modal-footer">
        <button className="button" type="button" onClick={onDone}>
          Cancel
        </button>
        <button className="button button-primary" disabled={busy}>
          Save company
          <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}
