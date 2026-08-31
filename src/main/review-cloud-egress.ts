import {
  CLOUD_EGRESS_POLICY_LIMITS,
  CLOUD_EGRESS_PROVENANCE_VERSION,
  type CloudEgressProvenanceEntryV1,
  type CloudEgressProvenanceManifestV1,
} from "./cloud-egress-policy";
import { canonicalChangeJson } from "./change-acquisition-contracts";
import type { CompiledReviewContextV1 } from "./review-context-compiler-v1";
import { sha256Hex } from "../shared/context-compiler";
import {
  HYBRID_SIMULATION_CONSENT_ID,
} from "../shared/hybrid-simulation-contracts";
import {
  isIgnoredRelativePath,
  normalizeWorkspaceRelativePath,
} from "./tools/workspace-policy";

type SegmentSource =
  | { kind: "host"; sourceId: "review.packet.host" }
  | { kind: "user"; sourceId: "review.objective.user" }
  | {
      kind: "workspace";
      sourceId: "review.workspace.evidence";
      relativePath: string;
      pathAdmission: "admitted" | "denied";
    };

interface RenderedSegment {
  text: string;
  source: SegmentSource;
}

const HOST_SOURCE: SegmentSource = {
  kind: "host",
  sourceId: "review.packet.host",
};
const USER_SOURCE: SegmentSource = {
  kind: "user",
  sourceId: "review.objective.user",
};
const REVIEW_PACKET_PREFIX = "SOAR_REVIEW_SYNTHESIS_PACKET_V1\n";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathAdmission(relativePath: string): "admitted" | "denied" {
  try {
    return normalizeWorkspaceRelativePath(relativePath, false) === relativePath &&
      !isIgnoredRelativePath(relativePath)
      ? "admitted"
      : "denied";
  } catch {
    return "denied";
  }
}

function workspaceSource(relativePath: string): SegmentSource {
  return {
    kind: "workspace",
    sourceId: "review.workspace.evidence",
    relativePath,
    pathAdmission: pathAdmission(relativePath),
  };
}

function sameSource(left: SegmentSource, right: SegmentSource): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function appendSegment(
  segments: RenderedSegment[],
  text: string,
  source: SegmentSource,
): void {
  if (text.length === 0) return;
  const previous = segments.at(-1);
  if (previous && sameSource(previous.source, source)) {
    previous.text += text;
    return;
  }
  segments.push({ text, source });
}

function objectWorkspacePath(
  record: Readonly<Record<string, unknown>>,
  inherited: string | undefined,
): string | undefined {
  if (typeof record.path === "string") return record.path;
  if (typeof record.newPath === "string") return record.newPath;
  if (typeof record.oldPath === "string") return record.oldPath;
  return inherited;
}

