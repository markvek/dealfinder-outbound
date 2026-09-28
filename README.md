# DealFinder — local sourcing, Notion interface

Run a daily company-sourcing agent on your Mac or Windows computer. Edit rules and review company cards in Notion. Choose OpenAI or Claude for API-based research. No hosted application or GPU is required; AI inference happens at your chosen provider.

## Install

### Desktop companion

The companion app provides a visual setup wizard and a small status/settings screen. **Notion remains the main interface** for rules, schedules, company reviews, and run history.

Install a DealFinder desktop build: on macOS, move **DealFinder.app** to Applications before opening it; on Windows, run the installer. The app bundles the agent and Node, so end users do not need Git, Node, or terminal commands. Builds are currently development artifacts; signed public releases are not published yet. See [desktop development and release instructions](desktop/README.md).

1. Open DealFinder and enter the AI provider, model, and API key.
2. Create/share a Notion connection as described below, then enter its token and your parent page link.
3. Choose a starting time and timezone and click **Connect workspace**. Existing Notion rules and schedules are preserved.
4. Click **Open Notion**, fill in Sourcing Rules, and enable sourcing when ready. New workspaces start paused.

Setup adds **DealFinder Settings** beneath your Notion parent page, with start/pause instructions and guidance for opening the companion from Applications or the Start menu. Notion rejects direct `dealfinder://settings` links; a clickable **Open DealFinder Settings** link is included when a hosted HTTPS launcher is configured (see the desktop README). The app has **Back to Notion** and **Open Notion** buttons. This is a companion window, not a Notion embed.

Existing CLI users can open the app with their existing profile and choose **Update Notion guide**, then **Repair background checks** to move scheduling to the bundled runner. Both interfaces use the same local configuration, credential store, and process lock. In the app you can update credentials, check connections, repair scheduling, or stop background checks. Closing the window leaves scheduled work running. Reconnecting an already-enabled workspace can resume paid sourcing.

### Terminal installation (optional)

