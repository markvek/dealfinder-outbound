"use client";
import { AutomationProvider, useAutomation } from "../automation/context";
import { AutomationSettings } from "../automation/settings";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CircleHelp,
  FolderClosed,
  Layers2,
  Menu,
  Plus,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { stepLabels, steps, type Step, type Workspace } from "@/lib/types";
import type { Action } from "@/server/workflow";
import { SearchView, SearchEditor } from "./searches";
import { CompaniesView } from "./companies";
import { OutreachView } from "./outreach";
import { SettingsView } from "./settings";
import { Modal, FormErrorContext } from "./primitives";

export function WorkspaceApp(props: { step: string; view: string }) {
  return (
    <AutomationProvider>
      <WorkspaceBody {...props} />
    </AutomationProvider>
  );
}
function WorkspaceBody({ step, view }: { step: string; view: string }) {
  const automation = useAutomation();
  const [localData, setData] = useState<Workspace | null>(null);
  const remoteData = automation.state?.workspace;
  const data =
    remoteData && (!localData || remoteData.version >= localData.version)
      ? remoteData
      : localData;
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [newSearch, setNewSearch] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace")
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load this local workspace.");
        return r.json();
      })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [step, view]);
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timeout);
    }
  }, [toast]);
  async function mutate(action: Action, message = "Changes saved") {
    if (!data || busy) return null;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: data.version, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
      window.dispatchEvent(new Event("workspace-updated"));
      setToast(message);
      return result as Workspace;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const activeStep = steps.includes(step as Step) ? (step as Step) : "searches";
  const pending =
    data?.companies.filter((c) => !c.decision && c.qualification !== "Fail")
      .length ?? 0;
  const count = (s: Step) =>
    s === "searches"
      ? data?.searches.filter((x) => x.status === "active").length
      : s === "companies"
        ? data?.companies.length
        : s === "review"
          ? pending
          : data?.drafts.filter((d) => d.status === "draft").length;
  function sidebarLink(
    href: string,
    label: string,
    selected: boolean,
    count?: number,
  ) {
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setMobile(false)}
        className={`side-link ${selected ? "selected" : ""}`}
      >
        <FolderClosed size={15} />
        <span>{label}</span>
        {count !== undefined && <span className="side-count">{count}</span>}
      </Link>
    );
  }
  const sidebar = (
    <>
      <div className="sidebar-heading">
        <span>
          {step === "settings" ? "Workspace settings" : stepLabels[activeStep]}
        </span>
        {step === "searches" && (
          <button
            className="icon-button"
            aria-label="New search"
            onClick={() => setNewSearch(true)}
          >
            <Plus size={17} />
          </button>
        )}
      </div>
      {step === "settings" ? (
        <>
          <p className="sidebar-label">GENERAL</p>
          {sidebarLink("/settings", "General settings", !view)}
          {sidebarLink("/settings/agents", "Agents", view === "agents")}
          {sidebarLink(
            "/settings/access",
            "Agent access / MCP",
            view === "access",
          )}
          {sidebarLink("/settings/jobs", "Jobs", view === "jobs")}
          {steps.map((s) =>
            sidebarLink(`/${s}/settings`, `${stepLabels[s]} settings`, false),
          )}
        </>
      ) : (
        <>
          {sidebarLink(
            `/${step}`,
            `All ${step === "review" ? "reviews" : stepLabels[activeStep].toLowerCase()}`,
            !view,
            count(activeStep),
          )}
          {step === "searches" && (
            <>
              <p className="sidebar-label">
                <span className="tiny-dot" />
                ACTIVE SEARCHES
              </p>
              {data?.searches
                .filter((s) => s.status === "active")
                .map((s) => (
                  <Link
                    className={`search-side-item ${view === s.id ? "selected" : ""}`}
                    href={`/searches/${s.id}`}
                    key={s.id}
                    onClick={() => setMobile(false)}
                  >
                    <span className="tree-line" />
                    <span>{s.name}</span>
                  </Link>
                ))}
              <Link
                className="side-add"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setNewSearch(true);
                }}
              >
                <Plus size={14} />
                New search
              </Link>
              <p className="sidebar-label">PAST SEARCHES</p>
              {data?.searches
                .filter((s) => s.status === "past")
                .map((s) => (
                  <Link
                    className={`search-side-item ${view === s.id ? "selected" : ""}`}
                    href={`/searches/${s.id}`}
                    key={s.id}
                    onClick={() => setMobile(false)}
                  >
                    <span className="tree-line" />
                    <span>{s.name}</span>
                  </Link>
                ))}
            </>
          )}
          {step === "companies" && (
            <>
              <p className="sidebar-label">YOUR COMPANIES</p>
              {sidebarLink(
                "/companies/active",
                "Active companies",
                view === "active",
                data?.companies.filter(
                  (c) => !["pass", "talking"].includes(c.decision ?? ""),
                ).length,
              )}
              {sidebarLink(
                "/companies/past",
                "Past companies",
                view === "past",
                data?.companies.filter((c) =>
                  ["pass", "talking"].includes(c.decision ?? ""),
                ).length,
              )}
              <p className="sidebar-label">BY SEARCH</p>
              {data?.searches.map((s) => (
                <Link
                  key={s.id}
                  className={`search-side-item ${view === `search-${s.id}` ? "selected" : ""}`}
                  href={`/companies/search-${s.id}`}
                >
                  <span className="tree-line" />
                  {s.name}
                </Link>
              ))}
            </>
          )}
          {step === "review" && (
            <>
              <p className="sidebar-label">REVIEW STATUS</p>
              {sidebarLink(
                "/review/pending",
                "Needs review",
                view === "pending",
                pending,
              )}
              {sidebarLink(
                "/review/priority",
                "Top priority",
                view === "priority",
                data?.companies.filter((c) => c.decision === "priority").length,
              )}
              {sidebarLink(
                "/review/past",
                "Past reviews",
                view === "past",
                data?.companies.filter((c) => c.decision).length,
              )}
            </>
          )}
          {step === "outreach" && (
            <>
              <p className="sidebar-label">EMAIL STATUS</p>
              {sidebarLink(
                "/outreach/drafts",
                "Active drafts",
                view === "drafts",
                data?.drafts.filter((d) => d.status === "draft").length,
              )}
              {sidebarLink(
                "/outreach/approved",
                "Approved emails",
                view === "approved",
                data?.drafts.filter((d) => d.status === "approved").length,
              )}
              {sidebarLink(
                "/outreach/past",
                "Past outreach",
                view === "past",
                data?.drafts.filter((d) =>
                  ["rejected", "handed-off"].includes(d.status),
                ).length,
              )}
            </>
          )}
          <div className="sidebar-divider" />
          <Link
            href={`/${step}/settings`}
            className={`side-link ${view === "settings" ? "selected" : ""}`}
          >
            <SlidersHorizontal size={15} />
            <span>{stepLabels[activeStep]} settings</span>
          </Link>
        </>
      )}
      <div className="sidebar-bottom">
        <Link
          href="/settings"
          className={`side-link ${step === "settings" ? "selected" : ""}`}
        >
          <Settings2 size={15} />
          <span>General settings</span>
        </Link>
        <button className="side-link help-link" onClick={() => setHelp(true)}>
          <CircleHelp size={15} />
          <span>Workflow guide</span>
          <ArrowRight size={14} />
        </button>
        <div className="local-status">
          <span className="tiny-dot" />
          Local workspace<span>v0.1</span>
        </div>
      </div>
    </>
  );
  return (
    <FormErrorContext.Provider value={error}>
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <header className="topbar">
          <Link className="brand" href="/searches">
            <span className="brand-icon">
              <Layers2 size={20} strokeWidth={1.7} />
            </span>
            <span>
              dealfinder<span className="brand-period">.</span>
            </span>
          </Link>
          <nav className="step-nav" aria-label="Core workflow">
            {steps.map((s, i) => (
              <Link
                key={s}
                href={`/${s}`}
                className={`step-tab ${step === s ? "active" : ""}`}
                aria-current={step === s ? "page" : undefined}
              >
                <span className="step-number">0{i + 1}</span>
                <span>{stepLabels[s]}</span>
                {s === "review" && pending > 0 && (
                  <span className="nav-count">{pending}</span>
                )}
              </Link>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="workspace-label">Private workspace</span>
            <Link
              href="/settings"
              className="user-avatar"
              aria-label="General settings"
            >
              {data?.settings.reviewer.slice(0, 1).toUpperCase() || "D"}
            </Link>
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle sidebar"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </header>
        <div className="app-body">
          <aside
            className={`sidebar ${mobile ? "mobile-open" : ""}`}
            aria-label="Step navigation"
          >
            {sidebar}
          </aside>
          {mobile && (
            <button
              className="sidebar-backdrop"
              onClick={() => setMobile(false)}
              aria-label="Close sidebar"
            />
          )}
          <main id="main-content" className="main-content">
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <div>
                  <button onClick={() => window.location.reload()}>
                    Refresh
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => setError("")}
                    aria-label="Dismiss error"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}
            {!data ? (
              <div className="loading">
                <span className="loading-spinner" />
                Opening your workspace…
              </div>
            ) : (
              <>
                <div className="breadcrumb">
                  <span>{data.settings.workspace}</span>
                  <span>/</span>
                  <span>
                    {step === "settings"
                      ? "General settings"
                      : stepLabels[activeStep]}
                  </span>
                  {view === "settings" && (
                    <>
                      <span>/</span>
                      <span>Settings</span>
                    </>
                  )}
                  <span className="breadcrumb-end">
                    <span className="tiny-dot" />
                    Saved locally
                  </span>
                </div>
                {step === "settings" &&
                ["agents", "access", "jobs"].includes(view) ? (
                  <AutomationSettings view={view} />
                ) : step === "settings" || view === "settings" ? (
                  <SettingsView
                    key={`${step}-${data.settings.workspace}`}
                    data={data}
                    mutate={mutate}
                    busy={busy}
                    scope={step === "settings" ? "general" : activeStep}
                  />
                ) : step === "searches" ? (
                  <SearchView
                    data={data}
                    view={view}
                    mutate={mutate}
                    busy={busy}
                    onNew={() => setNewSearch(true)}
                  />
                ) : step === "outreach" ? (
                  <OutreachView
                    data={data}
                    view={view}
                    mutate={mutate}
                    busy={busy}
                  />
                ) : (
                  <CompaniesView
                    data={data}
                    view={view}
                    mutate={mutate}
                    busy={busy}
                    review={step === "review"}
                  />
                )}
              </>
            )}
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            <span className="tiny-dot" />
            {toast}
          </div>
        )}
        {newSearch && data && (
          <Modal title="Create a search" onClose={() => setNewSearch(false)}>
            <SearchEditor
              data={data}
              mutate={mutate}
              busy={busy}
              onDone={() => setNewSearch(false)}
            />
          </Modal>
        )}
        {help && (
          <Modal title="Workflow guide" onClose={() => setHelp(false)}>
            <div className="modal-body guide">
              {[
                [
                  "01",
                  "Searches",
                  "Define your hard filters and preferred sources. Save different searches for different investment theses.",
                ],
                [
                  "02",
                  "Companies",
                  "Read the research, inspect qualification, and understand how each business serves its customers.",
                ],
                [
                  "03",
                  "Review Queue",
                  "Select a decision: already talking, reach out, top priority, or not a priority. Every decision is saved.",
                ],
                [
                  "04",
                  "Outreach",
                  "Prepare an email from the approved memo, edit and approve the exact text, then manually hand it off.",
                ],
              ].map(([n, title, desc]) => (
                <div key={n}>
                  <span className="step-number">{n}</span>
                  <section>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </section>
                </div>
              ))}
              <div className="info-note">
                Configure research, writing, and judging agents in General
                Settings → Agents. Start the automation worker to process
                scheduled jobs. The initial company is fictional.
              </div>
            </div>
          </Modal>
        )}
      </div>
    </FormErrorContext.Provider>
  );
}
