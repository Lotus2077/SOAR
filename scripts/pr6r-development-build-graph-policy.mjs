import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";

export const PR6R_BUILD_GRAPHS = Object.freeze([
  "main",
  "preload",
  "renderer",
]);

export const PR6R_DEVELOPMENT_SOURCE_ALLOWLIST = Object.freeze({
  main: Object.freeze([
    "src/main/index.pr6r-development-canary.ts",
    "src/main/pr6r-development/bootstrap.ts",
    "src/main/pr6r-development/navigation-policy.ts",
    "src/main/pr6r-development/runtime-authority.ts",
    "src/shared/pr6r-development-identity.ts",
  ]),
  preload: Object.freeze([
    "src/preload/index.pr6r-development-canary.ts",
  ]),
  renderer: Object.freeze([
    "src/renderer/pr6r-development-canary/index.html",
  ]),
});

export const PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST = Object.freeze({
  main: Object.freeze(["electron", "node:path", "node:url"]),
  preload: Object.freeze(["electron"]),
  renderer: Object.freeze([]),
});

export const PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST = Object.freeze({
  main: Object.freeze({
    electron: Object.freeze(["BrowserWindow", "app"]),
    "node:path": Object.freeze(["default"]),
    "node:url": Object.freeze(["pathToFileURL"]),
  }),
  preload: Object.freeze({
    electron: Object.freeze(["contextBridge"]),
  }),
  renderer: Object.freeze({}),
});

export const PR6R_DEVELOPMENT_GRAPH_PROOF_FILE =
  "pr6r-development-module-graph.json";

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);

const forbiddenNormalSourcePatterns = Object.freeze([
  /^src\/main\/index\.pr6r-development-canary\.ts$/u,
  /^src\/main\/pr6r-development(?:\/|$)/u,
  /^src\/preload\/index\.pr6r-development-canary\.ts$/u,
  /^src\/renderer\/pr6r-development-canary(?:\/|$)/u,
  /^src\/shared\/pr6r-development(?:[-/]|$)/u,
]);

function requireGraph(graph) {
  if (!PR6R_BUILD_GRAPHS.includes(graph)) {
    throw new Error("PR6R build graph identity is invalid.");
  }
}

function canonicalSourceModules(sourceModules) {
  return [...new Set(sourceModules)].sort();
}

function graphSha256(sourceModules) {
  return createHash("sha256")
    .update(JSON.stringify(sourceModules))
    .digest("hex");
}

function canonicalExternalBindings(bindings) {
  return Object.fromEntries(
    Object.entries(bindings)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([specifier, names]) => [specifier, canonicalSourceModules(names)]),
  );
}

