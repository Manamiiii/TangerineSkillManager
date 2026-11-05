# Tangerine Skill Manager architecture

Status: first public-release candidate. Repository and engineering name: TangerineSkillManager. Display name: Tangerine Skill Manager.

## Product and platform decisions

Confirmed on 2026-11-02: Windows is the first supported release platform; macOS and Linux remain intended future platforms, with support claims gated on actual validation. The primary audience already uses Skills and needs library/source/synchronization management, rather than a general introduction to agents. The user authorized proceeding with the recommended update/preset/discovery work. Implemented boundaries, experimental integrations and remaining verification are recorded in `docs/ECOSYSTEM.md` and `docs/VALIDATION.md`.

An offline-first desktop application for a personal Skill library and explicit synchronization to configurable agents and projects. There is no account, telemetry, implicit marketplace connection, background update check, or agent execution. Imported instructions and remote release notes are untrusted data and are never executed or rendered as HTML.

Use Electron, React, Vite and TypeScript. Electron packages its runtime, and an embedded JavaScript Git implementation removes any runtime dependency on Git or a shell. This makes the same security and provider implementation testable on all platforms. Tradeoff: larger distribution and memory use than Tauri. There is no Rust component; Rust checks are not applicable. Node is needed only for development. Renderer sandboxing, context isolation, strict CSP and narrow validated IPC are mandatory.

## Windows distribution

Since 0.1.1, fresh per-user installations use `%LOCALAPPDATA%/Tangerine/Apps/TangerineSkillManager`. Registered legacy product directories (including Programs/Tangerine) are maintained in place after checking the path, uninstall command and product files. Maintenance rejects reparse points in the path or installed tree before handing the product directory to the NSIS removal code. Shared parent directories belong to all sibling applications. Installer fixtures exercise all three layouts under a temporary local profile and a separate GUID.

Windows application-owned data defaults to `%LOCALAPPDATA%/Tangerine/Data/TangerineSkillManager`, with Config, Storage, Cache, Logs, Backups, Runtime and Temp by purpose. `desktop/data-layout.ts` runs under the legacy Electron singleton mutex before starting Chromium, then sets the real profile/session/log/crash/temp paths. Legacy business migration is explicit, resumable only against verified bytes and preserves old vault/target/template identities. It copies config/state without schema changes and retains the original config under a new name, replacing its old pathname with a guard directory that also prevents old reset operations. New and old state are never silently merged. A before-write rollback archives the destination instead of deleting it. Legacy Chromium storage is retained but not copied, as no business data is stored there. Full safety boundaries, recovery and exceptions are in `docs/DATA_LAYOUT.md`.

Windows distribution policy (2026-11-03): this repository produces its own x64 NSIS Setup and Portable, with stable application ID `org.tangerineskillmanager.desktop` and installer GUID `048f50d3-d876-42d2-95f3-f0dce4cc270a`. Setup installs for the current user, never requests elevation, creates a Start Menu entry and HKCU uninstall registration, and does not start the app or create a desktop shortcut automatically. A custom NSIS process check refuses install/upgrade/uninstall while the app is running; it does not terminate it. Uninstall preserves configuration, vault, ownership records and synchronized Agent content. Setup and Portable share the same user data identity; there is no separate cloud account or migration service.

Installer automation uses a different application name, app ID and GUID plus an isolated process profile. It checks the binary product identity before execution and refuses existing fixture registration/shortcuts. Fixture build options only override identity, output and version: electron-builder already merges `package.json`, and repeating object arrays would schedule duplicate resource copies. Old-version fixtures use current application code and prove installer version handling only, not historical data migration. CI builds/tests but does not upload installers or create Releases. Formal-identity interactive installation and clean Windows standard-user acceptance remain separate release gates.

## Layers and domain

- `src/shared`: versioned configuration schema, transport types and domain models. No filesystem access.
- `src/core`: path policy, atomic persistence, Markdown parsing, scanning, vault, providers, synchronization and application orchestration. Independent of Electron and React.
- `src/desktop`: OS data directory, folder chooser, isolated preload and validated main-process IPC. No arbitrary command or file API exposed to the UI.
- `src/ui`: library, sources, agents, projects, scan, synchronization preview and settings. Uses one typed application bridge, never provider-specific filesystem code.

`Skill`: portable directory ID, display name, description, optional version/author/metadata, SHA-256 content hash, modification time and source record. A directory containing `SKILL.md` is one Skill; nested Skills are not traversed beneath it. IDs use lowercase ASCII letters, digits and hyphens and reject reserved device names.

`Agent`: stable key, display name, enabled flag, order, user/project/extra directories, read-only sources and optional JSON installation metadata rule. Defaults are editable examples, never hard-coded synchronization targets.

`Project`: stable key, name and user-selected local root. `Target`: resolved agent directory, workspace, scope, read-only flag, existence and real path.

