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

/** Key names whose values are secrets: password, api_key, client_secret, access_token, … */
const SECRET_KEY = String.raw`[\w.-]*(?:pass(?:word|wd)?|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|credential)s?[\w.-]*`;

/** Words that follow "password:" in code (type annotations, literals), not secrets. */
const CODE_WORDS = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'null',
  'undefined',
  'true',
  'false',
  'str',
  'int',
  'bool',
  'none',
  'nil',
  'required',
  'optional',
  'await',
  'new',
  'this',
]);

/** Keeps the key, masks the value; leaves code-looking values alone. */
const maskValue =
  (kind: string) =>
  (match: string, prefix: string, value: string): string => {
    const v = value.toLowerCase();
    if (CODE_WORDS.has(v) || /[(){}]|^\$|^\[REDACTED/.test(value)) return match;
    return `${prefix}${marker(kind)}`;
  };

const RULES: Rule[] = [
  {
    kind: 'private_key',
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
  },
  { kind: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'aliyun_access_key', pattern: /\bLTAI[0-9A-Za-z]{12,24}\b/g },
  { kind: 'tencent_secret_id', pattern: /\bAKID[0-9A-Za-z]{13,40}\b/g },
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
    // Greedy up to the last "@" of the URL, so passwords containing "@" or "/" are covered.
    kind: 'url_credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s"'<>]{3,}(@)(?=[^\s@"'<>]+)/gi,
    replace: (_m, prefix, at) => `${prefix}${marker('password')}${at}`,
  },
  {
    kind: 'auth_header',
    pattern:
      /(\bAuthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, prefix) => `${prefix}${marker('auth_header')}`,
  },
  {
    kind: 'cookie',
    pattern: /(\b(?:Set-)?Cookie["']?\s*:\s*["']?)[^\r\n"']{8,}/gi,
    replace: (_m, prefix) => `${prefix}${marker('cookie')}`,
  },
  {
    // "password": "x", password = 'x', api_key: "x" (quoted values, any key style).
    kind: 'secret_value',
    pattern: new RegExp(
      String.raw`(["']?\b${SECRET_KEY}["']?\s*[:=]\s*["'])([^\s"']{4,})(?=["'])`,
      'gi',
    ),
    replace: maskValue('secret_value'),
  },
  {
    // .env / YAML / query strings: DB_PASSWORD=x, password: x, ?token=x
    kind: 'secret_value',
    // "=" without spaces (env, query) or YAML "key: value"; "token = await …" is code.
    pattern: new RegExp(
      String.raw`((?:^|[\s?&;])${SECRET_KEY}(?:=|:[ \t]+))([^\s"'&;,]{4,})(?=$|[\s&;])`,
      'gim',
    ),
    replace: maskValue('secret_value'),
  },
  {
    kind: 'id_card',
    pattern:
      /(?<![0-9Xx])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9Xx])/g,
  },
  { kind: 'phone', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
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
    const next = out.replace(rule.pattern, (match, ...rest) =>
      rule.replace ? rule.replace(match, ...(rest as string[])) : marker(rule.kind),
    );
    // A rule may decline a match (code, not a secret), so compare instead of test().
    if (next !== out && !kinds.includes(rule.kind)) kinds.push(rule.kind);
    out = next;
  }
  return { text: out, kinds };
}
