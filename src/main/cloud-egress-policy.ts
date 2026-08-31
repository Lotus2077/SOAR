import { createHash } from "node:crypto";

import type { ProviderMessage } from "./providers/types";
import {
  isIgnoredRelativePath,
  normalizeWorkspaceRelativePath,
} from "./tools/workspace-policy";

export const CLOUD_EGRESS_POLICY_VERSION = "cloud-egress-policy-v1" as const;
export const CLOUD_EGRESS_PROVENANCE_VERSION =
  "cloud-egress-provenance-v1" as const;

export const CLOUD_EGRESS_POLICY_LIMITS = {
  maxMessages: 256,
  maxMessageCharacters: 2 * 1024 * 1024,
  maxTotalMessageBytes: 8 * 1024 * 1024,
  maxProvenanceEntries: 4_096,
  maxSourceIdCharacters: 128,
  maxRelativePathCharacters: 4_096,
  maxKnownSecrets: 32,
  maxKnownSecretCharacters: 16_384,
} as const;

export const CLOUD_EGRESS_REASON_CODES = [
  "absolute_home_path",
  "absolute_workspace_path",
  "denied_path_provenance",
  "encoding_transform_limit",
  "egress_consent_missing",
  "known_secret_value",
  "private_key_material",
  "provenance_binding_invalid",
  "provenance_incomplete",
  "recognized_api_token",
  "tool_definitions_present",
  "tool_protocol_present",
  "unadmitted_artifact_provenance",
] as const;

export type CloudEgressReasonCode =
  (typeof CLOUD_EGRESS_REASON_CODES)[number];

interface CloudEgressProvenanceSegmentBaseV1 {
  messageIndex: number;
  /** Inclusive UTF-16 code-unit offset into the canonical message content. */
  contentStartUtf16: number;
  /** Exclusive UTF-16 code-unit offset into the canonical message content. */
  contentEndUtf16: number;
  /** SHA-256 of the exact content slice identified by the two offsets. */
  contentSha256: string;
  sourceId: string;
}

export type CloudEgressProvenanceEntryV1 =
  | {
      messageIndex: CloudEgressProvenanceSegmentBaseV1["messageIndex"];
      contentStartUtf16: CloudEgressProvenanceSegmentBaseV1["contentStartUtf16"];
      contentEndUtf16: CloudEgressProvenanceSegmentBaseV1["contentEndUtf16"];
      contentSha256: CloudEgressProvenanceSegmentBaseV1["contentSha256"];
      sourceKind: "host" | "user";
      sourceId: CloudEgressProvenanceSegmentBaseV1["sourceId"];
    }
  | {
      messageIndex: CloudEgressProvenanceSegmentBaseV1["messageIndex"];
      contentStartUtf16: CloudEgressProvenanceSegmentBaseV1["contentStartUtf16"];
      contentEndUtf16: CloudEgressProvenanceSegmentBaseV1["contentEndUtf16"];
      contentSha256: CloudEgressProvenanceSegmentBaseV1["contentSha256"];
      sourceKind: "workspace";
      sourceId: CloudEgressProvenanceSegmentBaseV1["sourceId"];
      relativePath: string;
      pathAdmission: "admitted" | "denied";
    }
  | {
      messageIndex: CloudEgressProvenanceSegmentBaseV1["messageIndex"];
      contentStartUtf16: CloudEgressProvenanceSegmentBaseV1["contentStartUtf16"];
      contentEndUtf16: CloudEgressProvenanceSegmentBaseV1["contentEndUtf16"];
      contentSha256: CloudEgressProvenanceSegmentBaseV1["contentSha256"];
      sourceKind: "artifact";
      sourceId: CloudEgressProvenanceSegmentBaseV1["sourceId"];
      artifactAdmission: "admitted" | "unadmitted";
    };

/**
 * Host-authored attribution for every provider message. The manifest is data
 * lineage, not renderer or provider input, and must be built from trusted host
 * state rather than inferred from model text.
 */
