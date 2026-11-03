# Provider extension guide

The interface in `src/core/providers.ts` is independent of React and Electron. `ApplicationService` orchestrates a provider fetch and the vault import. `SyncEngine` receives only vault Skills.

## Contract

- `info`: stable kind, display name, trust description and explicit supported/reason capability flags.
- `discover(source)` / `search(source, query)`: return IDs, display metadata and a path relative to the configured source. Search is scoped to the selected source, not a global marketplace.
- `details(source, relativePath)`: metadata and original Markdown, never HTML.
- `fetch(source, relativePath)`: return an `Artifact` with `directory`, portable `id`, `provenance` and an awaited `dispose()` callback. Fetch must not install into the vault or agent directories.
- `checkUpdate`: compare content hashes. A version string alone is not sufficient evidence of changed or unchanged content.
- `versions`, `authenticate`, `remove`: reserved methods. Throw `AppError('NOT_IMPLEMENTED', ...)` and declare capabilities false until they work. `remove` never implicitly deletes a remote repository.

Register a replacement implementation in `ProviderRegistry`. Existing UI and sync code use the registry and do not need to know how content is fetched. A new configuration kind must be added to the versioned schema; regenerate `config/schema.json` and supply migration tests as needed. All current forms use generic location/ref/subdirectory settings rather than provider-specific install commands.

Local imports use the selected directory and ignore source `.git` metadata. Folder names become portable lowercase IDs; collisions are surfaced instead of silently renaming installed Skills. Descriptive names stay in front matter.

Git uses `isomorphic-git` with an injected HTTPS adapter. Clone is `noCheckout`; tree objects are inspected and only regular files are materialized into a bounded private staging directory. A commit ID is recorded. The network clone adapter is injectable for offline integration tests; never use a test adapter in production registration.

Do not use shell interpolation, global credentials, private registries, executable hooks, custom certificate bypasses or implicit service connections. New transports must independently implement timeout, cancellation, bounds and network address policy. Test update detection, malicious paths, links, unavailable capabilities, partial errors, and disposal after both success and failure.

## Discovery catalogs and previewed updates

`MarketAdapter` in `src/core/markets.ts` handles catalog discovery separately from `SkillSourceProvider`. The catalog result retains its original GitHub URL and normalized repository identity. Users configure that repository and select its actual Skill directory before importing. No marketplace result bypasses provider validation or writes directly into the vault. GitHub topic search is a repository search; SkillsMP is an experimental anonymous adapter whose real network contract still needs verification. Browser-only entries are not claimed as implemented adapters.

`previewSkillUpdate` fetches through any existing provider, captures a bounded content tree and releases the provider artifact. `applySkillUpdate` accepts only the stored preview ID, verifies local/config state and uses the captured bytes through `Vault.import`. The legacy unpreviewed `updateSkill` command now fails with `PREVIEW_REQUIRED`; persisted configuration and source records stay compatible. Replacement providers do not need changes to support the snapshot mechanism.
