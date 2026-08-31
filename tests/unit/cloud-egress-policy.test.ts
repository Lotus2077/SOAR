import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CLOUD_EGRESS_POLICY_VERSION,
  CLOUD_EGRESS_PROVENANCE_VERSION,
  evaluateCloudEgressPolicyV1,
  type CloudEgressPolicyInputV1,
  type CloudEgressProvenanceEntryV1,
} from "../../src/main/cloud-egress-policy";
import type { ProviderMessage } from "../../src/main/providers/types";

const WORKSPACE_ROOT = "/Volumes/Agent Work/project";
const HOME_ROOT = "/Users/example";
const DEFAULT_MESSAGES = [
  { role: "system", content: "Review the bounded evidence." },
  { role: "user", content: "src/router.ts changed safely." },
] as const satisfies readonly ProviderMessage[];

type SegmentSource =
  | { sourceKind: "host" | "user"; sourceId: string }
  | {
      sourceKind: "workspace";
      sourceId: string;
      relativePath: string;
      pathAdmission: "admitted" | "denied";
    }
  | {
      sourceKind: "artifact";
      sourceId: string;
      artifactAdmission: "admitted" | "unadmitted";
    };

function contentOf(message: ProviderMessage): string {
  return message.role === "assistant" ? (message.content ?? "") : message.content;
}

function segment(
  messages: readonly ProviderMessage[],
  messageIndex: number,
  source: SegmentSource,
  contentStartUtf16 = 0,
  contentEndUtf16 = contentOf(messages[messageIndex]!).length,
): CloudEgressProvenanceEntryV1 {
  const content = contentOf(messages[messageIndex]!);
  return {
    messageIndex,
    contentStartUtf16,
    contentEndUtf16,
    contentSha256: createHash("sha256")
      .update(content.slice(contentStartUtf16, contentEndUtf16), "utf8")
      .digest("hex"),
    ...source,
  } as CloudEgressProvenanceEntryV1;
}

function input(
  messages: readonly ProviderMessage[] = DEFAULT_MESSAGES,
  options: {
    entries?: readonly CloudEgressProvenanceEntryV1[];
    consent?: "granted" | "none";
    secrets?: readonly string[];
    toolDefinitions?: "none" | "present";
    workspaceRoot?: string;
    homeRoot?: string;
  } = {},
): CloudEgressPolicyInputV1 {
  return {
    messages,
    provenance: {
      schemaVersion: CLOUD_EGRESS_PROVENANCE_VERSION,
      taskEgressConsent: options.consent ?? "granted",
      entries:
        options.entries ??
        messages.map((message, messageIndex) => ({
          ...segment(messages, messageIndex, {
            sourceKind: message.role === "user" ? "user" : "host",
            sourceId: `message-${messageIndex}`,
          }),
        })),
    },
    hostBoundary: {
      canonicalWorkspaceRoot: options.workspaceRoot ?? WORKSPACE_ROOT,
      canonicalHomeRoot: options.homeRoot ?? HOME_ROOT,
      knownSecretValues: options.secrets ?? [],
    },
    requestPolicy: {
      toolDefinitions: options.toolDefinitions ?? "none",
    },
  };
}