export interface CloudEgressProvenanceManifestV1 {
  schemaVersion: typeof CLOUD_EGRESS_PROVENANCE_VERSION;
  taskEgressConsent: "granted" | "none";
  entries: readonly CloudEgressProvenanceEntryV1[];
}

/**
 * Host-only values used to scan the candidate request. They are deliberately
 * excluded from both returned semantic hashes, so neither a root fingerprint
 * nor a credential-derived fingerprint can escape through the policy result.
 */
export interface CloudEgressHostBoundaryV1 {
  canonicalWorkspaceRoot: string;
  canonicalHomeRoot: string;
  knownSecretValues: readonly string[];
}

export interface CloudEgressPolicyInputV1 {
  messages: readonly ProviderMessage[];
  provenance: CloudEgressProvenanceManifestV1;
  hostBoundary: CloudEgressHostBoundaryV1;
  requestPolicy: Readonly<{
    /** Request-envelope fact supplied by the trusted host compiler. */
    toolDefinitions: "none" | "present";
  }>;
}

export interface CloudEgressPolicyResultV1 {
  policyVersion: typeof CLOUD_EGRESS_POLICY_VERSION;
  decision: "pass" | "deny";
  reasonCodes: CloudEgressReasonCode[];
  messagesSemanticSha256: string;
  provenanceSemanticSha256: string;
}

type JsonPrimitive = boolean | number | string | null;
type CanonicalJson =
  | JsonPrimitive
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const API_TOKEN_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{36,}/u,
  /github_pat_[A-Za-z0-9_]{20,}/u,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
] as const;

const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:[A-Z0-9][A-Z0-9 -]{0,47} )?PRIVATE KEY-----/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const record = value as Readonly<Record<string, CanonicalJson>>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(",")}}`;
}

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record.`);
  }
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }
}

function assertBoundedString(
  value: unknown,
  maximum: number,
  label: string,
  options: { allowEmpty?: boolean; sourceId?: boolean } = {},
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > maximum ||
    value.includes("\0") ||
    (options.sourceId && !SOURCE_ID_PATTERN.test(value))
  ) {
    throw new TypeError(`${label} is not a bounded canonical string.`);
  }
}

function canonicalToolCall(value: unknown, index: number): CanonicalJson {
  const label = `messages[].tool_calls[${index}]`;
  assertPlainRecord(value, label);
  assertExactKeys(value, ["id", "type", "function"], label);
  assertBoundedString(value.id, 256, `${label}.id`);
  if (value.type !== "function") {
    throw new TypeError(`${label}.type must be function.`);
  }
  assertPlainRecord(value.function, `${label}.function`);
  assertExactKeys(
    value.function,
    ["name", "arguments"],
    `${label}.function`,
  );
  assertBoundedString(value.function.name, 256, `${label}.function.name`);
  assertBoundedString(
    value.function.arguments,
    CLOUD_EGRESS_POLICY_LIMITS.maxMessageCharacters,
    `${label}.function.arguments`,
    { allowEmpty: true },
  );

  return {
    id: value.id,
    type: "function",
    function: {
      name: value.function.name,
      arguments: value.function.arguments,
    },
  };
}