`InstallRecord`: target identity, Skill ID, mode, content hash, source path and ownership token. Records live in private application state, separate from user-editable config. Copy installs also contain an ownership marker. Symlinks are owned only if the record and exact link destination agree. `SyncPlan` is an in-memory opaque ID with a snapshot of requested operations and source/target state; the renderer cannot submit arbitrary operations. `SyncResult` reports success, skipped, conflict and failed per item.

## Configuration contract (version 1)

Network extension (2026-11-02): optional `network: { dns: "system" | "cloudflare" }`. Omission preserves existing system DNS behavior and default file shape; the UI removes this field when returning to system DNS. Old v0/v1 files remain readable without migration. Older strict-schema readers cannot read the optional field once enabled, so remove it before downgrading. Vault/provenance/installation data are unchanged.

The explicit HTTPS DNS option addresses observed Fake-IP resolution failures. `core/network.ts` provides an injected `AddressResolver` for both Git and reviewed JSON transports; it does not alter the global resolver. Application services read the saved choice, and relevant result caches reset on settings changes. The Cloudflare endpoint is fixed, opt-in, IPv4-only, certificate-validated, bounded to 8 seconds and 64 KiB, with public-address validation before pinned TLS connections. Saving never makes a request. No silent resolver fallback, system setting changes, generic proxy/credentials or arbitrary DNS endpoints are introduced. Users are told which service receives hostname queries before saving. IPv6 DoH and general proxy support remain deferred pending user need; this option cannot solve all routing/proxy failures.

JSON Schema is generated from the runtime schema into `config/schema.json`. Example configuration is `config/example.json`. Fields: `version`, `vault.root`, `defaultSyncMode`, `agents[]`, `projects[]`, `providers[]`. Unknown properties, duplicate keys, invalid paths, unsafe metadata filenames and credential-bearing URLs are rejected. On fresh Windows installs `{data}` resolves to the new Storage directory and the vault defaults to `{data}/vault/skills`; Config and Storage hold config and ownership records respectively. Migrated Windows profiles retain their original template context to preserve links and source identity. Non-Windows defaults and the portable example retain the platform user data base and `{data}/skill-manager/vault/skills`.

Templates support `~`, `$HOME`, `${HOME}`, `%USERPROFILE%`, `{workspace}` and `{data}`; arbitrary environment variables are not expanded. Relative paths require an explicit base (project root or config directory). A foreign-platform absolute path is rejected on the current OS with an actionable message rather than misinterpreted. `..` path traversal is rejected. Projects and read-only roots may resolve symlinks for discovery; writable roots and every ancestor must be real directories, without symlinks/junctions.

Version 0 migration adds source settings and synchronization defaults. Before migration or restore, retain an exact timestamped backup. Invalid or future-version config blocks writes; the UI offers explicit reset with a backup. Changing vault root switches libraries; it does not silently move or delete the old library. Removed/disabled agents never trigger cleanup. State corruption fails closed as well.

## Provider contract

`SkillSourceProvider` exposes an ID and capabilities (`discover`, `search`, `details`, `fetch`, `updates`, `remove`, `versions`, `authentication`, `offline`, `trust`). Requests carry configured source settings; fetched artifacts are staged immutable directories with provenance and cleanup. The application imports them through the vault. Synchronization only sees vault content and never depends on a provider.

LocalFolderProvider discovers bounded local trees and supports offline import and hash-based update checks. GitProvider accepts explicitly configured public HTTPS URLs, branches/tags and an optional relative subdirectory. It uses embedded Git, never shells, credentials, submodules, hooks or a global Git config. Transport enforces time/size limits, rejects credentials, private/loopback addresses and cross-host redirects; it honors system TLS trust without disabling validation. Branches/tags resolve to recorded commits. Auth, global search, package registries and custom CLIs are explicitly unsupported. Provider removal means removing local configuration/cache, never deleting remote resources.

## Synchronization and deletion safety

Preview first, then execute an opaque stored plan once. Before each write, re-read configuration, source hash, target fingerprint and ownership; any change invalidates that operation. Serialize application mutations, and allow only one desktop instance. Unknown targets, case-insensitive name collisions, externally modified managed copies, altered markers and foreign symlinks are conflicts, including broken symlinks. Read-only roots cannot be selected or aliased as write targets. Vault, application state, source roots and nested destination roots must not overlap unsafely.

Copy only regular files/directories; reject symlinks, hard-linked files, reserved manager marker names and special files in imported trees. Bound depth, file count and bytes. Hash includes sorted relative names and file contents, excluding the manager marker and generated installation metadata only when validated by a private record. Installation metadata forces copy mode.

Stage writes in the destination filesystem with exclusive randomly named directories, verify the source again, then rename into place. Updates first move an owned unchanged target into a transaction backup. Persist ownership only after successful installation; failures leave discoverable content and never infer ownership. Cleanup is confined to a verified transaction directory and refuses symlinks. Ordinary crashes may leave a staging/backup directory; these are preserved for manual recovery and excluded from scans. No automatic broad cleanup.

