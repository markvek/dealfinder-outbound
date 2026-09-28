# DealFinder implementation plan

Updated September 27, 2026. This revision replaces the earlier plan where they conflict. Status: implemented locally, with HTTP-adapter and MCP execution tests. Live providers must be configured by the workspace owner; no paid search has been run. Hosted authentication/deployment and Notion sync remain outside this build. See README.md for startup and docs/agent-protocol.md for the execution contract.

## Product direction

Keep four top-level tabs: **Searches, Companies, Review Queue, Outreach**. Each tab has its own left sidebar for active/past records, filters, and settings. General Settings contains shared agent configuration and agent API access.

Use plain operational labels and show records, status, dates, and actions. Remove promotional copy and decorative explanatory sections throughout the product. The app is the authoritative workflow interface; Notion remains an optional later mirror.

The initial example is one shared search and one fictional company, reused through all four steps. Live searches and bulk outreach must support any number of real companies.

## 1. Remove marketing copy throughout the app

Audit visible text, empty states, onboarding/help, metadata, tooltips, and accessible labels. Keep instructions that explain inputs, status, failures, or approval behavior. Preserve the four user-defined review decisions; those are workflow choices, not marketing copy.

| Location                         | Change                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search page                      | Replace “Your next great conversation starts with a search.” with **Searches**. Remove the discovery slogan and promotional subtitle.                                 |
| New-search card                  | Replace “A new angle. A new search.” and supporting copy with **New search**, or remove the redundant card when the toolbar already has that action.                  |
| Search workflow strip            | Remove the entire “A clear path…” / “driver’s seat” section and its Find / Understand / Decide / Connect captions. The top tabs already describe the workflow.        |
| Shared sidebar                   | Remove “A thoughtful pipeline” and “From the first signal to the right conversation.”                                                                                 |
| Companies page                   | Use **Companies**, **Active companies**, or **Past companies**. Remove “Get to know the business,” “Look beyond the name,” and the promotional subtitle.              |
| Review pages                     | Use **Review Queue**, **Past reviews**, and **Top priority**. Remove “Good research. Your judgment,” “Every decision, remembered,” and “The ones that stand out.”     |
| Review summary and company panel | Use **N companies awaiting review** and **Review decision**. Remove “Your perspective,” “Is this a business worth a conversation?” and the “You make the call” aside. |
| Outreach list and detail         | Use **Outreach** and **Email draft — Company name**. Remove “Make the first email count,” “A thoughtful first impression,” and promotional writing subtitles.         |
| Outreach empty state             | **No email drafts. Approve a company for outreach to generate a draft.**                                                                                              |
| General Settings                 | Use **General Settings**. Remove “A workspace that works your way.”                                                                                                   |
| Help and page metadata           | Use **Workflow guide**, **DealFinder**, and concise descriptions of actual functionality. Remove “Research to relationships” and similar taglines.                    |
| Sample notices                   | Use a short **Example data** label and source labeling. Remove invitations to “explore” or marketing-style sample descriptions.                                       |

Update UI tests to use the new operational headings. Remove unused decorative components/styles introduced only for the deleted sections.

## 2. One example search and one company

Use `src/data/example-workspace.json` as the single editable example fixture:

- Search: Industrial software, with its saved criteria and preferred sources.
- Company: Forgeworks, linked to that search, with one memo and illustrative evidence.
- Initial state: one active search, one company awaiting review, zero email drafts, empty past lists.
- A positive decision makes that same company eligible for an email draft. Do not create separate copies of the company for different tabs.
- Schedule defaults to disabled. No credentials, paid work, or real research runs are included in the example.

Current storage is one JSON document in SQLite, with previous document revisions retained. Keep that working for the initial cleanup. Create a migration that removes the other unmodified sample records while retaining a prior revision. Preserve real/user-created records and edited sample records; changing the seed alone is not enough to update an existing workspace.

Tests must create extra scenario fixtures themselves instead of relying on extra companies in the shipped example.

## 3. Previous/next company navigation

On `/companies/[id]`, including `/companies/forgeworks`, put **← Previous**, **N of M**, and **Next →** next to the company header.

