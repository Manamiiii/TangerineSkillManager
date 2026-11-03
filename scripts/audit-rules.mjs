const normalize = (value) => value.replace(/\\+/g, '/').toLowerCase();
const genericUsers = new Set(['example', 'user', 'username', '<user>', '<username>', '{user}', '{username}']);

// Return categories only: never echo matched credentials or personal paths into CI logs.
export function privacyIssues(filename, content, context = {}) {
  const issues = new Set();
  const name = normalize(filename);
  const base = name.split('/').at(-1);
  if (
    /(?:^|\/)(?:node_modules|release|dist|dist-desktop|test-results|coverage|\.idea|\.vscode|\.history|logs)(?:\/|$)/.test(
      name,
    ) ||
    (/^\.env(?:\.|$)/.test(base) && base !== '.env.example') ||
    /^(?:config|state)\.json(?:\.backup-.*)?$/.test(base) ||
    /(?:\.log|\.lnk|\.exe|\.dmg|\.appimage|\.zip|\.pfx|\.p12|\.pem|\.key|\.bak|\.local\.json)$/i.test(base)
  )
    issues.add('local data, credentials or generated artifact');

  const normalized = normalize(content);
  for (const [key, reason] of [
    ['home', 'current home directory'],
    ['workspace', 'current checkout directory'],
  ]) {
    const value = context[key];
    if (value && value.length > 3 && normalized.includes(normalize(value))) issues.add(reason);
  }
  for (const key of ['username', 'hostname']) {
    const value = context[key];
    // Generic OS/CI account words also occur in workflow syntax. Actual paths are still checked above/below.
    if (
      key === 'username' &&
      ['runner', 'runneradmin', 'root', 'user', 'admin', 'administrator'].includes(value?.toLowerCase())
    )
      continue;
    if (value && value.length > 3 && normalized.includes(value.toLowerCase())) issues.add(`current ${key}`);
  }
  for (const match of normalized.matchAll(/(?:[a-z]:\/users\/|\/users\/|\/home\/)([^/\s"'`]+)/g)) {
    if (!genericUsers.has(match[1])) issues.add('non-generic user directory');
  }
  // Concrete drive paths are valid only in synthetic cross-platform path fixtures.
  if (!name.startsWith('tests/') && /\b[a-z]:\/(?!\/)/i.test(normalized))
    issues.add('literal Windows absolute path; use a path template');
  if (/https?:\/\/[^\s"'<>]*(?:\.internal\b|\.corp\b|\.local\b)/i.test(content)) issues.add('private domain');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) issues.add('private key');
  if (/\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,}|sk-[a-zA-Z0-9]{32,})\b/.test(content))
    issues.add('access credential');
  if (/(?:_authToken|_password|_auth)\s*=\s*(?!\$\{)[^\s]+/.test(content))
    issues.add('package registry credential');
  for (const raw of content.match(/https?:\/\/[^\s"'<>),]+/g) ?? []) {
    try {
      const url = new URL(raw);
      if (url.hostname.includes('registry') && url.hostname !== 'registry.npmjs.org')
        issues.add('nonpublic package registry');
      if ((url.username || url.password) && !name.startsWith('tests/')) issues.add('credentials in URL');
    } catch {}
  }
  return [...issues];
}
