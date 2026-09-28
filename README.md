# DealFinder

Company research, human review, and outreach in four tabs: Searches → Companies → Review Queue → Outreach.

## Run locally

Use Node.js 22 or newer:

```sh
pnpm install
npm run dev
```

Open the Local URL printed by Next. The default is **http://127.0.0.1:55210**; `PORT` or `CONDUCTOR_PORT` overrides it. Port 3000 may belong to another project.

In a second terminal, in this same directory:

```sh
npm run automation
```

This starts independent scheduler and HTTP worker loops. Keep both terminals open for scheduled jobs. For separate processes, use `npm run scheduler` and `npm run worker`. For a single scheduler tick: `npm run scheduler -- --once`. The scheduler also has a scoped `schedule.tick` automation API command.

This is a single-user, **localhost-only** app. Run the web process and automation process against the same persistent SQLite database. Hosted login, HTTPS ingress, and deployment-specific supervision have not been configured. A sleeping/offline Mac cannot execute jobs; it catches up when the runner resumes.

## Configure agents

1. Open **General Settings → Agents**. Add an HTTP agent endpoint or an external MCP executor. Separate roles support internet research, company secondary review, outreach writing, and optional email secondary review.
2. For HTTP endpoints, allow the endpoint origin in `.env.local` and optionally set a server credential:

   ```dotenv
   DEALFINDER_CONNECTION_ORIGINS=https://agents.example.com
   DEALFINDER_AGENT_RESEARCH=your-agent-service-secret
   ```

   Enter `DEALFINDER_AGENT_RESEARCH` as the credential variable name in the agent form. Restart the web and automation processes after changing the environment. No secret is stored in the workspace. HTTP endpoints implement the [agent protocol](docs/agent-protocol.md); raw model-provider URLs need an adapter.

3. Test the HTTP connection, or register the external agent through MCP. Research agents must report internet-search capability; dated runs also require date filtering.
4. Choose defaults. Step settings, saved searches, company settings, and job launch dialogs provide overrides. Set the sender and writing style in General Settings before generating emails.

**No live provider or paid credentials are bundled.** The shipped fixture is one fictional company, Forgeworks, and one Industrial software search. Configure a real executor before requesting live work. Tests exercise mock HTTP agents and a real local MCP transport; they do not perform live internet research.

## Searches, dates, and jobs

Open a saved search to edit its base prompt, run immediately, schedule a one-time execution, or configure recurring cron. Execution date/time and the research date window are separate. A temporary prompt augments the base prompt; recurring schedules can have recurring instructions and next-run-only instructions, dates, and agent overrides.

Schedules use an IANA timezone and store UTC timestamps. Missing daylight-saving times are skipped; repeated wall times run once. Missed occurrences coalesce into one catch-up run. Runs for the same search do not overlap. Since-last-success windows only advance after a successful run. Pausing a schedule affects future occurrences; cancel already queued jobs separately.

Job snapshots retain selected agent configuration, filters, memo/draft versions, dates, prompts, limits, and results. Jobs have expiring leases, heartbeats, cancellation, and at most three attempts. Explicit failure is retried from the Jobs panel; abandoned leases are recovered automatically. The agent must enforce its execution budget before spending; reported over-budget results are rejected. Provider-side billing cannot be undone by cancelling a job.

## Secondary review and outreach

Judges return an advisory recommendation, rationale, concerns, evidence references, and uncertainty. They cannot change human decisions, approve drafts, or send. A human can accept a recommendation or record another decision. Memo/draft changes mark findings outdated.

Select companies to queue writing or judging in bulk, or launch from a company. Writing requires a current human approval. Already-talking, passed, unapproved, duplicate-active-job, and existing-draft cases are skipped as appropriate. Regeneration is explicit, and edited drafts or changed approvals invalidate an in-flight result. Review and approve the exact email revision before copying/exporting or recording manual handoff. **There is no automatic email sending.** Sample-company campaign export/handoff remains blocked.

## Connect an external agent via MCP

**General Settings → Agent access / MCP** creates scoped, expiring, revocable API keys. Copy the key when generated; only its cryptographic hash is stored. Download `connector.mjs` and `package.json`, install dependencies in that folder, and add the displayed configuration to your agent.

Or use the included connector directly after installing project dependencies:

```json
{
  "mcpServers": {
    "dealfinder": {
      "command": "node",
      "args": ["/absolute/path/to/dealfinder/agent-kit/mcp/connector.mjs"],
      "env": {
        "DEALFINDER_URL": "http://127.0.0.1:55210",
        "DEALFINDER_TOKEN": "PASTE_YOUR_GENERATED_KEY"
      }
    }
  }
}
```

The connector exposes workflow guidance, workspace reads, search editing/runs, schedule editing/preview, batch writing/judging, and job control. Executor keys are bound to specific external agents and permit register/claim/heartbeat/complete/fail. Human decisions and approval are unavailable to API keys. External executors run in your agent host; the HTTP worker does not execute their jobs.

The older outgoing MCP/API connection tester remains under **General Settings → Advanced: outgoing research tools**. It tests connectivity/tool discovery only. It is separate from generated inbound orchestration keys.

## Data

`src/data/example-workspace.json` is the single editable example. `src/lib/seed.ts` adds timestamps when creating a new workspace. The app persists shared workspace JSON and revision history in `.data/dealfinder.sqlite`; automation has separate SQLite tables for agents, schedules, jobs, batches, findings, key hashes, and audit events. Set `DEALFINDER_DB_PATH` consistently for web and runner to override the location.

A versioned migration removes untouched extra legacy examples and retains edited/real records plus prior workspace revisions. Changing the fixture never resets an existing workspace. Back up the SQLite database using SQLite's backup API or with all processes stopped, including its WAL state.

The existing Conductor setup may symlink `.env.local` to the repository root. Check the link before editing a shared environment file.

## Checks

```sh
npm run lint
npm test
npm run test:e2e
npm run build
```

Browser tests use isolated SQLite databases, port 55211, and a local mock tool server on 55212. Install Chromium with `pnpm exec playwright install chromium` if needed. Service tests cover scheduling/DST, immutable snapshots, leases, stale approvals, deduplication, advisory findings, hashed/scoped keys, and HTTP worker dispatch. Browser tests include actual stdio MCP calls and key revocation.

The [implementation plan](docs/implementation-plan.md) records the scope. The UI reference is [markvek/instalily-markveksler](https://github.com/markvek/instalily-markveksler). Manrope is self-hosted; its license is in `src/app/fonts/OFL.txt`.