function renderAnnotatedCanonicalJson(options: {
  value: unknown;
  segments: RenderedSegment[];
  key?: string;
  workspacePath?: string;
}): void {
  const { value, segments, key } = options;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    appendSegment(segments, canonicalChangeJson(value), HOST_SOURCE);
    return;
  }
  if (typeof value === "string") {
    const source =
      key === "objective"
        ? USER_SOURCE
        : (key === "path" || key === "oldPath" || key === "newPath")
          ? workspaceSource(value)
          : (key === "text" || key === "content") && options.workspacePath
            ? workspaceSource(options.workspacePath)
            : HOST_SOURCE;
    appendSegment(segments, JSON.stringify(value), source);
    return;
  }
  if (Array.isArray(value)) {
    appendSegment(segments, "[", HOST_SOURCE);
    value.forEach((entry, index) => {
      if (index > 0) appendSegment(segments, ",", HOST_SOURCE);
      renderAnnotatedCanonicalJson({
        value: entry,
        segments,
        ...(options.workspacePath === undefined
          ? {}
          : { workspacePath: options.workspacePath }),
      });
    });
    appendSegment(segments, "]", HOST_SOURCE);
    return;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError("Review provenance accepts canonical JSON values only.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const workspacePath = objectWorkspacePath(record, options.workspacePath);
  appendSegment(segments, "{", HOST_SOURCE);
  Object.keys(record)
    .sort(compareText)
    .forEach((field, index) => {
      if (record[field] === undefined) {
        throw new TypeError("Review provenance cannot bind undefined values.");
      }
      if (index > 0) appendSegment(segments, ",", HOST_SOURCE);
      appendSegment(segments, `${JSON.stringify(field)}:`, HOST_SOURCE);
      renderAnnotatedCanonicalJson({
        value: record[field],
        segments,
        key: field,
        ...(workspacePath === undefined ? {} : { workspacePath }),
      });
    });
  appendSegment(segments, "}", HOST_SOURCE);
}

function entriesForMessage(
  messageIndex: number,
  content: string,
  segments: readonly RenderedSegment[],
): CloudEgressProvenanceEntryV1[] {
  const rendered = segments.map((segment) => segment.text).join("");
  if (rendered !== content) {
    throw new Error("Review provenance rendering diverged from provider messages.");
  }
  let offset = 0;
  return segments.map((segment) => {
    const start = offset;
    offset += segment.text.length;
    const common = {
      messageIndex,
      contentStartUtf16: start,
      contentEndUtf16: offset,
      contentSha256: sha256Hex(content.slice(start, offset)),
      sourceId: segment.source.sourceId,
    };
    if (segment.source.kind === "workspace") {
      return {
        ...common,
        sourceKind: "workspace" as const,
        relativePath: segment.source.relativePath,
        pathAdmission: segment.source.pathAdmission,
      };
    }
    return {
      ...common,
      sourceKind: segment.source.kind,
    };
  });
}

export interface ReviewCloudEgressProvenanceV1 {
  manifest: CloudEgressProvenanceManifestV1;
  overflowed: boolean;
}

/**
 * Bind the exact compiled review messages to host/user/workspace sources. If a
 * valid packet would exceed the policy's bounded entry count, return an empty
 * but valid manifest so the policy deterministically denies it as incomplete.
 */
export function buildReviewCloudEgressProvenanceV1(options: {
  compiled: CompiledReviewContextV1;
  simulationConsent?: typeof HYBRID_SIMULATION_CONSENT_ID;
}): ReviewCloudEgressProvenanceV1 {
  if (options.compiled.messages.length !== 2) {
    throw new Error("Review cloud provenance requires exactly two messages.");
  }
  const [system, user] = options.compiled.messages;
  if (system?.role !== "system" || user?.role !== "user") {
    throw new Error("Review cloud provenance requires system then user messages.");
  }
  const expectedUserContent = `${REVIEW_PACKET_PREFIX}${canonicalChangeJson(
    options.compiled.packet,
  )}`;
  if (user.content !== expectedUserContent) {
    throw new Error("Review packet content changed before provenance binding.");
  }

  const systemSegments: RenderedSegment[] = [];
  appendSegment(systemSegments, system.content, HOST_SOURCE);
  const userSegments: RenderedSegment[] = [];
  appendSegment(userSegments, REVIEW_PACKET_PREFIX, HOST_SOURCE);
  renderAnnotatedCanonicalJson({
    value: options.compiled.packet,
    segments: userSegments,
  });
  const entries = [
    ...entriesForMessage(0, system.content, systemSegments),
    ...entriesForMessage(1, user.content, userSegments),
  ];
  const overflowed =
    entries.length > CLOUD_EGRESS_POLICY_LIMITS.maxProvenanceEntries;
  return {
    manifest: Object.freeze({
      schemaVersion: CLOUD_EGRESS_PROVENANCE_VERSION,
      taskEgressConsent:
        options.simulationConsent === HYBRID_SIMULATION_CONSENT_ID
          ? "granted"
          : "none",
      entries: Object.freeze(overflowed ? [] : entries),
    }),
    overflowed,
  };
}