function normalizedProjectModule(moduleId) {
  if (moduleId.startsWith("\0")) return undefined;
  const withoutVitePrefix = moduleId.replace(/^\/@fs\//u, "/");
  const withoutQueryOrFragment = withoutVitePrefix.split(/[?#]/u, 1)[0];
  if (!path.isAbsolute(withoutQueryOrFragment)) return undefined;
  const relative = path
    .relative(projectRoot, withoutQueryOrFragment)
    .replaceAll(path.sep, "/");
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative;
}

function projectModulesFromModuleIds(moduleIds) {
  const sourceModules = [];
  for (const moduleId of moduleIds) {
    const source = normalizedProjectModule(moduleId);
    if (source !== undefined) sourceModules.push(source);
  }
  return canonicalSourceModules(sourceModules);
}

function isRelativeOrAbsoluteSpecifier(specifier) {
  return (
    specifier.startsWith("\0") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    path.isAbsolute(specifier)
  );
}

function assertAllowedDevelopmentExternal(graph, specifier) {
  if (!PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST[graph].includes(specifier)) {
    throw new Error(
      `PR6R ${graph} graph imported an external module outside its exact allowlist: ${specifier}`,
    );
  }
}

function assertDevelopmentLocalModule(graph, moduleId) {
  if (moduleId.startsWith("\0")) return;
  const withoutVitePrefix = moduleId.replace(/^\/@fs\//u, "/");
  const withoutQueryOrFragment = withoutVitePrefix.split(/[?#]/u, 1)[0];
  if (!path.isAbsolute(withoutQueryOrFragment)) return;
  const source = normalizedProjectModule(moduleId);
  if (source === undefined) {
    throw new Error(
      `PR6R ${graph} graph imported a local module outside the project root.`,
    );
  }
  if (!PR6R_DEVELOPMENT_SOURCE_ALLOWLIST[graph].includes(source)) {
    throw new Error(
      `PR6R ${graph} graph imported source outside its exact allowlist: ${source}`,
    );
  }
}

const forbiddenRuntimeIdentifiers = new Set([
  "require",
  "createRequire",
  "getBuiltinModule",
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "EventSource",
  "importScripts",
]);
const forbiddenProcessMembers = new Set([
  "binding",
  "_linkedBinding",
  "dlopen",
]);
const transparentRuntimeExpressionTypes = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSInstantiationExpression",
]);

function unwrapRuntimeExpression(node) {
  let current = node;
  while (
    current !== null &&
    typeof current === "object" &&
    transparentRuntimeExpressionTypes.has(current.type)
  ) {
    current = current.expression;
  }
  return current;
}

function staticMemberName(node) {
  const runtimeNode = unwrapRuntimeExpression(node);
  if (runtimeNode?.type === "Identifier") return runtimeNode.name;
  if (runtimeNode?.type === "StringLiteral") return runtimeNode.value;
  if (
    runtimeNode?.type === "TemplateLiteral" &&
    runtimeNode.expressions.length === 0 &&
    runtimeNode.quasis.length === 1
  ) {
    return (
      runtimeNode.quasis[0]?.value.cooked ??
      runtimeNode.quasis[0]?.value.raw
    );
  }
  return undefined;
}

function isDirectProcessReference(node) {
  const runtimeNode = unwrapRuntimeExpression(node);
  if (runtimeNode?.type === "Identifier") {
    return runtimeNode.name === "process";
  }
  if (
    runtimeNode?.type !== "MemberExpression" &&
    runtimeNode?.type !== "OptionalMemberExpression"
  ) {
    return false;
  }
  const base = unwrapRuntimeExpression(runtimeNode.object);
  return (
    base?.type === "Identifier" &&
    ["global", "globalThis", "self", "window"].includes(base.name) &&
    staticMemberName(runtimeNode.property) === "process"
  );
}

function forbiddenRuntimeAstNode(node) {
  if (
    node.type === "Identifier" &&
    forbiddenRuntimeIdentifiers.has(node.name)
  ) {
    return true;
  }
  if (
    (node.type === "MemberExpression" ||
      node.type === "OptionalMemberExpression")
  ) {
    const runtimeObject = unwrapRuntimeExpression(node.object);
    const propertyName = staticMemberName(node.property);
    if (
      node.computed &&
      forbiddenRuntimeIdentifiers.has(propertyName)
    ) {
      return true;
    }
    if (
      isDirectProcessReference(runtimeObject) &&
      forbiddenProcessMembers.has(propertyName)
    ) {
      return true;
    }
  }
  return false;
}

function containsForbiddenRuntimeAstNode(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenRuntimeAstNode(entry));
  }
  if (typeof value !== "object" || value === null) return false;
  if (forbiddenRuntimeAstNode(value)) return true;
  return Object.entries(value).some(([key, child]) => {
    if (["loc", "start", "end", "extra", "comments"].includes(key)) {
      return false;
    }
    return containsForbiddenRuntimeAstNode(child);
  });
}

function assertStaticallyAnalyzableDevelopmentSource(graph, code) {
  let syntaxTree;
  try {
    syntaxTree = parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "importAttributes"],
    });
  } catch {
    throw new Error(
      `PR6R ${graph} graph contains source the static build policy cannot parse.`,
    );
  }
  if (containsForbiddenRuntimeAstNode(syntaxTree)) {
    throw new Error(
      `PR6R ${graph} graph contains dynamic runtime syntax forbidden by its static build policy.`,
    );
  }
}

export function assertNormalPr6rModuleGraph({ graph, sourceModules }) {
  requireGraph(graph);
  for (const source of canonicalSourceModules(sourceModules)) {
    if (forbiddenNormalSourcePatterns.some((pattern) => pattern.test(source))) {
      throw new Error(
        `Normal ${graph} graph imported forbidden PR6R development source: ${source}`,
      );
    }
  }
}

export function assertPr6rDevelopmentModuleGraph({ graph, sourceModules }) {
  requireGraph(graph);
  const actual = canonicalSourceModules(sourceModules);
  const expected = PR6R_DEVELOPMENT_SOURCE_ALLOWLIST[graph];
  if (
    actual.length !== expected.length ||
    actual.some((source, index) => source !== expected[index])
  ) {
    const unexpected = actual.filter((source) => !expected.includes(source));
    const missing = expected.filter((source) => !actual.includes(source));
    throw new Error(
      `PR6R ${graph} source graph does not match its exact allowlist` +
        ` (unexpected=${unexpected.join(",") || "none"};` +
        ` missing=${missing.join(",") || "none"}).`,
    );
  }
}