Deletion requires a specifically selected Skill or install record. Vault deletion requires its private record and matching hash. Installed-copy deletion requires private ownership, matching marker and unchanged content hash; symlink deletion requires the exact recorded link. Recheck immediately before rename into a private transaction directory. Never recursively follow symlinks. Content changed outside the application must be preserved. Delete from vault does not uninstall copies; live symlink installs must be removed explicitly first.

This protects against accidental overwrite and ordinary concurrent changes. It is not a filesystem sandbox against another process running as the same OS user deliberately racing syscalls; portable Node path checks cannot fully eliminate TOCTOU. A future native handle-relative backend would strengthen that boundary.

## Errors, privacy and recovery

Typed errors contain a stable code, actionable message and optional item context. No automatic retry of writes. Independent plan items continue after one failure. Logs contain only event/error codes and counters; never raw exceptions, paths, URLs, Skill text, credentials or configuration. User-facing local dialogs may display the user's chosen paths. Network access requires an explicit Git source, release-check or selected-market search action. Market search sends the entered query only. No telemetry or crash upload.

## Updates, discovery and preset boundaries

`AppUpdateChecker` reads a fixed GitHub stable-release endpoint with one-minute result caching. No token, update installer, automatic download or background check is added. Browser links pass main-process validation: fixed discovery/release pages or validated public GitHub repository/tree/blob URLs. Remote response links never control the application update destination. The renderer cannot navigate or fetch arbitrary URLs.

`MarketAdapter` is a separate discovery contract. GitHub topic-repository search and experimental SkillsMP anonymous search return normalized candidates; market failures are independent, successful queries are cached for a minute (20 entries maximum), and the renderer explicitly labels repository versus Skill results. Import still uses a user-confirmed Git source and existing Provider/Vault flow. No registry package/plugin installer is implied. Reviewed JSON endpoints use public DNS validation, pinned lookup, no redirects, a 15-second total deadline including DNS and a 2 MiB response bound. Actual public API validation remains blocked by the local DNS environment.

`SkillUpdates` holds at most four bounded content snapshots in memory, each valid for 15 minutes; expired snapshots are discarded at the next preview/apply operation. Preview compares file/directory names and bytes, records source provenance and configuration/current content fingerprints, and reports linked targets. Apply is single-use, verifies local/config state, stages the captured bytes and imports through existing guarded vault logic without another network fetch. The old unpreviewed `updateSkill` IPC returns `PREVIEW_REQUIRED`; persistent config/state formats remain unchanged. Snapshots disappear on restart; no source contents enter logs.

Agent presets are editable configuration recipes, not synchronization adapters. Adding a preset opens the editor; an existing matching directory opens that existing configuration instead. No defaults or saved user config are silently replaced. The safety layer still rejects arbitrary overlapping targets.

## Implementation stages

1. Architecture, runtime schema, generated JSON Schema, portable example.
2. Safe path expansion, atomic config/state storage, parser and hash, bounded scanner, vault and preview/execution/delete engine. Test safety before UI work.
3. Local and public Git provider with capability-driven source UI and real local integration tests.
4. Desktop bridge and React views for library, sources, agents, projects, scanning, plan/results and settings/recovery.
5. Migration, redacted event log, platform packaging, documentation and end-to-end acceptance fixture.
6. Registry, auto-update and additional adapters are deferred, shown as unavailable. They are not necessary for the first release and will not connect to services implicitly.

## Open release decisions and explicit limitations

Public-readiness review decisions: an opt-in bundled example lowers onboarding cost without configuring a remote service. Provider settings describe location/ref/subdirectory capabilities to the renderer. New source records add an optional repository-subdirectory identity field; legacy incomplete Git provenance blocks updates, while reads and synchronization remain compatible. Directory hashes include empty directories so externally added content is not silently removed. Chinese result/help text and compact path templates do not alter on-disk data; full paths remain inspectable. No push, Release creation or publication is authorized in this review round.

- Confirmed repository: https://github.com/Manamiiii/TangerineSkillManager. Development is directly on `main`, as requested. Initial candidate version: 0.1.0.
- GNU GPL version 3 only (`GPL-3.0-only`) selected by the maintainer on 2026-11-03 for sharing this open-source tool. Third-party dependencies and imported Skills retain their own licenses. Future separate commercial projects are outside this repository's scope. Signing identities and macOS notarization credentials are not available; unsigned artifacts must be labeled as such. Public release publishing needs a real repository and explicit release setup.
- Confirmed UI decision: Chinese first, internationalization later. Six navigation entries: library, synchronization, agents, projects, sources and settings. Reference screenshots inform layout only; their service-specific content is excluded.
- Offline mode supports local sources and already imported Git Skills; uncached Git fetch fails explicitly.
- No arbitrary post-install scripts or dynamic third-party code. Adding a provider is a developer extension implementing the same interface/registry; user-configured sources are data.
- Symlink mode uses directory junctions on Windows and directory symbolic links elsewhere. Permission failures are explicit. Installation metadata is the one documented automatic copy override.
- Cross-platform CI/build instructions are supplied. Actual local Windows checks and unexecuted macOS/Linux checks must be distinguished in the validation report.