function canonicalProviderMessage(
  message: unknown,
  index: number,
): CanonicalJson {
  const label = `messages[${index}]`;
  assertPlainRecord(message, label);
  const role = message.role;

  if (role === "system" || role === "user") {
    assertExactKeys(message, ["role", "content"], label);
    assertBoundedString(
      message.content,
      CLOUD_EGRESS_POLICY_LIMITS.maxMessageCharacters,
      `${label}.content`,
      { allowEmpty: true },
    );
    return { role, content: message.content };
  }

  if (role === "tool") {
    assertExactKeys(message, ["role", "content", "tool_call_id"], label);
    assertBoundedString(
      message.content,
      CLOUD_EGRESS_POLICY_LIMITS.maxMessageCharacters,
      `${label}.content`,
      { allowEmpty: true },
    );
    assertBoundedString(message.tool_call_id, 256, `${label}.tool_call_id`);
    return {
      role,
      content: message.content,
      tool_call_id: message.tool_call_id,
    };
  }

  if (role === "assistant") {
    const hasToolCalls = Object.hasOwn(message, "tool_calls");
    assertExactKeys(
      message,
      hasToolCalls ? ["role", "content", "tool_calls"] : ["role", "content"],
      label,
    );
    if (message.content !== null) {
      assertBoundedString(
        message.content,
        CLOUD_EGRESS_POLICY_LIMITS.maxMessageCharacters,
        `${label}.content`,
        { allowEmpty: true },
      );
    }
    if (!hasToolCalls) return { role, content: message.content as string | null };
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 128) {
      throw new TypeError(`${label}.tool_calls is not a bounded array.`);
    }
    return {
      role,
      content: message.content as string | null,
      tool_calls: message.tool_calls.map(canonicalToolCall),
    };
  }

  throw new TypeError(`${label}.role is not supported.`);
}

function canonicalMessages(messages: readonly ProviderMessage[]): {
  canonical: readonly CanonicalJson[];
  serialized: string;
} {
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > CLOUD_EGRESS_POLICY_LIMITS.maxMessages
  ) {
    throw new TypeError("messages must be a non-empty bounded array.");
  }
  const canonical = messages.map(canonicalProviderMessage);
  const serialized = canonicalJson(canonical);
  if (
    utf8Encoder.encode(serialized).byteLength >
    CLOUD_EGRESS_POLICY_LIMITS.maxTotalMessageBytes
  ) {
    throw new TypeError("messages exceed the serialized byte bound.");
  }
  return { canonical, serialized };
}

function canonicalProvenanceEntry(
  entry: CloudEgressProvenanceEntryV1,
  index: number,
  messageCount: number,
): CanonicalJson {
  const label = `provenance.entries[${index}]`;
  assertPlainRecord(entry, label);
  if (
    !Number.isSafeInteger(entry.messageIndex) ||
    entry.messageIndex < 0 ||
    entry.messageIndex >= messageCount
  ) {
    throw new TypeError(`${label}.messageIndex is out of bounds.`);
  }
  if (
    !Number.isSafeInteger(entry.contentStartUtf16) ||
    entry.contentStartUtf16 < 0
  ) {
    throw new TypeError(`${label}.contentStartUtf16 is not supported.`);
  }
  if (
    !Number.isSafeInteger(entry.contentEndUtf16) ||
    entry.contentEndUtf16 < 0
  ) {
    throw new TypeError(`${label}.contentEndUtf16 is not supported.`);
  }
  if (
    typeof entry.contentSha256 !== "string" ||
    !SHA256_PATTERN.test(entry.contentSha256)
  ) {
    throw new TypeError(`${label}.contentSha256 is not canonical SHA-256.`);
  }
  assertBoundedString(
    entry.sourceId,
    CLOUD_EGRESS_POLICY_LIMITS.maxSourceIdCharacters,
    `${label}.sourceId`,
    { sourceId: true },
  );

  if (entry.sourceKind === "host" || entry.sourceKind === "user") {
    assertExactKeys(
      entry,
      [
        "messageIndex",
        "contentStartUtf16",
        "contentEndUtf16",
        "contentSha256",
        "sourceKind",
        "sourceId",
      ],
      label,
    );
    return {
      messageIndex: entry.messageIndex,
      contentStartUtf16: entry.contentStartUtf16,
      contentEndUtf16: entry.contentEndUtf16,
      contentSha256: entry.contentSha256,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
    };
  }

  if (entry.sourceKind === "workspace") {
    assertExactKeys(
      entry,
      [
        "messageIndex",
        "contentStartUtf16",
        "contentEndUtf16",
        "contentSha256",
        "sourceKind",
        "sourceId",
        "relativePath",
        "pathAdmission",
      ],
      label,
    );
    assertBoundedString(
      entry.relativePath,
      CLOUD_EGRESS_POLICY_LIMITS.maxRelativePathCharacters,
      `${label}.relativePath`,
    );
    if (
      entry.pathAdmission !== "admitted" &&
      entry.pathAdmission !== "denied"
    ) {
      throw new TypeError(`${label}.pathAdmission is not supported.`);
    }
    return {
      messageIndex: entry.messageIndex,
      contentStartUtf16: entry.contentStartUtf16,
      contentEndUtf16: entry.contentEndUtf16,
      contentSha256: entry.contentSha256,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      relativePath: entry.relativePath,
      pathAdmission: entry.pathAdmission,
    };
  }

  if (entry.sourceKind === "artifact") {
    assertExactKeys(
      entry,
      [
        "messageIndex",
        "contentStartUtf16",
        "contentEndUtf16",
        "contentSha256",
        "sourceKind",
        "sourceId",
        "artifactAdmission",
      ],
      label,
    );
    if (
      entry.artifactAdmission !== "admitted" &&
      entry.artifactAdmission !== "unadmitted"
    ) {
      throw new TypeError(`${label}.artifactAdmission is not supported.`);
    }
    return {
      messageIndex: entry.messageIndex,
      contentStartUtf16: entry.contentStartUtf16,
      contentEndUtf16: entry.contentEndUtf16,
      contentSha256: entry.contentSha256,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      artifactAdmission: entry.artifactAdmission,
    };
  }

  throw new TypeError(`${label}.sourceKind is not supported.`);
}