export function assertPr6rDevelopmentExternalGraph({
  graph,
  externalModules,
}) {
  requireGraph(graph);
  const actual = canonicalSourceModules(externalModules);
  const expected = PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST[graph];
  if (
    actual.length !== expected.length ||
    actual.some((source, index) => source !== expected[index])
  ) {
    const unexpected = actual.filter((source) => !expected.includes(source));
    const missing = expected.filter((source) => !actual.includes(source));
    throw new Error(
      `PR6R ${graph} external graph does not match its exact allowlist` +
        ` (unexpected=${unexpected.join(",") || "none"};` +
        ` missing=${missing.join(",") || "none"}).`,
    );
  }
}

export function assertPr6rDevelopmentExternalBindings({ graph, bindings }) {
  requireGraph(graph);
  const actual = canonicalExternalBindings(bindings);
  const expected = canonicalExternalBindings(
    PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST[graph],
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `PR6R ${graph} external bindings do not match their exact allowlist.`,
    );
  }
}

export function canonicalPr6rDevelopmentGraphProof(graph) {
  requireGraph(graph);
  const sourceModules = PR6R_DEVELOPMENT_SOURCE_ALLOWLIST[graph];
  const externalModules = PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST[graph];
  const externalBindings = canonicalExternalBindings(
    PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST[graph],
  );
  return `${JSON.stringify({
    schemaVersion: "soar-pr6r-development-module-graph-v5",
    buildFlavor: "pr6r-development-canary",
    graph,
    sourceModules,
    sourceModulesSha256: graphSha256(sourceModules),
    externalModules,
    externalModulesSha256: graphSha256(externalModules),
    externalBindings,
    externalBindingsSha256: graphSha256(externalBindings),
  })}\n`;
}

function observedProjectSources(pluginContext, htmlSource) {
  const sourceModules = projectModulesFromModuleIds(pluginContext.getModuleIds());
  if (htmlSource !== undefined) sourceModules.push(htmlSource);
  return canonicalSourceModules(sourceModules);
}

function assertSafeEmittedFileName(fileName) {
  const normalized = path.posix.normalize(fileName);
  if (
    fileName.length === 0 ||
    fileName.includes("\\") ||
    fileName.startsWith("\0") ||
    path.posix.isAbsolute(fileName) ||
    /^[A-Za-z]:\//u.test(fileName) ||
    normalized !== fileName ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("PR6R output graph contains an unsafe emitted file name.");
  }
}

function outputImportTarget(bundle, importerFileName, specifier) {
  if (specifier.includes("\\") || specifier.startsWith("\0")) {
    throw new Error("PR6R output graph contains an unsupported import specifier.");
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(importerFileName), specifier),
    );
    if (
      target === "" ||
      target === ".." ||
      target.startsWith("../") ||
      path.posix.isAbsolute(target) ||
      !Object.hasOwn(bundle, target)
    ) {
      throw new Error(
        `PR6R output graph retained a local import outside its emitted bundle: ${specifier}`,
      );
    }
    return target;
  }
  if (path.posix.isAbsolute(specifier) || /^[A-Za-z]:\//u.test(specifier)) {
    throw new Error(
      `PR6R output graph retained an absolute local import: ${specifier}`,
    );
  }
  if (Object.hasOwn(bundle, specifier)) return specifier;
  return undefined;
}

function outputExternalGraph(bundle) {
  const externalModules = new Set();
  const externalBindings = new Map();
  for (const [importerFileName, artifact] of Object.entries(bundle)) {
    assertSafeEmittedFileName(importerFileName);
    if (artifact.type !== "chunk") continue;
    for (const specifier of artifact.imports) {
      const target = outputImportTarget(bundle, importerFileName, specifier);
      if (target === undefined) {
        externalModules.add(specifier);
        continue;
      }
      if (bundle[target]?.type !== "chunk") {
        throw new Error(
          `PR6R output graph import does not target an emitted chunk: ${specifier}`,
        );
      }
    }
    for (const specifier of artifact.dynamicImports) {
      const target = outputImportTarget(bundle, importerFileName, specifier);
      if (target === undefined) {
        throw new Error(
          `PR6R output graph retained a dynamically imported external: ${specifier}`,
        );
      }
      if (bundle[target]?.type !== "chunk") {
        throw new Error(
          `PR6R output graph import does not target an emitted chunk: ${specifier}`,
        );
      }
    }
    for (const [specifier, names] of Object.entries(
      artifact.importedBindings ?? {},
    )) {
      if (outputImportTarget(bundle, importerFileName, specifier) !== undefined) {
        continue;
      }
      const observedNames = externalBindings.get(specifier) ?? new Set();
      for (const name of names) observedNames.add(name);
      externalBindings.set(specifier, observedNames);
    }
  }
  return {
    externalModules: [...externalModules],
    externalBindings: Object.fromEntries(
      [...externalBindings].map(([specifier, names]) => [
        specifier,
        [...names],
      ]),
    ),
  };
}

