# First build: one shared example

Status: implemented. A versioned migration removes untouched legacy examples and preserves edited/real records. This is the first milestone of the [updated implementation plan](implementation-plan.md), which adds scheduling, agent API access, and batch generation.

## Current storage

- `src/data/example-workspace.json` holds one search and one fictional company; `src/lib/seed.ts` adds timestamps.
- `.data/dealfinder.sqlite` holds the current workspace as a single JSON document in the `workspace` table.
- Searches, companies, decisions, drafts, history, and settings are fields within that document. All four screens read the same workspace through `/api/workspace`.
- Each successful update saves the previous JSON document to the `revisions` table and replaces the current document in a transaction.
- Seed data is inserted only when a workspace does not exist. Changing the seed does not reset existing data.

## First-build scope

Use one example search and one fictional company to demonstrate the complete four-step workflow. Keep SQLite as the persistence layer; this change simplifies the example data, not the storage architecture.

1. **One example JSON file.** Move the editable example content into `src/data/example-workspace.json`: the Industrial software search, Forgeworks, its research memo and illustrative sources, and shared settings. Keep a small seed loader to add runtime timestamps and the initial workspace version. Mark the company and evidence clearly as fictional.
2. **Searches.** Show the single active example search and its criteria. Its company count is derived from the shared data. Past searches start empty.
3. **Companies.** Show Forgeworks linked to that search. The company detail page displays the same memo and evidence used during review; do not duplicate records for each screen.
4. **Review Queue.** Start with the company awaiting a decision. A decision updates the shared company record and appends history. Already talking and Not a priority stop progression; Reach out and Top priority make it eligible for an email.
5. **Outreach.** Start with no email. After a positive decision, generate an editable draft through the selected writer from the approved memo. Retain edit, approve, reject, and revision behavior. Sample data cannot be exported to a campaign or handed off.
6. **Settings.** Retain General Settings and step-specific settings. The updated plan replaces the primary MCP experience with generated API keys and an agent connector. Do not populate a fake connection, enable a schedule, or make network calls as part of loading the example.

## Existing workspace handling

Apply the smaller fixture automatically to fresh workspaces. For the current local workspace, inspect whether the original examples have been edited. Replace the initial example set only if it is still untouched, retaining the previous workspace as a revision. Preserve user-created records, settings, decisions, and edited examples. Do not reset the database just to change the demo.

## Completion checks

- Fresh startup shows one search, one company, one pending review, and zero drafts.
- Every view refers to the same search/company IDs and derives its counts from shared state.
- Review the company, create a draft, edit and approve it, then reload: the state persists.
- Changing the decision to Already talking or Not a priority blocks further outreach and invalidates dependent approvals.
- Active/past lists and empty states remain usable with only one example.
- Update tests that currently depend on the other seeded companies to create their own scenario-specific fixtures.

Live discovery, scheduled jobs, AI writing, and generated agent API keys belong to later milestones in the updated implementation plan; they are outside this initial example-data cleanup.