First install **Git** and **Node.js 22.13 or newer** from [nodejs.org](https://nodejs.org/). Clone this repository into a permanent folder, then open a terminal there. The installer installs only the `agent` dependencies; the existing Next.js scaffold is not used by the agent.

macOS:

```sh
bash install-mac.sh
```

Windows, from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Run as your normal user, without administrator privileges. The Windows command applies its execution policy to that process only. If organization policy prohibits scripts or scheduled tasks, ask your IT administrator to approve the files.

The wizard asks for:

- An **OpenAI API key or Claude API key** and an exact model ID that supports web search. API billing is separate from chat subscriptions. You need only one AI provider.
- A **Notion connection token** with read, insert, and update content capabilities. Create it in [Notion's connections settings](https://www.notion.so/profile/integrations), then grant it access to your chosen parent page using that page's Connections menu.
- The parent page's URL, a daily time, and an IANA timezone such as `America/New_York`.

Model availability differs by account. The wizard checks authenticated model access without generating text. Web-search support and billing access are checked by the first actual research request.

Setup creates or reuses four named children beneath the parent page:

| Page | Contents |
| --- | --- |
| Sourcing Rules | Editable instructions and a small JSON controls block |
| Company Ideas | Company database with a **Company grid** gallery view |
| Run History | Progress, daily counts, attempts, and error or shortfall explanations |
| DealFinder Settings | Start/pause instructions, companion access, and connection troubleshooting |

Select the Company grid tab in Company Ideas to see the cards. Each card includes its website, description, fit rationale, evidence links, date, and review status. Open it to add review notes. Status choices are New, Shortlisted, and Rejected.

## Enable sourcing

The installer registers background checks, but **research starts paused**. Open Sourcing Rules, replace the placeholder with your actual targeting instructions, and set `enabled` to `true` in its JSON block:

```json
{
  "enabled": true,
  "dailyTarget": 50,
  "time": "09:00",
  "timezone": "America/New_York"
}
```

Describe industries, geography, size, buying signals, exclusions, and good/bad-fit examples in the text below the controls. Keep exactly one JSON code block. Child blocks on the page are read; linked pages, separate subpages, files and databases are not. Keep instructions under 20,000 characters. Use plain text for sourcing instructions; instructions inside images cannot be read.

All routine operation stays in Notion: edit targeting and schedule, pause sourcing, review cards, and inspect runs. Initial setup, credential changes and machine maintenance use the companion app or the local commands below.

## Scheduling and recovery

- macOS uses a per-user LaunchAgent; Windows uses an interactive-user Scheduled Task. Both check every **15 minutes** and at sign-in. The chosen time is the earliest start time, not a guarantee of an exact minute.
- Stay signed in, awake, and online. The agent cannot run while the computer is off or asleep. Windows runs without a visible terminal. On macOS, allow Node access to its own Keychain item if prompted during setup.
- After a gap, the next check handles **one most-recent due date**, not a backlog of all missed days. Before today's scheduled time, that date is yesterday. An early manual run consumes today's quota and suppresses older catch-up work.
- Daily dates use the Notion timezone. DST skipped times run at the next check after the clock jumps; repeated hours do not cause a second batch. Moving the timezone backward does not reopen older dates.
- The runner reads rules at the start of a run. An interrupted run on the same computer resumes with its saved rule snapshot. Changes apply to the next new run; pause is checked before every invocation. Pausing does not forcibly cancel a run already in progress.
- The default target is 50 new companies. Targets can be 1–100. A run uses batches of at most five candidates and at most **15 model requests for the default target** (up to 25 for a target of 100), each with up to eight search calls. Claude paused turns can continue twice; each continuation consumes that same daily request budget. Provider charges vary; also set budget alerts/limits in your provider account.
- Retryable failures get at most **three attempts per due date**. Completed and shortfall runs do not run again that day. After exhausting retries, fix the connection and wait for the next due date. `run` also respects completed dates and retry limits.
- Pending candidates are checkpointed locally; Notion is reconciled before resuming. If a page was created but its response was lost, its domain prevents a duplicate on the next attempt. There is no atomic transaction across the local disk and Notion; avoid running two computers against the same workspace.
- Duplicate checking uses normalized website hostnames and includes rejected companies. Alternate domains/subdomains of the same business are not automatically merged. Keep company cards and their Domain and Run properties to preserve history. Deleting or trashing cards removes them from duplicate detection.
- At least one evidence URL must appear in the provider's actual search results. This prevents invented source URLs; it is **not** independent verification of every claim or the model's fit assessment. Review candidates before using them.

## Commands

Run these from the cloned repository:

```sh
node agent/cli.mjs setup       # Set or replace credentials; reuse existing Notion pages
node agent/cli.mjs doctor      # Check model access, Notion schema and rules
node agent/cli.mjs run         # Research now; respects pause, today's quota and retry limits
node agent/cli.mjs test-run    # Publish up to 3 test companies, even while paused
node agent/cli.mjs status      # Local configuration, scheduler and last-run status
node agent/cli.mjs schedule    # Install or repair background scheduling
node agent/cli.mjs unschedule  # Remove scheduling; preserve Notion data and credentials
```

An internal `tick` command checks the schedule. A process lock prevents setup and sourcing from overlapping. A lock abandoned by a crashed process expires after approximately two minutes.

`test-run` is a paid live research test. It publishes real company cards and a separate Test entry in Run History, without changing Notion controls or consuming the scheduled daily quota. Each invocation starts a new test; its checkpoint is separate from scheduled runs. Test companies remain part of duplicate detection. No private CRM or paid company database is connected; cards are marked Needs CRM review.

## Handoff to another person or computer

1. On the old computer, run `node agent/cli.mjs unschedule`. Ensure its current run has ended before starting the new computer.
2. Give the new owner access to this repository and the Notion parent page. For a different Notion workspace, duplicate the parent page including its databases first, then grant the new connection access to that copy.
3. On the new computer, clone the repository and run its installer with the **new owner's credentials** and parent page URL.
4. Setup discovers the named pages and checks their schemas. It keeps existing rules, schedule, company history and review notes. Do not rename the three top-level pages before a handoff.
5. Run `doctor`, then verify a real sourcing run and its Run History entry. If today's quota is already complete, wait for the next due date.

Do not copy credentials or local config between users. No dependency on the original owner's API keys or computer is intended. A mid-run handoff preserves published results and recorded call limits, but uncommitted local candidates stay on the old machine and research may need to be repeated. The new computer uses the current Notion rules.

## Local files and troubleshooting

Configuration, progress and rotating logs live outside the repository:

- macOS: `~/Library/Application Support/DealFinder`
- Windows: `%LOCALAPPDATA%\DealFinder`

The AI and Notion tokens are stored together in a `dealfinder-local` item in **macOS Keychain / Windows Credential Manager**, keyed by the profile ID in `config.json`. Config and progress files contain page IDs and research results, not API keys. The runner does not read `.env.local`.

For a test profile, set `DEALFINDER_HOME` to a separate directory before setup. There is one named scheduler per OS user; installing a second profile replaces that user's scheduled task. Multiple independently scheduled profiles are not supported.

| Symptom | Action |
| --- | --- |
| 401 / missing credentials | Run setup with a valid API token. |
| 403 / 404 from Notion | Check page access, connection capabilities and the parent URL. |
| Model check succeeds but search fails | Check provider billing, web-search support for that model, and organization search permissions. |
| DailyTarget or controls error | Fix the JSON in Sourcing Rules; the agent fails closed. |
| No Notion failure entry | If credentials, controls or Notion itself are unavailable, inspect `agent.log` locally. |
| No runs after moving the repo or updating Node | Run `schedule` again; native tasks use absolute paths. |
| Keychain / Credential Manager error | Sign in to the same OS user and rerun setup to repair the stored entry. |
| Setup stops partway through | Rerun the installer. Named pages are rediscovered; no credentials need committing. |

`agent.log` rotates at about 2 MB, retaining one previous file. API response bodies and keys are not logged. If uninstalling completely, first unschedule, then remove the local data directory, the matching credential-store item, and the clone. Notion pages remain yours.

## Development and validation

```sh
npm --prefix agent ci
npm --prefix agent test
```

Tests use mock providers and Notion responses: no API credits or workspace writes. They cover source validation, both providers, pagination, repeat setup, interrupted writes, quotas, retry limits, DST, native scheduler configuration and process locking. GitHub Actions runs the suite on macOS and Windows. Live API authorization and native end-user installation still require an acceptance run with real accounts.

The runner uses the [OpenAI Responses web-search API](https://developers.openai.com/api/docs/guides/tools-web-search), [Claude Messages web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), and [Notion API version 2026-03-11](https://developers.notion.com/reference/versioning). Operating-system secrets use [keyring-node](https://github.com/Brooooooklyn/keyring-node).