- Navigate to another company ID URL, not a modal or an in-place record without an address change.
- Use the list the user came from, preserving search, filters, and sort order in the navigation context. Reuse the same filter/order calculation for the table and detail navigation.
- A direct company URL uses the default company list; if a saved filter excludes the current company, reset the context explicitly rather than producing an incorrect position.
- Disable Previous at the start and Next at the end. With one example, show **1 of 1** and disable both.
- Preserve unsaved review notes before navigating: save or warn before discarding them. Keep a Back to list action that restores the list context.
- Give the buttons accessible names. Optional keyboard shortcuts must ignore focused inputs and textareas.
- Apply the same navigation pattern to review detail when viewing the review queue; an item leaving that queue must not cause the next item to be skipped.

## 4. Agent configuration and actual execution

Add **General Settings → Agents** with three main roles:

| Role                     | Responsibility and allowed inputs                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internet research        | Discovery, source retrieval, and evidence-backed company research. Must have working internet/search tools and return source URLs, dates where available, and structured results. Qualification and domain dedupe still use deterministic rules where possible.                                         |
| Outreach writing         | Draft emails from the approved company memo, the review decision, sender style/examples, and job-specific instructions. No additional company research or browsing.                                                                                                                                     |
| Judge / secondary review | Independently assess a completed company memo against the saved criteria and its evidence. Return a recommendation, reasons, evidence gaps, and concerns. Optionally review an outreach draft against its approved memo and writing instructions. Recommendations remain separate from human decisions. |

Each configured agent records a display name, execution adapter, provider/model or external-worker identifier, supported roles, configuration version, and readiness status. Credentials remain server-side. Provide Test connection/capabilities, last successful check, and a clear unavailable state. Do not list a configuration as runnable until its adapter works.

Distinguish agents running through a provider API from externally connected workers. A local MCP client is not automatically an always-on worker. An external executor must explicitly register its capabilities, claim work, report progress, and submit results under a lease. Offline executors leave work visibly queued.

Agent selection precedence, resolved separately for each role:

1. Explicit selection in the current Run search, Run secondary review, or Generate outreach dialog.
2. Company-specific writer/judge override for single-company work, or saved search/schedule override for a search run.
3. Step default from Searches settings, Review Queue settings, or Outreach settings.
4. Workspace default in General Settings.

Every submitted job stores the resolved agent/configuration version. Later settings changes do not alter in-flight work. For batch outreach, an explicitly chosen batch agent applies to all eligible selected companies; without it, resolve each company’s inherited default and show that in the preview. Validate every resolved agent before submitting the batch.

The agent selections must drive actual worker execution, not merely save preferences. If an adapter or credential is missing, disable execution and show the reason. Keep external orchestration identity separate from the executor selected to perform research, judging, or writing.

### Secondary review settings and experience

Under General Settings → Agents, add a Judge / secondary review assignment with enable/disable controls. Allow a different provider/model from the researcher or writer. Keep separate optional assignments for company-research review and email-draft review; a shared judge can serve both. Review Queue settings contains company-review defaults, and Outreach settings contains optional draft-review defaults.

- **After research:** optionally enqueue a judge job when a new memo is complete, before human review. A judge receives the exact search/run criteria, memo version, source evidence, recorded pursuit status, and any user-supplied judging instructions. It does not browse or add unreviewed company facts; missing evidence becomes a flagged research gap.
- **Output:** suggested disposition, concise rationale, evidence references, missing or contradictory evidence, concerns, and uncertainty. Use the existing review categories where appropriate; “already talking” requires explicit pursuit data and must not be inferred from company quality. Support “insufficient evidence” instead of forcing a recommendation.
- **Review UI:** show a Secondary review panel next to the memo, with judge identity, model, timestamp, input version, status, recommendation, and findings. Let the reviewer accept the suggestion or record a different decision with notes. Acceptance is an explicit human action and writes the normal decision record; the agent itself cannot approve outreach.
- **On demand:** add Run secondary review / Rerun on company detail and selection-based batch judging in Review Queue. Each launch can override the judge and add temporary evaluation instructions. Search launch and schedule settings can enable automatic secondary review and choose its judge.
- **Optional email check:** after writing, a judge can flag unsupported claims, deviations from sender style, placeholders, or conflicts with the approved memo. Show findings beside the draft before human approval. It reviews the exact draft revision without additional research and does not rewrite, send, or approve the email.
- **Versioning:** retain every judge result with its input versions, agent/configuration/prompt versions, and subsequent human decision or disagreement. Memo or draft edits mark the old result stale; it cannot be displayed as a review of the newer content. Enable later analysis without adding an automatic learning loop.
- **Failure/disabled state:** show Not requested, Queued, Running, Complete, Failed, or Stale. An unavailable judge is not a successful review. Secondary review is advisory and optional; its absence does not silently block the existing human-review path or imply approval.