function canonicalProvenance(
  provenance: CloudEgressProvenanceManifestV1,
  messageCount: number,
): {
  entries: readonly CanonicalJson[];
  serialized: string;
} {
  assertPlainRecord(provenance, "provenance");
  assertExactKeys(
    provenance,
    ["schemaVersion", "taskEgressConsent", "entries"],
    "provenance",
  );
  if (provenance.schemaVersion !== CLOUD_EGRESS_PROVENANCE_VERSION) {
    throw new TypeError("provenance.schemaVersion is not supported.");
  }
  if (
    provenance.taskEgressConsent !== "granted" &&
    provenance.taskEgressConsent !== "none"
  ) {
    throw new TypeError("provenance.taskEgressConsent is not supported.");
  }
  if (
    !Array.isArray(provenance.entries) ||
    provenance.entries.length >
      CLOUD_EGRESS_POLICY_LIMITS.maxProvenanceEntries
  ) {
    throw new TypeError("provenance.entries is not a bounded array.");
  }

  const entries = provenance.entries.map((entry, index) =>
    canonicalProvenanceEntry(entry, index, messageCount),
  );
  // Ordering is not semantically meaningful, but duplicate declarations are:
  // preserving them lets binding validation reject overlaps instead of hiding
  // a conflicting or repeated attribution through hash-set de-duplication.
  const semanticEntries = [...entries].sort((left, right) =>
    compareText(canonicalJson(left), canonicalJson(right)),
  );
  const serialized = canonicalJson({
    schemaVersion: CLOUD_EGRESS_PROVENANCE_VERSION,
    taskEgressConsent: provenance.taskEgressConsent,
    entries: semanticEntries,
  });
  return { entries: semanticEntries, serialized };
}

