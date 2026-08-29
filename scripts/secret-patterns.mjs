export const secretPatterns = Object.freeze([
  {
    name: "OpenAI-style API credential",
    // Avoid treating an `sk-` substring inside an ordinary identifier (for
    // example `flask-<commit>`) as the start of a credential.
    pattern: /(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}/u,
  },
  {
    name: "GitHub classic token",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/u,
  },
  {
    name: "GitHub fine-grained token",
    pattern: /github_pat_[A-Za-z0-9_]{20,}/u,
  },
  {
    name: "AWS access key",
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
]);
