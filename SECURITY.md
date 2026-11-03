# Security policy

The first release candidate protects local content from accidental overwrites, mistaken ownership and ordinary concurrent edits. It does not sandbox another malicious process running as the same operating-system user. Skill instructions are untrusted data; the application never executes them.

## Reporting

Use GitHub private vulnerability reporting from the repository Security tab if the owner has enabled it. Otherwise contact the owner privately through their public profile to arrange a report. Do not publish credentials, private paths, Skill contents or exploitable details in an ordinary issue. Only the latest published release is intended to receive security fixes.

## Boundaries

- Sandboxed renderer, context isolation, no renderer Node access, CSP, denied renderer network/permissions/navigation, and validated main-frame IPC.
- Application mutations are serialized; the desktop allows one instance per profile.
- Ownership requires private records and a matching marker or exact recorded symlink target. Changed content is retained.
- Copy staging and guarded rename provide per-item recovery, not a multi-root transaction. Crashes can leave hidden backups; these are never automatically deleted across arbitrary roots.
- Path checks reject symlink/junction ancestors, traversal and unsafe overlaps. Portable Node checks cannot eliminate every filesystem TOCTOU race; a native handle-relative implementation is a possible future improvement.
- Git has a dedicated public HTTPS transport with DNS-address validation, pinned lookup, no redirects, no authentication, no shell and bounded time/bytes. No submodules, hooks or global Git configuration are used.
- No automatic remote checks, telemetry or uploads. Logs contain event codes and timestamps only.
- DNS uses the system resolver by default. Users may explicitly save Cloudflare HTTPS DNS for public Git, market and release requests. Only requested hostnames are sent to the fixed `https://1.1.1.1/dns-query` endpoint (IPv4 only); no Skill content, search text or local paths. DNS requests have an 8-second deadline and 64 KiB limit. Private/reserved answers, malformed responses and redirects fail closed, with no automatic fallback or OS changes. Target connections retain pinned public addresses and hostname/certificate verification. This is not proxy support. Saving a setting does not trigger a request.
- Explicit market search sends only the user's query; application checks use a fixed public GitHub Releases endpoint. JSON requests enforce reviewed endpoints, public DNS, pinned lookup, no redirects, a 15-second deadline and a 2 MiB response limit. User-initiated browser links are validated in the main process.
- Skill updates require a single-use, expiring snapshot preview. Applying a preview does not fetch newer unreviewed content. Copy installations remain unchanged until synchronization; symlink/junction installations immediately reference the updated library. No application binary is automatically downloaded or executed.

Before a public release, maintainers should review current dependencies, sign and notarize distributions as appropriate, and run the native-platform CI and desktop acceptance tests. Signing credentials belong in secret storage, never in configuration examples or source.