function assertHostBoundary(boundary: CloudEgressHostBoundaryV1): void {
  assertPlainRecord(boundary, "hostBoundary");
  assertExactKeys(
    boundary,
    ["canonicalWorkspaceRoot", "canonicalHomeRoot", "knownSecretValues"],
    "hostBoundary",
  );
  for (const [field, value] of [
    ["canonicalWorkspaceRoot", boundary.canonicalWorkspaceRoot],
    ["canonicalHomeRoot", boundary.canonicalHomeRoot],
  ] as const) {
    assertBoundedString(value, 16_384, `hostBoundary.${field}`);
    const segments = value.slice(1).split("/");
    if (
      !value.startsWith("/") ||
      value === "/" ||
      value.endsWith("/") ||
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment === "." ||
          segment === ".." ||
          /[\u0000-\u001f\u007f]/u.test(segment),
      )
    ) {
      throw new TypeError(
        `hostBoundary.${field} must be a canonical absolute path.`,
      );
    }
  }
  if (
    !Array.isArray(boundary.knownSecretValues) ||
    boundary.knownSecretValues.length > CLOUD_EGRESS_POLICY_LIMITS.maxKnownSecrets
  ) {
    throw new TypeError("hostBoundary.knownSecretValues is not a bounded array.");
  }
  for (const secret of boundary.knownSecretValues) {
    assertBoundedString(
      secret,
      CLOUD_EGRESS_POLICY_LIMITS.maxKnownSecretCharacters,
      "hostBoundary.knownSecretValues[]",
    );
  }
}

function assertRequestPolicy(
  requestPolicy: CloudEgressPolicyInputV1["requestPolicy"],
): void {
  assertPlainRecord(requestPolicy, "requestPolicy");
  assertExactKeys(requestPolicy, ["toolDefinitions"], "requestPolicy");
  if (
    requestPolicy.toolDefinitions !== "none" &&
    requestPolicy.toolDefinitions !== "present"
  ) {
    throw new TypeError("requestPolicy.toolDefinitions is not supported.");
  }
}

function messageContent(message: ProviderMessage): string {
  return message.role === "assistant" ? (message.content ?? "") : message.content;
}

