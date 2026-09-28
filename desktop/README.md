# DealFinder companion

A small Electron app for setup and maintenance. Notion remains the working interface. The UI is packaged local HTML/CSS/JavaScript; it does not need a web server or a hosted account. The root Next.js scaffold is independent.

## Run locally

Use an official Node 22.13+ distribution, installed from nodejs.org or through nvm, on macOS or Windows:

```sh
npm --prefix agent ci
npm --prefix desktop ci
npm --prefix desktop start
```

Development uses the normal DealFinder data directory. Set `DEALFINDER_HOME` to a temporary directory for an isolated profile. Launching the app only reads local status; connections, Notion writes, and scheduling happen when the user clicks the relevant buttons. There is only one scheduler per OS user, even with different data directories.

The app uses the existing Keychain / Credential Manager entry. Updating credentials currently asks for both keys again. It never retrieves saved keys into the renderer. Setup checks model access without research generation, provisions or reuses the existing pages, adds DealFinder Settings, then installs background checks. Existing enabled workspaces may immediately resume sourcing. No paid test-run button is included.

## Build installers

```sh
npm --prefix desktop run dist -- --publish never
```

Artifacts appear in `desktop/dist`: a `.dmg` and `.zip` on macOS, or an NSIS `.exe` installer on Windows. `npm --prefix desktop run pack` produces an unpacked app for local inspection.

Build on each target OS/architecture. The build copies the host's standalone Node executable and license into the app and packages the agent with its production dependencies, including the matching native credential module. Cross-platform/cross-architecture packaging is rejected to avoid broken background runners. The GitHub Actions desktop workflow builds Mac ARM, Mac Intel, and Windows artifacts; those artifacts are unsigned development builds, not published releases.

For public releases, supply the appropriate signing credentials to electron-builder and configure Apple notarization. No signing credentials are checked in or assumed available. Verify the signed bundled Node executable and credential module on a clean machine as part of release acceptance. Do not publish the development artifacts as signed/notarized releases.

Install the Mac app in Applications before connecting; setup refuses to schedule from a mounted disk image or a translocated app. The scheduler uses absolute paths to the bundled Node and agent, so it survives closing the app and does not depend on a checkout or system Node. If the app is moved, choose **Repair background checks**. Stop background checks before uninstalling. Configuration and Notion content are preserved when removing the app.

## Links and trust boundary

Installed builds register `dealfinder://settings`. This link only brings the settings window forward. It accepts no credentials, parameters, commands, or workspace changes. Notion's API rejects this custom scheme in rich-text links, so provisioning creates an idempotent DealFinder Settings child page with manual launch instructions by default. Development mode does not register a protocol handler.

An optional browser launcher is provided in `public/dealfinder-settings.html`. Host this static file at a public HTTPS URL, then set `DEALFINDER_LAUNCHER_URL` to that exact URL when building the desktop app. Newly created Notion Settings pages will link through it, with **Open DealFinder Settings** and links to downloads/installation instructions. Existing Settings pages are preserved; change their link manually when deploying a launcher. No launcher is hosted and no releases are published by these build commands. Until then, open the app from Applications or the Start menu. Setup also adds start/pause guidance to older Settings pages without replacing user notes or sourcing controls.

The renderer has no Node access, no network access, and a restricted content security policy. A small preload bridge exposes allowlisted management actions and known external links. The main process validates the requesting frame. Each action runs a one-shot helper process using the bundled Node. Inputs travel over stdin, not command arguments or environment variables; progress/results travel over stdout. Both app and CLI respect the same process lock. During an operation, the app keeps its window open to avoid interrupting provisioning or scheduler installation.

## Validation

```sh
npm --prefix agent test
npm --prefix desktop test
cd desktop
npx playwright install chromium
npm run prepare-runtime
npm run test:ui
```

Tests use temporary profiles and mock credentials, never register a scheduler, and never make paid API requests or Notion writes. UI tests cover step validation, reconnecting, scheduling failure recovery, clearing secrets, navigation, and actual Electron startup with its isolated renderer and bundled helper.

Every package build also copies its bundled agent/runtime to a temporary directory outside the checkout and verifies helper startup plus native credential-module loading. This catches missing production dependencies that could otherwise resolve accidentally from development dependencies.

Release acceptance still requires real accounts and both operating systems: first setup, repeat setup, Notion link launches when the app is closed/open, native credential prompts, restart/sign-in scheduling, a run with the window closed, and uninstall/upgrade behavior. Keep setup paused until targeting rules are ready.