describe("cloud egress policy v1", () => {
  it("passes bounded consented messages and returns only safe semantic evidence", () => {
    const result = evaluateCloudEgressPolicyV1(
      input(undefined, {
        entries: [
          segment(DEFAULT_MESSAGES, 0, {
            sourceKind: "host",
            sourceId: "system-prompt",
          }),
          segment(DEFAULT_MESSAGES, 1, {
            sourceKind: "workspace",
            sourceId: "evidence-1",
            relativePath: "src/router.ts",
            pathAdmission: "admitted",
          }),
        ],
      }),
    );

    expect(result).toEqual({
      policyVersion: CLOUD_EGRESS_POLICY_VERSION,
      decision: "pass",
      reasonCodes: [],
      messagesSemanticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      provenanceSemanticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.keys(result).sort()).toEqual([
      "decision",
      "messagesSemanticSha256",
      "policyVersion",
      "provenanceSemanticSha256",
      "reasonCodes",
    ]);
  });

  it.each([
    `${WORKSPACE_ROOT}/src/router.ts`,
    String.raw`\/Volumes\/Agent Work\/project\/src\/router.ts`,
    String.raw`\u002fVolumes\u002fAgent Work\u002fproject\u002fsrc`,
    "%2FVolumes%2FAgent%20Work%2Fproject%2Fsrc",
    "%252FVolumes%252FAgent%2520Work%252Fproject%252Fsrc",
    "%2525252FVolumes%2525252FAgent%25252520Work%2525252Fproject%2525252Fsrc",
    "％2FVolumes％2FAgent％20Work％2Fproject％2Fsrc",
    String.raw`＼u002fVolumes＼u002fAgent Work＼u002fproject＼u002fsrc`,
    String.raw`\U0000002FVolumes\U0000002FAgent Work\U0000002Fproject\U0000002Fsrc`,
    String.raw`\Volumes\Agent Work\project\src`,
    "/Volumes/./Agent Work/./project/src",
    "/Volumes/Agent Work/decoy/../project/src",
    String.raw`\Volumes\Agent Work\decoy\..\project\src`,
    "%2FVolumes%2FAgent%20Work%2Fdecoy%2F..%2Fproject%2Fsrc",
    "%252FVolumes%252FAgent%2520Work%252Fdecoy%252F%252E%252E%252Fproject%252Fsrc",
    String.raw`\u002fVolumes\u002fAgent Work\u002fdecoy\u002f\u002e\u002e\u002fproject\u002fsrc`,
  ])("denies workspace roots in raw and escaped forms", (content) => {
    expect(
      evaluateCloudEgressPolicyV1(
        input([{ role: "user", content }]),
      ).reasonCodes,
    ).toContain("absolute_workspace_path");
  });

  it("fails closed when nested encoding exceeds the transform bound", () => {
    let content = WORKSPACE_ROOT;
    for (let pass = 0; pass < 12; pass += 1) {
      content = encodeURIComponent(content);
    }

    const result = evaluateCloudEgressPolicyV1(
      input([{ role: "user", content }]),
    );

    expect(result.decision).toBe("deny");
    expect(result.reasonCodes).toContain("encoding_transform_limit");
  });

  it.each([
    `${HOME_ROOT}/.ssh/config`,
    String.raw`\u002fUsers\u002fexample\u002f.ssh\u002fconfig`,
    "%2FUsers%2Fexample%2F.ssh%2Fconfig",
  ])("denies home roots in raw and escaped forms", (content) => {
    expect(
      evaluateCloudEgressPolicyV1(
        input([{ role: "user", content }]),
      ).reasonCodes,
    ).toContain("absolute_home_path");
  });

  it.each([
    "%2FVolumes%2F%E9%A1%B9%E7%9B%AE%2Fproject%2Fsrc%2Frouter.ts",
    "%252FVolumes%252F%25E9%25A1%25B9%25E7%259B%25AE%252Fproject%252Fsrc",
    "%FF%2FVolumes%2F%E9%A1%B9%E7%9B%AE%2Fproject%2Fsrc",
  ])("decodes UTF-8 percent-encoded Unicode roots before admission", (content) => {
    const workspaceRoot = "/Volumes/项目/project";
    const messages = [
      {
        role: "user",
        content,
      },
    ] as const;

    expect(
      evaluateCloudEgressPolicyV1(
        input(messages, { workspaceRoot }),
      ).reasonCodes,
    ).toContain("absolute_workspace_path");
  });

  it.each([
    "opaque-known-secret-value-123456",
    "opaque%2Dknown%2Dsecret%2Dvalue%2D123456",
    String.raw`opaque\u002dknown\u002dsecret\u002dvalue\u002d123456`,
  ])("denies known secrets without returning their content", (content) => {
    const secret = "opaque-known-secret-value-123456";
    const result = evaluateCloudEgressPolicyV1(
      input([{ role: "user", content }], { secrets: [secret] }),
    );
    const serialized = JSON.stringify(result);

    expect(result.reasonCodes).toContain("known_secret_value");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(content);
    expect(serialized).not.toContain(WORKSPACE_ROOT);
    expect(serialized).not.toContain(HOME_ROOT);
  });

  it.each([
    ["sk-" + "or-v1-" + "12345678901234567890", "recognized_api_token"],
    ["ghp" + "_123456789012345678901234567890123456", "recognized_api_token"],
    ["AK" + "IA1234567890123456", "recognized_api_token"],
    ["-----BEGIN " + "OPENSSH PRIVATE KEY-----", "private_key_material"],
  ] as const)("denies recognized secret material", (content, reason) => {
    expect(
      evaluateCloudEgressPolicyV1(
        input([{ role: "user", content }]),
      ).reasonCodes,
    ).toContain(reason);
  });

  it("does not mistake sk- inside an ordinary identifier for a credential", () => {
    expect(
      evaluateCloudEgressPolicyV1(
        input([
          {
            role: "user",
            content: "cal-flask-899929545331006514cad3dbbad5b45956664dc5",
          },
        ]),
      ).decision,
    ).toBe("pass");
  });

  it.each([
    {
      relativePath: ".env.local",
      pathAdmission: "admitted" as const,
    },
    {
      relativePath: "src/router.ts",
      pathAdmission: "denied" as const,
    },
    {
      relativePath: "/Users/example/secret.txt",
      pathAdmission: "admitted" as const,
    },
  ])("denies unsafe or host-denied path provenance", (entry) => {
    const messages = [{ role: "user", content: "bounded evidence" }] as const;
    const result = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [
          segment(messages, 0, {
            sourceKind: "workspace",
            sourceId: "workspace-source",
            ...entry,
          }),
        ],
      }),
    );

    expect(result.reasonCodes).toContain("denied_path_provenance");
  });

  it("denies unadmitted artifacts and permits admitted artifacts", () => {
    const messages = [{ role: "user", content: "artifact body" }] as const;
    const artifact = (artifactAdmission: "admitted" | "unadmitted") =>
      evaluateCloudEgressPolicyV1(
        input(messages, {
          entries: [
            segment(messages, 0, {
              sourceKind: "artifact",
              sourceId: "artifact-1",
              artifactAdmission,
            }),
          ],
        }),
      );

    expect(artifact("unadmitted").reasonCodes).toContain(
      "unadmitted_artifact_provenance",
    );
    expect(artifact("admitted").decision).toBe("pass");
  });

  it("requires exact, hash-bound provenance coverage for every message body", () => {
    const messages = [
      { role: "user", content: "safe prefix hidden artifact body" },
    ] as const;
    const prefixEnd = messages[0].content.indexOf("hidden");
    const omitted = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [
          segment(
            messages,
            0,
            { sourceKind: "user", sourceId: "objective" },
            0,
            prefixEnd,
          ),
        ],
      }),
    );
    const stale = segment(messages, 0, {
      sourceKind: "user",
      sourceId: "objective",
    });
    stale.contentSha256 = createHash("sha256")
      .update("different body", "utf8")
      .digest("hex");
    const mismatched = evaluateCloudEgressPolicyV1(
      input(messages, { entries: [stale] }),
    );

    expect(omitted.reasonCodes).toContain("provenance_incomplete");
    expect(mismatched.reasonCodes).toContain("provenance_binding_invalid");
  });

  it("rejects conflicting duplicate attribution and preserves denied sources", () => {
    const messages = [{ role: "user", content: "artifact body" }] as const;
    const result = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [
          segment(messages, 0, {
            sourceKind: "user",
            sourceId: "objective",
          }),
          segment(messages, 0, {
            sourceKind: "artifact",
            sourceId: "artifact-1",
            artifactAdmission: "unadmitted",
          }),
        ],
      }),
    );

    expect(result.reasonCodes).toEqual([
      "provenance_binding_invalid",
      "unadmitted_artifact_provenance",
    ]);
  });

  it("accepts an exact partition while applying policy to each source segment", () => {
    const messages = [
      { role: "user", content: "host|artifact|host" },
    ] as const;
    const result = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [
          segment(
            messages,
            0,
            { sourceKind: "host", sourceId: "prefix" },
            0,
            5,
          ),
          segment(
            messages,
            0,
            {
              sourceKind: "artifact",
              sourceId: "artifact-1",
              artifactAdmission: "unadmitted",
            },
            5,
            13,
          ),
          segment(
            messages,
            0,
            { sourceKind: "host", sourceId: "suffix" },
            13,
          ),
        ],
      }),
    );

    expect(result.reasonCodes).toEqual(["unadmitted_artifact_provenance"]);
  });

  it("rejects provenance boundaries that split a Unicode surrogate pair", () => {
    const messages = [{ role: "user", content: "a😀b" }] as const;
    const result = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [
          segment(
            messages,
            0,
            { sourceKind: "user", sourceId: "first" },
            0,
            2,
          ),
          segment(
            messages,
            0,
            { sourceKind: "user", sourceId: "second" },
            2,
          ),
        ],
      }),
    );

    expect(result.reasonCodes).toContain("provenance_binding_invalid");
  });

  it("explicitly denies request-level tool definitions", () => {
    const result = evaluateCloudEgressPolicyV1(
      input(undefined, { toolDefinitions: "present" }),
    );

    expect(result.reasonCodes).toEqual(["tool_definitions_present"]);
  });

  it("denies an owned assistant tool_calls field even when it is empty", () => {
    const messages = [
      { role: "assistant", content: "safe synthesis", tool_calls: [] },
    ] as const satisfies readonly ProviderMessage[];
    const result = evaluateCloudEgressPolicyV1(input(messages));

    expect(result.reasonCodes).toEqual(["tool_protocol_present"]);
  });

  it("fails closed on missing consent, incomplete provenance, and tool protocol", () => {
    const messages = [
      { role: "system", content: "system" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function" as const,
            function: { name: "read_text_file", arguments: "{}" },
          },
        ],
      },
    ] as const satisfies readonly ProviderMessage[];
    const result = evaluateCloudEgressPolicyV1(
      input(
        messages,
        {
          consent: "none",
          entries: [
            segment(messages, 0, {
              sourceKind: "host",
              sourceId: "system",
            }),
          ],
        },
      ),
    );

    expect(result.decision).toBe("deny");
    expect(result.reasonCodes).toEqual([
      "egress_consent_missing",
      "provenance_incomplete",
      "tool_protocol_present",
    ]);
  });

  it("hashes message order and content but ignores provenance entry ordering", () => {
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: "evidence" },
    ] as const satisfies readonly ProviderMessage[];
    const entries = [
      segment(messages, 0, { sourceKind: "host", sourceId: "system" }),
      segment(messages, 1, { sourceKind: "user", sourceId: "objective" }),
    ] as const satisfies readonly CloudEgressProvenanceEntryV1[];
    const first = evaluateCloudEgressPolicyV1(input(messages, { entries }));
    const reordered = evaluateCloudEgressPolicyV1(
      input(messages, { entries: [entries[1], entries[0]] }),
    );
    const changedMessages = [
      messages[0],
      { role: "user", content: "different evidence" },
    ] as const satisfies readonly ProviderMessage[];
    const changedMessage = evaluateCloudEgressPolicyV1(input(changedMessages));
    const changedProvenance = evaluateCloudEgressPolicyV1(
      input(messages, {
        entries: [entries[0], { ...entries[1], sourceId: "objective-2" }],
      }),
    );

    expect(reordered.provenanceSemanticSha256).toBe(
      first.provenanceSemanticSha256,
    );
    expect(reordered.messagesSemanticSha256).toBe(
      first.messagesSemanticSha256,
    );
    expect(changedMessage.messagesSemanticSha256).not.toBe(
      first.messagesSemanticSha256,
    );
    expect(changedProvenance.provenanceSemanticSha256).not.toBe(
      first.provenanceSemanticSha256,
    );
  });

  it("rejects extra message fields with a static secret-free error", () => {
    const secret = "do-not-echo-this-sensitive-value";
    const malformed = input([
      { role: "user", content: "safe", extra: secret } as ProviderMessage,
    ]);

    expect(() => evaluateCloudEgressPolicyV1(malformed)).toThrow(
      "messages[0] contains unsupported fields.",
    );
    try {
      evaluateCloudEgressPolicyV1(malformed);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects non-canonical host roots before policy admission", () => {
    const malformed = input();
    malformed.hostBoundary.canonicalWorkspaceRoot =
      "/Volumes/Agent Work/../Agent Work/project";

    expect(() => evaluateCloudEgressPolicyV1(malformed)).toThrow(
      "hostBoundary.canonicalWorkspaceRoot must be a canonical absolute path.",
    );
  });
});