## 5. Saved searches, dates, and temporary prompts

A **saved search** defines reusable filters, preferred sources, a base research prompt, and optional agent overrides. A **search run** is one execution with its own dates, prompt overlay, and immutable configuration snapshot.

Add **Run search** on each search and the search list. Its dialog contains:

- Execute now or schedule for a specific date/time.
- Research date range: All available dates, a custom From/To range, or Since last successful run.
- Selected internet research agent, optional secondary-review judge, and inherited outreach-writing default for companies this run discovers. This does not automatically generate outreach before human review.
- Optional **Instructions for this run** text area.
- Company limit, spend limit, and a summary of the effective saved filters, dates, agents, and prompt.

Keep two kinds of dates separate:

| Dates                  | Meaning                                                |
| ---------------------- | ------------------------------------------------------ |
| Execution date/time    | When the job is due to start.                          |
| Research From/To dates | Which dated discovery signals the run should look for. |

The research window limits discovery signals such as announcements, articles, and portfolio updates. It does not exclude older company-background sources needed to verify facts. Retain evidence dates; flag undated/uncertain signals rather than claiming every source satisfies a date constraint. Providers unable to support a selected date filter must disclose that before launch.

Prompt composition: fixed workflow rules + saved hard filters + preferred sources + saved base prompt + research window + temporary run instructions. The run instructions can focus the research but cannot silently relax hard criteria, bypass approval, or give the email agent browsing access. Users edit the saved search to change hard requirements.

A temporary prompt applies only to that run. For a recurring search, provide a clearly labeled **Next run only** override, consumed once when its run is enqueued. A separate schedule-level prompt may be saved explicitly for every recurrence; do not silently promote a temporary prompt into a permanent one. Store the rendered prompt and its source versions on the run for inspection and replay.

Example: retain the Industrial software search, run it Monday at 9:00 AM, look for signals from the previous seven days, and add “Focus this run on maintenance and dispatch software.” The saved search remains unchanged.

## 6. Cron schedules and where they live

Add a **Schedule** section to each search, alongside Criteria, Sources, Agents, and Run history. Include:

- Enabled/paused state.
- Once, Daily, Weekly, Monthly, or Custom cron.
- Date/time controls appropriate to the selected recurrence; weekday/day-of-month where needed.
- Start date, optional end date, IANA timezone, and a preview of upcoming execution dates.
- Research window: rolling last N days, since last successful run, all dates, or an explicit fixed date range.
- Saved agent overrides and optional recurring prompt.
- Next-run-only prompt/date/agent overrides, clearly separate from recurring settings.
- Last run, next run, execution status, and links to results/errors.

**Searches settings** holds scheduling defaults, timezone, and run limits. The actual schedule belongs to an individual search. The left sidebar lists active/past searches; each row may show the next run without adding another top-level tab.

Use a durable server-side scheduler and worker, not a browser interval. A scheduler tick finds due schedules and transactionally enqueues jobs; workers perform research outside web requests. For local development, provide explicit worker/scheduler start commands. For deployment, run them as persistent services or have authenticated platform cron invoke the same scheduler tick. Choose the hosting-specific configuration when the deployment target is known.

Required behavior:

- Store timestamps in UTC plus the schedule timezone; show local execution dates and document daylight-saving behavior in the upcoming-run preview. Skip nonexistent local times and run repeated local times once.
- Deduplicate each schedule occurrence by schedule ID/version and scheduled time. Concurrent ticks or retries must not launch duplicate runs.
- Do not overlap runs for the same search by default. Queue one follow-up instead of running unlimited overlapping work.
- If the machine is offline, show the missed occurrence and enqueue one catch-up run on resume by default; do not launch the entire missed backlog.
- For Since last successful run, retain the original window on retries and advance the watermark only after successful completion. Do not lose a research date range because a run failed.
- Enforce limits, worker leases, heartbeats, bounded retries, cancellation, and visible failure states.
- Editing or pausing a schedule affects future occurrences. Existing queued/running jobs keep their submitted snapshots; cancelling them is a separate action.

## 7. API keys and MCP: agents control DealFinder

Replace the current primary connection experience with **General Settings → Agent access**. The existing outbound connection tester may remain under Advanced → Research tools, but it is not the requested orchestration feature.

User flow:

