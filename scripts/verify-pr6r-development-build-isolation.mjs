import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES,
  PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
  PR6R_DEVELOPMENT_FORBIDDEN_BUNDLE_SIGNATURES,
  assertRendererBundleLocked,
} from "./locked-credential-package-policy.mjs";
import {
  PR6R_BUILD_GRAPHS,
  PR6R_DEVELOPMENT_GRAPH_PROOF_FILE,
  canonicalPr6rDevelopmentGraphProof,
} from "./pr6r-development-build-graph-policy.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultOutputRoot = path.join(projectRoot, "out");
const supportedModes = new Set(["normal", "development-canary"]);
const artifactRelativePaths = Object.freeze({
  main: path.join("main", "index.js"),
  preload: path.join("preload", "index.cjs"),
  renderer: path.join("renderer", "index.html"),
});
const MAX_SCANNED_FILES = 2_000;
const MAX_SCANNED_BYTES = 64 * 1024 * 1024;

async function boundedOutputArtifactText(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (entry.isFile()) {
        files.push(candidate);
      } else {
        throw new Error(
          "PR6R build isolation scan found an unsupported output entry type.",
        );
      }
    }
    if (files.length + pending.length > MAX_SCANNED_FILES) {
      throw new Error("PR6R build isolation scan exceeded its file bound.");
    }
  }

  if (files.length === 0) {
    throw new Error("PR6R build isolation scan found no bundled output.");
  }
  files.sort();

  let declaredBytes = 0n;
  for (const file of files) {
    const metadata = await lstat(file, { bigint: true });
    if (!metadata.isFile()) {
      throw new Error(
        "PR6R build isolation scan found an unsupported output entry type.",
      );
    }
    declaredBytes += metadata.size;
    if (declaredBytes > BigInt(MAX_SCANNED_BYTES)) {
      throw new Error("PR6R build isolation scan exceeded its byte bound.");
    }
  }

  let scannedBytes = 0;
  let bundledText = "";
  for (const file of files) {
    const contents = await readFile(file);
    scannedBytes += contents.byteLength;
    if (scannedBytes > MAX_SCANNED_BYTES) {
      throw new Error("PR6R build isolation scan exceeded its byte bound.");
    }
    bundledText += contents.toString("utf8");
  }
  return bundledText;
}

function exactOccurrenceCount(text, needle) {
  return text.split(needle).length - 1;
}

async function readRequiredText(file, stableFailure) {
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new Error(stableFailure);
  }
}

export function assertDevelopmentArtifactIdentities(artifacts) {
  for (const graph of PR6R_BUILD_GRAPHS) {
    const artifact = artifacts[graph];
    if (typeof artifact !== "string") {
      throw new Error(`The PR6R ${graph} artifact is missing.`);
    }
    if (!artifact.includes(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER)) {
      throw new Error(
        `The PR6R ${graph} artifact is missing the development marker.`,
      );
    }
    const expectedIdentity =
      PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES[graph];
    if (exactOccurrenceCount(artifact, expectedIdentity) !== 1) {
      throw new Error(
        `The PR6R ${graph} artifact does not have its one exact flavor identity.`,
      );
    }
    for (const otherGraph of PR6R_BUILD_GRAPHS) {
      if (otherGraph === graph) continue;
      if (
        artifact.includes(
          PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES[otherGraph],
        )
      ) {
        throw new Error(
          `The PR6R ${graph} artifact contains the ${otherGraph} flavor identity.`,
        );
      }
    }
  }
}

export function assertPr6rDevelopmentBundleSignatures(bundledText) {
  for (const signature of PR6R_DEVELOPMENT_FORBIDDEN_BUNDLE_SIGNATURES) {
    if (bundledText.includes(signature)) {
      throw new Error(
        `The PR6R development build contains a forbidden normal-runtime signature: ${signature}`,
      );
    }
  }
}

function textWithoutDevelopmentIdentities(bundledText) {
  let sanitized = bundledText;
  for (const identity of Object.values(
    PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES,
  )) {
    sanitized = sanitized.replaceAll(identity, "");
  }
  return sanitized.replaceAll(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER, "");
}

export async function verifyNormalPr6rBuild(outputRoot = defaultOutputRoot) {
  const bundledText = await boundedOutputArtifactText(outputRoot);
  assertRendererBundleLocked(bundledText);
  for (const graph of PR6R_BUILD_GRAPHS) {
    const proofPath = path.join(
      outputRoot,
      graph,
      PR6R_DEVELOPMENT_GRAPH_PROOF_FILE,
    );
    try {
      await readFile(proofPath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(
      `Normal build retained a PR6R development ${graph} graph proof.`,
    );
  }
}

export async function verifyPr6rDevelopmentBuild(
  outputRoot = defaultOutputRoot,
) {
  const bundledText = await boundedOutputArtifactText(outputRoot);
  const artifacts = {};
  for (const graph of PR6R_BUILD_GRAPHS) {
    artifacts[graph] = await readRequiredText(
      path.join(outputRoot, artifactRelativePaths[graph]),
      `The PR6R ${graph} exact artifact is missing or unreadable.`,
    );
    const proof = await readRequiredText(
      path.join(
        outputRoot,
        graph,
        PR6R_DEVELOPMENT_GRAPH_PROOF_FILE,
      ),
      `The PR6R ${graph} module-graph proof is missing or unreadable.`,
    );
    if (proof !== canonicalPr6rDevelopmentGraphProof(graph)) {
      throw new Error(
        `The PR6R ${graph} module-graph proof does not match its exact allowlist.`,
      );
    }
  }
  assertDevelopmentArtifactIdentities(artifacts);

  assertPr6rDevelopmentBundleSignatures(bundledText);
  // Flavor markers must be the only reason the development build fails the
  // normal output policy. This prevents the special proof from hiding an
  // unrelated locked-package regression.
  assertRendererBundleLocked(textWithoutDevelopmentIdentities(bundledText));
}

async function main() {
  const mode = process.argv[2];
  if (!supportedModes.has(mode)) {
    throw new Error(
      "Usage: verify-pr6r-development-build-isolation.mjs <normal|development-canary>",
    );
  }
  if (mode === "normal") {
    await verifyNormalPr6rBuild();
  } else {
    await verifyPr6rDevelopmentBuild();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