export function pr6rNormalModuleGraphGuard(graph) {
  requireGraph(graph);
  return {
    name: `soar-pr6r-normal-${graph}-graph-guard`,
    transform(_code, moduleId) {
      const source = normalizedProjectModule(moduleId);
      if (source !== undefined) {
        assertNormalPr6rModuleGraph({ graph, sourceModules: [source] });
      }
      return null;
    },
    generateBundle(_outputOptions, bundle) {
      assertNormalPr6rModuleGraph({
        graph,
        sourceModules: observedProjectSources(this),
      });
      outputExternalGraph(bundle);
    },
  };
}

export function pr6rDevelopmentModuleGraphGuard(graph, options) {
  requireGraph(graph);
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.artifactIdentity !== "string" ||
    options.artifactIdentity.length === 0
  ) {
    throw new Error("PR6R development artifact identity is invalid.");
  }
  let rendererHtmlSource;
  const observedExternalModules = new Set();
  return {
    name: `soar-pr6r-development-${graph}-graph-guard`,
    resolveId(source) {
      if (isRelativeOrAbsoluteSpecifier(source)) return null;
      assertAllowedDevelopmentExternal(graph, source);
      observedExternalModules.add(source);
      return null;
    },
    resolveDynamicImport(specifier) {
      if (typeof specifier !== "string") {
        throw new Error(
          `PR6R ${graph} graph contains a computed dynamic import.`,
        );
      }
      if (isRelativeOrAbsoluteSpecifier(specifier)) return null;
      throw new Error(
        `PR6R ${graph} graph cannot dynamically import an external module.`,
      );
    },
    transform(code, moduleId) {
      assertDevelopmentLocalModule(graph, moduleId);
      const source = normalizedProjectModule(moduleId);
      if (source?.endsWith(".html")) return null;
      assertStaticallyAnalyzableDevelopmentSource(graph, code);
      return null;
    },
    transformIndexHtml(html, context) {
      const source = normalizedProjectModule(context.filename);
      if (source !== undefined) {
        if (!PR6R_DEVELOPMENT_SOURCE_ALLOWLIST[graph].includes(source)) {
          throw new Error(
            `PR6R ${graph} graph imported HTML outside its exact allowlist: ${source}`,
          );
        }
        rendererHtmlSource = source;
      }
      if (graph !== "renderer") return html;
      return `<!-- ${options.artifactIdentity} -->\n${html}`;
    },
    generateBundle(_outputOptions, bundle) {
      const sourceModules = observedProjectSources(this, rendererHtmlSource);
      assertPr6rDevelopmentModuleGraph({ graph, sourceModules });
      const outputGraph = outputExternalGraph(bundle);
      for (const specifier of outputGraph.externalModules) {
        assertAllowedDevelopmentExternal(graph, specifier);
        observedExternalModules.add(specifier);
      }
      assertPr6rDevelopmentExternalGraph({
        graph,
        externalModules: [...observedExternalModules],
      });
      assertPr6rDevelopmentExternalBindings({
        graph,
        bindings: outputGraph.externalBindings,
      });
      if (graph !== "renderer") {
        const expectedEntry = graph === "main" ? "index.js" : "index.cjs";
        const entry = bundle[expectedEntry];
        if (entry?.type !== "chunk" || !entry.isEntry) {
          throw new Error(`PR6R ${graph} exact entry artifact is missing.`);
        }
        entry.code = `/* ${options.artifactIdentity} */\n${entry.code}`;
      }
      this.emitFile({
        type: "asset",
        fileName: PR6R_DEVELOPMENT_GRAPH_PROOF_FILE,
        source: canonicalPr6rDevelopmentGraphProof(graph),
      });
    },
  };
}