1. Name a connection, such as “Research agent.”
2. Choose permissions and expiry, then **Generate API key**.
3. Show the secret once with Copy; store only a cryptographic hash plus ID/prefix, scopes, owner/workspace, creation/expiry, last-used, and revocation metadata.
4. Provide the DealFinder API base URL and a copyable/downloadable MCP client configuration using `DEALFINDER_URL` and `DEALFINDER_TOKEN`.
5. Show connected agent identity/activity; allow revoke and rotation. A replacement key does not leave the previous key valid implicitly.

Follow the inspected VerticalFlash pattern: an MCP connector runs locally through stdio and translates tools into authenticated application API calls. It receives the application URL and token from its environment. The same authenticated API supports a deployed connector/worker when a hosted HTTPS URL is available. Remote MCP transport can be added if required; it is not necessary to make the initial API-key connector usable.

Proposed initial tool groups:

- Read/create/update searches; inspect effective configuration and versions.
- Start or schedule a search; list, inspect, pause, or cancel schedules.
- Inspect jobs, progress, failures, and results; retry eligible failed work with the original execution identity.
- Read companies, research evidence, memo versions, judge findings, and human review decisions.
- Request or rerun secondary review for a company or selected batch; inspect judge job status and results. Judge tools cannot write human decisions.
- Generate outreach for one company or a selected eligible batch; read draft results and job status.
- For explicitly authorized executor keys: claim jobs and submit validated results using lease/attempt identifiers.

Browser actions, scheduler submissions, and MCP/API actions must call the same domain services and enforce the same eligibility and concurrency checks. Long operations return job IDs immediately. Use idempotency keys and expected revisions for mutations; record the API-key identity in the activity log. Jobs capture inputs at submission instead of depending on later reads of mutable settings.

Keys cannot create more keys, change human decisions, approve their own emails, send mail, or bypass already-talking suppression. Key management belongs to the owner’s browser session. Local access remains local; a hosted version needs authenticated owner sessions and workspace authorization before remote API access is enabled.

References inspected in VerticalFlash:

- `src/components/admin/TokenManager.tsx`: generate, display once, expire, revoke.
- `src/app/api/admin/tokens/route.ts` and `src/lib/cloud/auth.ts`: token hashing, bearer authentication, scopes, and browser-only key management.
- `agent-kit/mcp/server.mjs` and `mcp-config.json`: stdio connector, app URL/token, revision and idempotency headers, durable jobs.
- `src/components/settings/AgentSettingsBoard.tsx`: per-role agent selection. That board is explicitly marked inactive in the inspected version; DealFinder’s selectors must be connected to runtime adapters before being presented as operational.

No VerticalFlash secrets, application-specific jobs, or project authorization rules will be copied into DealFinder.

## 8. Generate outreach for one company or a batch

Add **Generate outreach** on company detail and a checkbox selection column plus **Generate outreach (N)** on Companies. Also expose eligible company selection from Outreach.

The generation dialog shows:

- Exact selected company count and selection scope; selecting all results requires an explicit action rather than silently expanding a visible page selection.
- Eligible/skipped companies and reasons: awaiting review, already talking, not a priority, failed qualification, missing approved memo, or existing active draft.
- Writer agent selection, optional draft-review judge, sender/style configuration, optional batch instructions, and generation limits.
- Preview of the approved memo versions and agent defaults each job will use.

Submit a batch with one independently tracked child job per company. Display queued/running/completed/failed/skipped counts and allow retrying failures without regenerating successes. New generation is idempotent; replacing an active draft requires an explicit regenerate action that preserves the old revision.

Recheck eligibility when submitting, when a worker claims the job, and when it commits the result. A decision/memo change or already-talking flag during generation makes the result stale and prevents it from becoming an actionable draft. Cancelling a job similarly prevents late results from advancing the workflow.

Batch generation produces drafts only. Each email still requires human approval of its exact revision; it does not bulk-send emails or enroll companies in Lemlist.

## 9. Data changes

The current single JSON document is sufficient for the UI/demo cleanup. Before concurrent schedules, workers, and external agents are enabled, add dedicated transactional records in the existing SQLite database:

