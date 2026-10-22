/**
 * Masks well-known secret formats before anything is stored (design 10.1).
 * Deliberately conservative: only patterns with a low false-positive rate.
 */

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Replacement; defaults to a marker naming the kind. */
  replace?: (match: string, ...groups: string[]) => string;
}

const marker = (kind: string) => `[REDACTED:${kind}]`;

const RULES: Rule[] = [
  {
    kind: 'private_key',
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
  },
  { kind: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'aws_secret_key',
    pattern: /(aws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}/gi,
    replace: (_m, prefix) => `${prefix}${marker('aws_secret_key')}`,
  },
  { kind: 'gitlab_token', pattern: /\bgl(?:pat|dt|rt|cbt|ptt|ft|imt|agent)-[0-9A-Za-z_-]{20,}/g },
  {
    kind: 'github_token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g,
  },
  { kind: 'slack_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'api_key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'agentcowork_token', pattern: /\bacw_(?:host|pat)_[a-z0-9]{16,}/g },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    kind: 'url_credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(@)/gi,
    replace: (_m, prefix, at) => `${prefix}${marker('password')}${at}`,
  },
];

export interface RedactResult {
  text: string;
  /** Distinct kinds that were masked, in rule order. */
  kinds: string[];
}

export function redact(text: string): RedactResult {
  const kinds: string[] = [];
  let out = text;
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(out)) continue;
    rule.pattern.lastIndex = 0;
    kinds.push(rule.kind);
    out = out.replace(rule.pattern, (match, ...rest) =>
      rule.replace ? rule.replace(match, ...(rest as string[])) : marker(rule.kind),
    );
  }
  return { text: out, kinds };
}
