# Contributing

Thank you for helping build a local-first Skill manager.

1. Open an issue describing the user-visible problem and expected behavior. Do not include private Skill contents, credentials or personal paths.
2. Use Node.js 24 LTS or a newer supported release, then run `npm ci`.
3. Keep domain/filesystem code in `src/core`, transport contracts in `src/shared`, desktop APIs in `src/desktop`, and presentation in `src/ui`.
4. Add meaningful tests for safety boundaries or changed behavior. Never run tests against real agent directories.
5. Run `npm run schema`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:desktop` and `npm run audit:source`. Report exactly which checks ran and on which OS.
6. Describe the problem, resulting behavior, validation and any migration or compatibility impact in your pull request.

Provider extensions must declare unsupported capabilities truthfully. Network requests must be explicit user actions. Do not add telemetry, executable install hooks, embedded tokens, private endpoints or silent fallback from failed symlink operations.

Filesystem changes require tests for external files, altered ownership, path traversal, symlinks, partial failure and idempotency. Keep the explicit same-user race limitation accurate; do not claim an OS sandbox.

Generated `config/schema.json` must match the runtime schema. Commit the npm lockfile. Do not commit build output, screenshots with personal paths, local configuration or log files.

Before committing, run `npm run audit:source -- --staged` to check the actual Git index. Use portable path templates in documentation and synthetic paths in tests. Review images manually and use a GitHub privacy email for public commits; see [publication privacy checks](docs/PUBLICATION.md).

By contributing, you agree that your contribution is available under GNU GPL version 3 only (`GPL-3.0-only`; see [LICENSE](LICENSE)) and to follow the code of conduct. Only submit material you have the right to license on these terms; preserve third-party copyright and license notices.