| Record                                                            | Purpose                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AgentProfile / AgentDefaults                                      | Execution adapters, capabilities, readiness, role defaults, and configuration versions.                                                                                                          |
| SearchVersion                                                     | Hard filters, source preferences, base prompt, and saved overrides.                                                                                                                              |
| SearchSchedule                                                    | Recurrence/cron, timezone, bounds, data-window policy, next-run overrides, next occurrence, and pause state.                                                                                     |
| SearchRun / Job / JobAttempt                                      | Trigger, configuration/prompt/agent snapshots, research window, due/start/end times, status, limits, idempotency, leases, errors, and results.                                                   |
| OutreachBatch / BatchItem                                         | Selected companies, resolved writer agents, approved memo references, generation state, and skip reasons.                                                                                        |
| ApiKey / ActivityEvent                                            | Hashed credentials, scopes, expiry/revocation, identity, and attributable API activity.                                                                                                          |
| Company / SearchCandidate / MemoVersion / Decision / DraftVersion | Stable company identity across searches; search-specific qualification; versioned evidence, judgments, and emails.                                                                               |
| JudgeReview                                                       | Research/draft target and version, search criteria snapshot, judge configuration, prompt, recommendation, evidence-linked findings, status, timestamps, and links to subsequent human decisions. |

Preserve existing IDs and revision history during migration. Retain JSON for structured prompts/configuration/results where useful. Do not expose key hashes, secrets, or provider credentials through workspace JSON. If the deployment uses multiple independent hosts, move shared transactional state to a database accessible by all workers rather than keeping separate SQLite files.

## 10. Build order and acceptance checks

1. **UI cleanup and example fixture.** Remove audited marketing copy, ship one example search/company, and add previous/next company navigation. Verify saved records survive migration and filtered navigation preserves context.
2. **Durable execution and agent settings.** Add job/attempt records, leases, a worker, capabilities, runnable adapters, defaults/overrides, and immutable execution snapshots. Implement optional secondary-review jobs and panels. Verify each selected research/judge/writer agent receives the correct inputs, unavailable agents are labeled, and judge recommendations cannot bypass human decisions.
3. **Search launch and scheduling.** Add base prompts, dated execution and research windows, temporary overlays, per-search schedules, recurrence previews, run history, and scheduler startup. Verify timezones/DST, offline catch-up, pause, retry windows, and duplicate-tick protection.
4. **Generated API keys and MCP connector.** Add scoped API authentication, key management, shared domain endpoints, connector/config download, and activity. Verify key expiry/revocation, workspace isolation, idempotent starts, and approval restrictions through real MCP calls.
5. **Single and batch outreach generation.** Add row selection, deployment dialog, writer overrides, child jobs, result/skip reporting, and retry controls. Verify only eligible approved memos enter writing and mid-run decision changes cannot produce actionable drafts. Verify optional draft judging flags issues against the exact revision and becomes stale after edits.
6. **Integrated pilot.** Execute one dated/scheduled search with a temporary prompt; inspect results and a judge’s secondary review; accept or override the recommendation as a human; generate drafts through the selected writer and through MCP; approve a revision; reload and verify history. Use test-only multiple-company fixtures for navigation and batch cases while the shipped demo remains one company.

Do not mark any agent or schedule as running based only on saving a configuration. Distinguish queued, waiting for executor, running, succeeded, failed, cancelled, and skipped. Keep the human company decision and exact-email approval gates throughout.

## Defaults and remaining deployment inputs

- Interpret “by dates” as both execution scheduling and research date ranges, with distinct controls.
- Temporary prompts are per-run/next-run-only unless explicitly saved on the schedule.
- Draft generation is authorized by existing positive human decisions; sending remains manual.
- Choose actual research, judging, and writing adapters/models from the user’s available provider accounts or registered external workers. Do not invent live integrations.
- Configure hosting-specific cron/service startup and public API URL once the deployment target is selected. This does not block the local UI, schema, worker, or connector implementation.

## Verification completed

- 21 service tests pass, covering retained edited examples, execution snapshots, idempotency, lease recovery, changed approvals, domain deduplication, stale judging, partial batches, regeneration conflicts, agent selection, budget/result validation, scoped/revoked keys, scheduling, DST, and real HTTP dispatch to a mock agent.
- Seven browser scenarios pass (the navigation scenario was rerun after correcting its selector), including persistence, approvals, mobile layout, outgoing MCP discovery, inbound stdio MCP execution/revocation, dated search launch, schedule preview, and filtered company navigation with unsaved-note confirmation.
- ESLint, TypeScript, and the production build pass. Desktop/mobile inspection found no browser errors or page overflow on the added screens.
- The local preview and automation runner are usable. The owner must configure actual agent services/credentials before live research or writing. No live internet research or paid generation was performed during verification.