function splitsSurrogatePair(value: string, offsetUtf16: number): boolean {
  if (offsetUtf16 <= 0 || offsetUtf16 >= value.length) return false;
  const before = value.charCodeAt(offsetUtf16 - 1);
  const after = value.charCodeAt(offsetUtf16);
  return (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

/**
 * Verify that the trusted host manifest partitions each canonical message body
 * exactly once and binds each declared source to the exact covered slice. The
 * source classification itself remains host-authored; this prevents omission,
 * stale offsets/hashes, overlap, and conflicting duplicate attribution.
 */
function evaluateProvenanceBinding(
  messages: readonly ProviderMessage[],
  entries: readonly CloudEgressProvenanceEntryV1[],
  reasons: Set<CloudEgressReasonCode>,
): void {
  const entriesByMessage = Array.from(
    { length: messages.length },
    () => [] as CloudEgressProvenanceEntryV1[],
  );
  for (const entry of entries) {
    entriesByMessage[entry.messageIndex]!.push(entry);
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const content = messageContent(messages[messageIndex]!);
    const segments = entriesByMessage[messageIndex]!.sort(
      (left, right) =>
        left.contentStartUtf16 - right.contentStartUtf16 ||
        left.contentEndUtf16 - right.contentEndUtf16 ||
        compareText(left.contentSha256, right.contentSha256) ||
        compareText(left.sourceKind, right.sourceKind) ||
        compareText(left.sourceId, right.sourceId),
    );

    if (segments.length === 0) {
      reasons.add("provenance_incomplete");
      continue;
    }

    if (content.length === 0) {
      if (segments.length !== 1) reasons.add("provenance_binding_invalid");
      for (const segment of segments) {
        if (
          segment.contentStartUtf16 !== 0 ||
          segment.contentEndUtf16 !== 0 ||
          segment.contentSha256 !== sha256Text("")
        ) {
          reasons.add("provenance_binding_invalid");
        }
      }
      continue;
    }

    let coveredUntil = 0;
    for (const segment of segments) {
      const { contentStartUtf16: start, contentEndUtf16: end } = segment;
      if (start > coveredUntil) reasons.add("provenance_incomplete");
      const overlapsCoveredContent = start < coveredUntil;
      if (overlapsCoveredContent) reasons.add("provenance_binding_invalid");

      const invalidRange =
        end <= start ||
        start > content.length ||
        end > content.length ||
        splitsSurrogatePair(content, start) ||
        splitsSurrogatePair(content, end);
      if (invalidRange) {
        reasons.add("provenance_binding_invalid");
      } else if (
        !overlapsCoveredContent &&
        segment.contentSha256 !== sha256Text(content.slice(start, end))
      ) {
        reasons.add("provenance_binding_invalid");
      }

      if (start <= coveredUntil) {
        coveredUntil = Math.max(coveredUntil, Math.min(end, content.length));
      } else {
        coveredUntil = Math.min(end, content.length);
      }
    }
    if (coveredUntil < content.length) reasons.add("provenance_incomplete");
  }
}

function replacePercentEncodedUtf8(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/gu, (encoded) => {
    const octets = encoded.match(/[0-9A-Fa-f]{2}/gu);
    if (octets === null) return encoded;
    const bytes = Uint8Array.from(
      octets.map((octet) => Number.parseInt(octet, 16)),
    );
    // Replacement decoding is intentional: a malformed octet adjacent to a
    // valid escaped path must not prevent the valid suffix from being scanned.
    return utf8Decoder.decode(bytes);
  });
}

function decodeEscapedView(value: string): string {
  return replacePercentEncodedUtf8(value)
    .replace(/\\U([0-9A-Fa-f]{8})/gu, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\\u\{([0-9A-Fa-f]{1,6})\}/gu, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\\u([0-9A-Fa-f]{4})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\x([0-9A-Fa-f]{2})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&#x([0-9A-Fa-f]{1,6});/gu, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&#([0-9]{1,7});/gu, (match, digits: string) => {
      const code = Number.parseInt(digits, 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\\\//gu, "/");
}

function comparisonView(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/\\/gu, "/")
    .replace(/\/{2,}/gu, "/");

  const isAbsolute = normalized.startsWith("/");
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  return `${isAbsolute ? "/" : ""}${segments.join("/")}`;
}

const MAX_SCAN_TRANSFORM_DEPTH = 8;

interface ScanViewsResult {
  readonly views: readonly string[];
  readonly exhausted: boolean;
}

/**
 * Close the bounded scan set under Unicode normalization, escape decoding, and
 * path comparison. Normalized values are fed back through decoding so
 * full-width percent/backslash forms cannot evade the next transform.
 */
function scanViews(value: string): ScanViewsResult {
  const views = new Set<string>();
  const enqueued = new Set<string>([value]);
  const queue: Array<{ value: string; depth: number }> = [
    { value, depth: 0 },
  ];
  let exhausted = false;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const normalized = current.value.normalize("NFKC");
    const decoded = decodeEscapedView(current.value);
    const decodedNormalized = decodeEscapedView(normalized);
    const compared = comparisonView(current.value);
    const candidates = new Set([
      current.value,
      normalized,
      decoded,
      decodedNormalized,
      compared,
    ]);

    for (const candidate of candidates) {
      views.add(candidate);
      views.add(comparisonView(candidate));
      if (candidate === current.value || enqueued.has(candidate)) continue;
      if (current.depth >= MAX_SCAN_TRANSFORM_DEPTH) {
        exhausted = true;
        continue;
      }
      enqueued.add(candidate);
      queue.push({ value: candidate, depth: current.depth + 1 });
    }
  }

  return { views: [...views], exhausted };
}

function stringLeaves(value: CanonicalJson): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  return Object.values(value).flatMap(stringLeaves);
}

function containsNormalized(
  views: readonly string[],
  needle: string,
  caseInsensitive = false,
): boolean {
  const needleViews = scanViews(needle).views;
  return views.some((view) =>
    needleViews.some((candidate) =>
      caseInsensitive
        ? view.toLocaleLowerCase("en-US").includes(
            candidate.toLocaleLowerCase("en-US"),
          )
        : view.includes(candidate),
    ),
  );
}

