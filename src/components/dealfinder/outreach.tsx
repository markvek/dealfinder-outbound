"use client";
import { BatchLauncher, JudgePanel, JobsPanel } from "../automation/workflows";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileText,
  Mail,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { decisionLabels, type Draft } from "@/lib/types";
import type { ViewProps } from "./ui-types";
import { Badge, CompanyMark, Empty, Field, niceDate } from "./primitives";

export function OutreachView({
  data,
  view,
  mutate,
  busy,
}: ViewProps & { view: string }) {
  const [query, setQuery] = useState("");
  const draft = data.drafts.find((d) => d.id === view);
  if (draft)
    return (
      <DraftEditor
        key={`${draft.id}-${draft.revision}-${draft.status}`}
        data={data}
        draft={draft}
        mutate={mutate}
        busy={busy}
      />
    );
  const drafts = data.drafts.filter((d) => {
    if (view === "drafts" && d.status !== "draft") return false;
    if (view === "approved" && d.status !== "approved") return false;
    if (view === "past" && !["rejected", "handed-off"].includes(d.status))
      return false;
    const c = data.companies.find((c) => c.id === d.companyId);
    return c?.name.toLowerCase().includes(query.toLowerCase());
  });
  const ready = data.companies.filter(
    (c) =>
      ["priority", "reach-out"].includes(c.decision ?? "") &&
      !data.drafts.some(
        (d) => d.companyId === c.id && ["draft", "approved"].includes(d.status),
      ) &&
      !data.companies.some(
        (other) => other.domain === c.domain && other.decision === "talking",
      ),
  );
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">04 / OUTREACH</div>
          <h1>Outreach</h1>
        </div>
        <Link className="button" href="/outreach/settings">
          <Mail size={15} />
          Writing preferences
        </Link>
      </div>
      <div className="metrics-strip">
        <div>
          <span className="metric-icon">
            <FileText size={18} />
          </span>
          <section>
            <span>Awaiting approval</span>
            <strong>
              {data.drafts
                .filter((d) => d.status === "draft")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </section>
        </div>
        <div>
          <span className="metric-icon">
            <CheckCheck size={18} />
          </span>
          <section>
            <span>Approved emails</span>
            <strong>
              {data.drafts
                .filter((d) => d.status === "approved")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </section>
        </div>
        <div>
          <span className="metric-icon">
            <ArrowUpRight size={18} />
          </span>
          <section>
            <span>Manually handed off</span>
            <strong>
              {data.drafts
                .filter((d) => d.status === "handed-off")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </section>
        </div>
      </div>
      {ready.length > 0 && (!view || view === "drafts") && (
        <section className="panel ready-panel">
          <div className="panel-heading">
            <h2>Ready for a first draft</h2>
            <Badge tone="blue">
              {ready.length} approved{" "}
              {ready.length === 1 ? "company" : "companies"}
            </Badge>
          </div>
          <BatchLauncher
            companies={ready}
            label="Generate all eligible drafts"
          />
          {ready.map((c) => (
            <div className="ready-row" key={c.id}>
              <CompanyMark company={c} />
              <div>
                <strong>{c.name}</strong>
                <span>
                  {c.decision === "priority" ? (
                    <>
                      <Star size={12} />
                      Top priority
                    </>
                  ) : (
                    "Good — reach out"
                  )}
                </span>
              </div>
              <BatchLauncher companies={[c]} label="Generate draft" />
            </div>
          ))}
        </section>
      )}
      <div className="section-toolbar">
        <div className="segmented">
          <Link href="/outreach" className={!view ? "selected" : ""}>
            All emails
          </Link>
          <Link
            href="/outreach/drafts"
            className={view === "drafts" ? "selected" : ""}
          >
            Drafts
          </Link>
          <Link
            href="/outreach/approved"
            className={view === "approved" ? "selected" : ""}
          >
            Approved
          </Link>
          <Link
            href="/outreach/past"
            className={view === "past" ? "selected" : ""}
          >
            Past
          </Link>
        </div>
        <label className="search-input">
          <Search size={15} />
          <input
            aria-label="Find an email"
            placeholder="Find an email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="panel email-list">
        {drafts.map((d) => {
          const c = data.companies.find((c) => c.id === d.companyId)!;
          return (
            <Link
              href={`/outreach/${d.id}`}
              key={d.id}
              className="email-list-row"
            >
              <CompanyMark company={c} />
              <div>
                <strong>{c.name}</strong>
                <p>{d.subject}</p>
              </div>
              <Badge
                tone={
                  d.status === "approved"
                    ? "green"
                    : d.status === "draft"
                      ? "blue"
                      : "neutral"
                }
              >
                {d.status === "draft"
                  ? "Needs approval"
                  : d.status === "handed-off"
                    ? "Handed off"
                    : d.status}
              </Badge>
              <span className="small-muted">{niceDate(d.updatedAt)}</span>
              <ArrowUpRight size={16} />
            </Link>
          );
        })}
        {drafts.length === 0 && (
          <Empty title="No email drafts">
            Approve a company in the Review Queue, then prepare and personalize
            its first email.
          </Empty>
        )}
      </div>
      <div className="page-footnote">
        <ShieldCheck size={14} />
        Nothing leaves this workspace automatically. You review every email.
      </div>
    </div>
  );
}
function DraftEditor({
  data,
  draft,
  mutate,
  busy,
}: ViewProps & { draft: Draft }) {
  const company = data.companies.find((c) => c.id === draft.companyId)!;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [recipient, setRecipient] = useState(draft.recipient);
  const [copied, setCopied] = useState("");
  const dirty =
    subject !== draft.subject ||
    body !== draft.body ||
    recipient !== draft.recipient;
  const blocked =
    draft.status === "handed-off" ||
    !["reach-out", "priority"].includes(company.decision ?? "") ||
    draft.decision !== company.decision ||
    draft.memoVersion !== company.memoVersion ||
    data.companies.some(
      (c) => c.domain === company.domain && c.decision === "talking",
    );
  async function exportApproved(format: "text" | "csv") {
    const response = await fetch("/api/outreach/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: draft.id, version: data.version, format }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result as { text: string; filename?: string };
  }
  async function copy() {
    try {
      const result = await exportApproved("text");
      await navigator.clipboard.writeText(result.text);
      setCopied("Copied approved text");
    } catch (error) {
      setCopied(
        error instanceof Error ? error.message : "Could not copy this email.",
      );
    }
  }
  async function download() {
    try {
      const result = await exportApproved("csv");
      const url = URL.createObjectURL(
        new Blob([result.text], { type: "text/csv;charset=utf-8;" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename ?? "outreach.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setCopied(
        error instanceof Error ? error.message : "Could not export this email.",
      );
    }
  }
  return (
    <div className="page-content">
      <Link href="/outreach" className="back-link">
        ← All outreach
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EMAIL DRAFT</div>
          <h1>Email draft — {company.name}</h1>
        </div>
        <Badge tone={draft.status === "approved" ? "green" : "blue"}>
          {draft.status} · v{draft.revision}
        </Badge>
      </div>
      <JudgePanel company={company} draft={draft} />
      <BatchLauncher companies={[company]} label="Regenerate draft" />
      <JobsPanel companyId={company.id} />
      <div className="research-layout">
        <div className="research-main">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Mail size={17} />
                Email draft
              </h2>
              <Badge>{draft.agentName ?? "Starter template"}</Badge>
            </div>
            <p className="muted">
              Prepared from the approved memo. Replace placeholders and edit
              before approval.
            </p>
            <form
              className="email-form"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  {
                    type: "draft.save",
                    id: draft.id,
                    subject,
                    body,
                    recipient,
                  },
                  "Draft saved; approval required",
                );
              }}
            >
              <Field label="Recipient email">
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={recipient}
                  disabled={blocked}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </Field>
              <Field label="Subject">
                <input
                  required
                  value={subject}
                  disabled={blocked}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
              <Field label="Message">
                <textarea
                  className="email-body"
                  required
                  rows={16}
                  value={body}
                  disabled={blocked}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              <div className="draft-actions">
                <span className="small-muted">
                  {dirty
                    ? "Unsaved changes · save before approving"
                    : `Revision ${draft.revision} · all changes saved`}
                </span>
                <button className="button" disabled={busy || !dirty || blocked}>
                  Save changes
                </button>
              </div>
            </form>
            <div className="approval-actions">
              <button
                className="button button-primary"
                disabled={busy || dirty || blocked || draft.status !== "draft"}
                onClick={() =>
                  mutate(
                    { type: "draft.approve", id: draft.id },
                    "Exact email revision approved",
                  )
                }
              >
                <Check size={15} />
                Approve email
              </button>
              <button
                className="button button-quiet"
                disabled={
                  busy || dirty || blocked || draft.status === "rejected"
                }
                onClick={() =>
                  mutate(
                    { type: "draft.reject", id: draft.id },
                    "Draft rejected",
                  )
                }
              >
                <X size={15} />
                Reject
              </button>
            </div>
          </section>
          {draft.status === "approved" && !blocked && (
            <section className="panel handoff-panel">
              <div className="panel-heading">
                <h2>
                  <CheckCheck size={17} />
                  Approved for manual handoff
                </h2>
              </div>
              <p className="muted">
                Copy the approved text or export it for your outreach tool.
                Edits require a new approval.
              </p>
              <div className="heading-actions">
                <button className="button" onClick={copy} disabled={dirty}>
                  <Copy size={14} />
                  Copy email
                </button>
                <button
                  className="button"
                  onClick={download}
                  disabled={dirty || company.sample || !draft.recipient}
                >
                  <Download size={14} />
                  Export CSV
                </button>
                <button
                  className="button button-primary"
                  disabled={busy || dirty || company.sample || !draft.recipient}
                  onClick={() =>
                    mutate(
                      { type: "draft.handoff", id: draft.id },
                      "Manual handoff recorded",
                    )
                  }
                >
                  <ArrowUpRight size={14} />
                  Mark handed off
                </button>
              </div>
              {company.sample && (
                <p className="small-muted">
                  Sample companies can be reviewed and approved, but cannot be
                  exported or handed off.
                </p>
              )}
              {!draft.recipient && (
                <p className="small-muted">
                  Add a recipient, save, and reapprove to enable export and
                  handoff.
                </p>
              )}
              {copied && (
                <p className="small-muted" role="status">
                  {copied}
                </p>
              )}
            </section>
          )}
        </div>
        <aside className="research-aside">
          <section className="panel">
            <div className="company-cell">
              <CompanyMark company={company} />
              <div>
                <strong>{company.name}</strong>
                <span>{company.domain}</span>
              </div>
            </div>
            <div className="current-decision">
              <span>Approved company decision</span>
              <strong>{decisionLabels[draft.decision]}</strong>
            </div>
            <h3 className="small-title">The approved memo</h3>
            <p className="muted">{company.description}</p>
            <h3 className="small-title">Why it matters</h3>
            <p className="muted">{company.criticality}</p>
            <Link className="text-link" href={`/companies/${company.id}`}>
              Read full memo
              <ArrowUpRight size={14} />
            </Link>
          </section>
          <div className="aside-note">
            <ShieldCheck size={17} />
            <p>
              Memo v{draft.memoVersion} is the source.
              <br />
              No additional company research.
            </p>
          </div>
          {blocked && (
            <div className="info-note">
              This revision is preserved as history. If the company is eligible,
              prepare a fresh draft from its current approved decision.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
