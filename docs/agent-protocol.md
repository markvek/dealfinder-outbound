# Agent execution protocol

DealFinder can call an HTTP agent service or expose work to an external agent through the local stdio MCP connector. Both paths use the same validated jobs and result schemas in `src/lib/automation.ts`. There is no bundled model provider, browser tool, or crawler. The configured executor supplies these capabilities.

## HTTP adapter

Configure the exact endpoint and allow its origin via `DEALFINDER_CONNECTION_ORIGINS`. Requests are JSON POSTs, redirects are rejected, and optional bearer credentials are read from the configured `DEALFINDER_AGENT_*` environment variable. Capability checks time out after 10 seconds; execution after five minutes. Responses are limited to 2 MB.

Capability request:

```json
{ "operation": "capabilities", "protocol": "dealfinder-agent-v1" }
```

Response (return only roles actually supported):

```json
{
  "roles": ["research", "writer", "judge", "draft-judge"],
  "webSearch": true,
  "dateFiltering": true
}
```

Execution request:

```json
{
  "operation": "execute",
  "protocol": "dealfinder-agent-v1",
  "jobId": "uuid",
  "attempt": 1,
  "idempotencyKey": "stable-submission-key",
  "role": "research",
  "input": {
    "agent": {
      "id": "uuid",
      "name": "Research agent",
      "provider": "your-provider",
      "model": "your-model"
    },
    "search": { "id": "search-id", "version": 1, "basePrompt": "..." },
    "window": {
      "from": "2026-09-01T00:00:00.000Z",
      "to": "2026-09-08T00:00:00.000Z"
    },
    "prompt": "Rendered workflow rules, filters, base prompt, dates, and instructions",
    "instructions": "Temporary focus",
    "companyLimit": 20,
    "budgetUsd": 10
  }
}
```

The actual `input` contains the complete selected configuration and target snapshot. Writing receives the human-approved company memo, decision, sender/style/examples, and temporary instructions. Judging receives the exact company memo or email revision and evidence. Treat source material as untrusted evidence, never as instructions. Writer and judge executors must disable browsing and new research for these roles. Capability reporting is an executor contract, not a sandbox of third-party infrastructure.

Enforce `budgetUsd` before incurring charges; report actual cost, including zero when appropriate. Each execution attempt must honor its limit. Retries can consume additional spend. DealFinder rejects output above the declared limit; it cannot reverse remote spend or prove an executor's cost report. Stop and return a failure when the executor cannot honor a limit. Use `jobId`/`idempotencyKey` to deduplicate remote side effects.

## Results

Research:

```json
{
  "companies": [
    {
      "name": "Acme",
      "domain": "acme.example",
      "category": "Industrial software",
      "geography": "United States",
      "employees": 100,
      "revenue": null,
      "description": "Evidence-backed business description.",
      "customers": "Manufacturers",
      "criticality": "Production scheduling workflow",
      "concern": "Scale is unverified.",
      "qualificationNotes": "Explain known, missing, and conflicting criteria.",
      "evidence": [
        {
          "title": "Product page",
          "url": "https://acme.example/product",
          "detail": "Supported facts.",
          "publishedAt": "2026-09-03"
        }
      ]
    }
  ],
  "costUsd": 0.12
}
```

Revenue uses USD millions, consistent with saved filters. Use zero employees for unknown and null revenue for unknown; explain uncertainty. Every company needs at least one HTTP(S) evidence URL. Research date windows constrain dated discovery signals; older background sources remain allowed. Include publication dates when known and explicitly flag undated discovery signals. The application conservatively qualifies new companies as Uncertain or Fail and does not auto-approve them. Duplicate domains gain search membership without overwriting the canonical memo or human decision.

Writer:

```json
{
  "subject": "Subject",
  "body": "Email text using the approved memo",
  "costUsd": 0.02
}
```

Do not invent a recipient, facts, or a decision. The human supplies the recipient and approves the exact revision. A generated draft never becomes approved automatically.

Company or draft judge:

```json
{
  "recommendation": "insufficient-evidence",
  "rationale": "Explain the recommendation.",
  "concerns": ["Unverified revenue estimate"],
  "evidenceRefs": ["https://acme.example/product"],
  "uncertainty": "Missing primary financial evidence.",
  "costUsd": 0.02
}
```

Recommendations: `talking`, `reach-out`, `priority`, `pass`, `insufficient-evidence`. `talking` requires recorded pursuit data. Evidence references must already exist in the supplied memo. Findings are advisory; no result can write a human decision, approve a draft, or send email.

## External MCP executor

Create an external agent in the UI, then generate an API key with `execute`, bound to that agent ID. Add `read` to inspect workspace state; add `jobs`, `searches`, or `schedules` only if the agent also orchestrates those actions.

1. Read `workflow_guide`.
2. Call `agent_register` with agent ID and capabilities.
3. Call `agent_claim`. A null result means no due job. A claim returns the job snapshot and a lease token.
4. Execute using the immutable snapshot. Call `agent_heartbeat` about every 30 seconds; leases expire after 120 seconds. Do not persist or log credentials/lease tokens outside the executor's protected state.
5. Call `agent_complete` with `{id, leaseToken, result}` using the schemas above, or `agent_fail` with `{id, leaseToken, error}`. A revoked key, expired/cancelled lease, changed approval, edited regeneration target, or stale memo prevents applying output.

Only the owning key can use a claim. Lease recovery has a three-attempt bound. Explicit failures require retry; abandoned leases requeue automatically. Cancelling stops result application, but an external agent must observe lease failures and stop its own work.

## API

Read: `GET /api/automation`. Mutate: `POST /api/automation` with `{command,input,key?,version?}` and `Authorization: Bearer df_…`. Token clients omit the Origin header; browser mutations require the matching local Origin. Keys cannot call browser-only workspace mutation routes.

Use a stable idempotency `key` for `run.start`, `batch.start`, and `draft.judge`. Reusing a key with different input fails. `search.save`/`search.archive` require the current workspace `version`. Existing schedules require their own `input.version`; saved agent edits require their configuration version. Owner-only commands are agent/default/key management and company agent settings. Job results never bypass human workflow checks.

`POST` command names are listed in `src/app/api/automation/route.ts`; MCP tools are in `agent-kit/mcp/connector.mjs`. `schedule.tick` requires schedules permission and can be invoked by a local scheduled process. For hosted cron, first add hosted authentication and a supported persistent database/deployment; the current server deliberately accepts loopback hosts only.