function isDeniedWorkspaceProvenance(
  entry: Extract<CloudEgressProvenanceEntryV1, { sourceKind: "workspace" }>,
): boolean {
  if (entry.pathAdmission === "denied") return true;
  try {
    const normalized = normalizeWorkspaceRelativePath(entry.relativePath, false);
    return normalized !== entry.relativePath || isIgnoredRelativePath(normalized);
  } catch {
    return true;
  }
}

/**
 * Pure shadow admission for a future tool-free cloud request. It performs no
 * filesystem, provider, session, persistence, or network operation. A thrown
 * validation error contains only a static field label, never caller content.
 */
export function evaluateCloudEgressPolicyV1(
  input: CloudEgressPolicyInputV1,
): CloudEgressPolicyResultV1 {
  assertPlainRecord(input, "input");
  assertExactKeys(
    input,
    ["messages", "provenance", "hostBoundary", "requestPolicy"],
    "input",
  );
  const messages = canonicalMessages(input.messages);
  const provenance = canonicalProvenance(
    input.provenance,
    input.messages.length,
  );
  assertHostBoundary(input.hostBoundary);
  assertRequestPolicy(input.requestPolicy);

  const reasons = new Set<CloudEgressReasonCode>();
  for (const entry of input.provenance.entries) {
    if (
      entry.sourceKind === "workspace" &&
      isDeniedWorkspaceProvenance(entry)
    ) {
      reasons.add("denied_path_provenance");
    }
    if (
      entry.sourceKind === "artifact" &&
      entry.artifactAdmission === "unadmitted"
    ) {
      reasons.add("unadmitted_artifact_provenance");
    }
  }
  evaluateProvenanceBinding(input.messages, input.provenance.entries, reasons);
  if (input.provenance.taskEgressConsent !== "granted") {
    reasons.add("egress_consent_missing");
  }
  if (input.requestPolicy.toolDefinitions !== "none") {
    reasons.add("tool_definitions_present");
  }

  if (
    input.messages.some(
      (message) =>
        message.role === "tool" ||
        (message.role === "assistant" &&
          Object.hasOwn(message, "tool_calls")),
    )
  ) {
    reasons.add("tool_protocol_present");
  }

  const values = [messages.serialized, ...messages.canonical.flatMap(stringLeaves)];
  const scanResults = values.map(scanViews);
  if (scanResults.some((result) => result.exhausted)) {
    reasons.add("encoding_transform_limit");
  }
  const views = scanResults.flatMap((result) => result.views);
  if (
    containsNormalized(
      views,
      input.hostBoundary.canonicalWorkspaceRoot,
      true,
    )
  ) {
    reasons.add("absolute_workspace_path");
  }
  if (
    containsNormalized(views, input.hostBoundary.canonicalHomeRoot, true)
  ) {
    reasons.add("absolute_home_path");
  }
  if (
    input.hostBoundary.knownSecretValues.some((secret) =>
      containsNormalized(views, secret),
    )
  ) {
    reasons.add("known_secret_value");
  }
  if (
    views.some((view) =>
      API_TOKEN_PATTERNS.some((pattern) => pattern.test(view)),
    )
  ) {
    reasons.add("recognized_api_token");
  }
  if (views.some((view) => PRIVATE_KEY_PATTERN.test(view))) {
    reasons.add("private_key_material");
  }

  const reasonCodes = [...reasons].sort(compareText);
  return {
    policyVersion: CLOUD_EGRESS_POLICY_VERSION,
    decision: reasonCodes.length === 0 ? "pass" : "deny",
    reasonCodes,
    messagesSemanticSha256: sha256Text(messages.serialized),
    provenanceSemanticSha256: sha256Text(provenance.serialized),
  };
}
