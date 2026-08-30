import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  LanguageVariant,
  SyntaxKind,
  createScanner,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const offlineCliEntrypoint = "scripts/benchmark-heldout-review.ts";
const expectedOfflineGraph = [
  offlineCliEntrypoint,
  "src/benchmark/heldout-review-evaluator.ts",
  "src/benchmark/heldout-review-evaluator-contracts.ts",
  "src/benchmark/heldout-review-statistics.ts",
  "src/benchmark/heldout-review-publication.ts",
  "src/shared/heldout-review-runner-contracts.ts",
  "src/shared/change-review-contracts.ts",
] as const;
const expectedEvaluatorGraph = [
  "src/benchmark/heldout-review-evaluator.ts",
  "src/benchmark/heldout-review-evaluator-contracts.ts",
  "src/benchmark/heldout-review-statistics.ts",
  "src/shared/heldout-review-runner-contracts.ts",
  "src/shared/change-review-contracts.ts",
] as const;
const expectedRunnerGraph = [
  "src/shared/heldout-review-runner-contracts.ts",
  "src/shared/change-review-contracts.ts",
] as const;

const forbiddenRunnerVocabulary = [
  "oracle",
  "gold",
  "rubric",
  "witness",
  "adjudicat",
] as const;
const forbiddenNodeModules = new Set([
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "tls",
  "vm",
  "worker_threads",
]);
const forbiddenNetworkPackages = new Set([
  "axios",
  "cross-fetch",
  "eventsource",
  "got",
  "isomorphic-fetch",
  "ky",
  "node-fetch",
  "request",
  "socket.io-client",
  "superagent",
  "undici",
  "ws",
]);
const allowedOfflineNodeModules = new Set([
  "buffer",
  "crypto",
  "fs",
  "path",
  "process",
]);
const allowedEvaluatorNodeModules = new Set(["buffer", "crypto"]);
const allowedExternalPackages = new Set(["zod"]);
const forbiddenCapabilityIdentifiers = new Set([
  "EventSource",
  "Function",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "createRequire",
  "eval",
  "fetch",
  "sendBeacon",
]);
const forbiddenProcessLoaders = new Set([
  "_linkedBinding",
  "binding",
  "getBuiltinModule",
]);
const allowedDirectProcessMembers = new Set([
  "argv",
  "exitCode",
  "stderr",
  "stdin",
  "stdout",
]);
const forbiddenImportMetaLoaders = new Set(["glob", "globEager", "resolve"]);
const sourceExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
] as const;

type ModuleReferenceKind =
  | "import"
  | "export"
  | "require"
  | "import-equals"
  | "dynamic-import";

interface ModuleReference {
  kind: ModuleReferenceKind;
  specifier: string;
  position: number;
}

interface ScannedToken {
  kind: SyntaxKind;
  value: string;
  position: number;
  nesting: number;
  precedingLineBreak: boolean;
}

interface GraphPolicy {
  allowedNodeModules: ReadonlySet<string>;
  forbidPrivateEvaluatorModules: boolean;
  forbidPrivateVocabulary: boolean;
}

class IsolationScanError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IsolationScanError";
  }
}

function scanFailure(code: string): never {
  throw new IsolationScanError(code);
}

function projectRelative(filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function tokenIsLiteral(token: ScannedToken | undefined): token is ScannedToken {
  return (
    token?.kind === SyntaxKind.StringLiteral ||
    token?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
  );
}

function tokenCannotPrecedeRegexLiteral(kind: SyntaxKind | undefined): boolean {
  return (
    kind === SyntaxKind.Identifier ||
    kind === SyntaxKind.PrivateIdentifier ||
    kind === SyntaxKind.NumericLiteral ||
    kind === SyntaxKind.BigIntLiteral ||
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.RegularExpressionLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === SyntaxKind.TemplateTail ||
    kind === SyntaxKind.TrueKeyword ||
    kind === SyntaxKind.FalseKeyword ||
    kind === SyntaxKind.NullKeyword ||
    kind === SyntaxKind.ThisKeyword ||
    kind === SyntaxKind.SuperKeyword ||
    kind === SyntaxKind.CloseBraceToken ||
    kind === SyntaxKind.CloseBracketToken ||
    kind === SyntaxKind.CloseParenToken ||
    kind === SyntaxKind.PlusPlusToken ||
    kind === SyntaxKind.MinusMinusToken
  );
}

function tokenizeSource(source: string): readonly ScannedToken[] {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens: ScannedToken[] = [];
  const delimiters: Array<{ kind: SyntaxKind; templateExpression: boolean }> = [];
  const expectedOpening = new Map<SyntaxKind, SyntaxKind>([
    [SyntaxKind.CloseBraceToken, SyntaxKind.OpenBraceToken],
    [SyntaxKind.CloseBracketToken, SyntaxKind.OpenBracketToken],
    [SyntaxKind.CloseParenToken, SyntaxKind.OpenParenToken],
  ]);

  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    if (
      kind === SyntaxKind.SlashToken &&
      !tokenCannotPrecedeRegexLiteral(tokens.at(-1)?.kind)
    ) {
      kind = scanner.reScanSlashToken();
    }
    if (
      kind === SyntaxKind.CloseBraceToken &&
      delimiters.at(-1)?.templateExpression === true
    ) {
      delimiters.pop();
      kind = scanner.reScanTemplateToken(false);
    }
    if (kind === SyntaxKind.Unknown || scanner.isUnterminated()) {
      scanFailure("heldout_isolation_unrecognized_or_unterminated_token");
    }
    const expected = expectedOpening.get(kind);
    if (expected !== undefined) {
      if (delimiters.at(-1)?.kind !== expected) {
        scanFailure("heldout_isolation_unbalanced_delimiter");
      }
      delimiters.pop();
    }
    tokens.push({
      kind,
      value: scanner.getTokenValue(),
      position: scanner.getTokenStart(),
      nesting: delimiters.length,
      precedingLineBreak: scanner.hasPrecedingLineBreak(),
    });
    if (
      kind === SyntaxKind.OpenBraceToken ||
      kind === SyntaxKind.OpenBracketToken ||
      kind === SyntaxKind.OpenParenToken
    ) {
      delimiters.push({ kind, templateExpression: false });
    } else if (
      kind === SyntaxKind.TemplateHead ||
      kind === SyntaxKind.TemplateMiddle
    ) {
      delimiters.push({
        kind: SyntaxKind.OpenBraceToken,
        templateExpression: true,
      });
    }
  }
  if (delimiters.length !== 0) {
    scanFailure("heldout_isolation_unbalanced_delimiter");
  }
  return tokens;
}

function requireLiteralCall(
  tokens: readonly ScannedToken[],
  loaderIndex: number,
  errorPrefix: string,
): string {
  const open = tokens[loaderIndex + 1];
  const literal = tokens[loaderIndex + 2];
  const close = tokens[loaderIndex + 3];
  if (
    open?.kind !== SyntaxKind.OpenParenToken ||
    !tokenIsLiteral(literal) ||
    close?.kind !== SyntaxKind.CloseParenToken
  ) {
    scanFailure(`${errorPrefix}_nonliteral_or_ambiguous`);
  }
  return literal.value;
}

function staticImportReference(
  tokens: readonly ScannedToken[],
  importIndex: number,
  handledRequireTokens: Set<number>,
): ModuleReference | undefined {
  const start = tokens[importIndex]!;
  const next = tokens[importIndex + 1];
  if (!next) scanFailure("heldout_isolation_unclassified_import");

  if (next.kind === SyntaxKind.DotToken) {
    const meta = tokens[importIndex + 2];
    if (meta?.value !== "meta") {
      scanFailure("heldout_isolation_unclassified_import_meta");
    }
    const property = tokens[importIndex + 4];
    if (
      tokens[importIndex + 3]?.kind === SyntaxKind.DotToken &&
      property &&
      forbiddenImportMetaLoaders.has(property.value)
    ) {
      scanFailure("heldout_isolation_import_meta_loader");
    }
    if (
      tokens[importIndex + 3]?.kind === SyntaxKind.OpenBracketToken &&
      tokenIsLiteral(property) &&
      forbiddenImportMetaLoaders.has(property.value)
    ) {
      scanFailure("heldout_isolation_import_meta_loader");
    }
    return undefined;
  }

  if (next.kind === SyntaxKind.OpenParenToken) {
    return {
      kind: "dynamic-import",
      specifier: requireLiteralCall(
        tokens,
        importIndex,
        "heldout_isolation_dynamic_import",
      ),
      position: start.position,
    };
  }

  if (tokenIsLiteral(next)) {
    return { kind: "import", specifier: next.value, position: start.position };
  }

  for (let index = importIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.nesting !== start.nesting) continue;
    if (token.kind === SyntaxKind.FromKeyword) {
      const literal = tokens[index + 1];
      if (!tokenIsLiteral(literal)) {
        scanFailure("heldout_isolation_static_import_nonliteral");
      }
      return {
        kind: "import",
        specifier: literal.value,
        position: start.position,
      };
    }
    if (token.kind === SyntaxKind.EqualsToken) {
      const requireToken = tokens[index + 1];
      if (requireToken?.kind !== SyntaxKind.RequireKeyword) {
        scanFailure("heldout_isolation_import_equals_nonrequire");
      }
      const specifier = requireLiteralCall(
        tokens,
        index + 1,
        "heldout_isolation_import_equals",
      );
      handledRequireTokens.add(index + 1);
      return {
        kind: "import-equals",
        specifier,
        position: start.position,
      };
    }
    if (
      token.kind === SyntaxKind.SemicolonToken ||
      (token.precedingLineBreak &&
        (token.kind === SyntaxKind.ImportKeyword ||
          token.kind === SyntaxKind.ExportKeyword ||
          token.kind === SyntaxKind.ConstKeyword ||
          token.kind === SyntaxKind.LetKeyword ||
          token.kind === SyntaxKind.VarKeyword ||
          token.kind === SyntaxKind.FunctionKeyword ||
          token.kind === SyntaxKind.ClassKeyword))
    ) {
      break;
    }
  }
  scanFailure("heldout_isolation_unclassified_import");
}

function staticExportReference(
  tokens: readonly ScannedToken[],
  exportIndex: number,
): ModuleReference | undefined {
  const start = tokens[exportIndex]!;
  let firstIndex = exportIndex + 1;
  if (tokens[firstIndex]?.kind === SyntaxKind.TypeKeyword) firstIndex += 1;
  const first = tokens[firstIndex];
  if (!first) return undefined;
  if (
    first.kind !== SyntaxKind.OpenBraceToken &&
    first.kind !== SyntaxKind.AsteriskToken
  ) {
    return undefined;
  }

  for (let index = firstIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.nesting !== start.nesting) continue;
    if (token.kind === SyntaxKind.FromKeyword) {
      const literal = tokens[index + 1];
      if (!tokenIsLiteral(literal)) {
        scanFailure("heldout_isolation_static_export_nonliteral");
      }
      return {
        kind: "export",
        specifier: literal.value,
        position: start.position,
      };
    }
    if (
      token.kind === SyntaxKind.SemicolonToken ||
      (token.precedingLineBreak &&
        (token.kind === SyntaxKind.ImportKeyword ||
          token.kind === SyntaxKind.ExportKeyword))
    ) {
      break;
    }
  }
  if (first.kind === SyntaxKind.AsteriskToken) {
    scanFailure("heldout_isolation_unclassified_export_star");
  }
  return undefined;
}

function assertNoDirectCapabilities(tokens: readonly ScannedToken[]): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      forbiddenCapabilityIdentifiers.has(token.value) &&
      (token.kind !== SyntaxKind.StringLiteral ||
        (tokens[index - 1]?.kind === SyntaxKind.OpenBracketToken &&
          tokens[index + 1]?.kind === SyntaxKind.CloseBracketToken))
    ) {
      scanFailure("heldout_isolation_direct_network_or_code_capability");
    }
    if (
      token.kind === SyntaxKind.StringLiteral &&
      tokens[index - 1]?.kind === SyntaxKind.OpenBracketToken &&
      tokens[index + 1]?.kind === SyntaxKind.CloseBracketToken &&
      (token.value === "require" ||
        forbiddenProcessLoaders.has(token.value))
    ) {
      scanFailure("heldout_isolation_computed_module_loader");
    }
    if (
      (token.value === "Deno" || token.value === "Bun") &&
      tokens[index + 1]?.kind === SyntaxKind.DotToken
    ) {
      scanFailure("heldout_isolation_direct_runtime_capability");
    }
    if (token.value === "process") {
      const accessor = tokens[index + 1];
      if (
        accessor?.kind === SyntaxKind.OpenBracketToken ||
        (accessor?.kind === SyntaxKind.QuestionDotToken &&
          tokens[index + 2]?.kind === SyntaxKind.OpenBracketToken)
      ) {
        scanFailure("heldout_isolation_computed_process_member");
      }
      if (
        accessor?.kind === SyntaxKind.DotToken ||
        accessor?.kind === SyntaxKind.QuestionDotToken
      ) {
        const member = tokens[index + 2]?.value ?? "";
        if (forbiddenProcessLoaders.has(member)) {
          scanFailure("heldout_isolation_process_module_loader");
        }
        if (!allowedDirectProcessMembers.has(member)) {
          scanFailure("heldout_isolation_unapproved_process_member");
        }
      }
    }
    if (
      token.kind !== SyntaxKind.StringLiteral &&
      token.kind !== SyntaxKind.NoSubstitutionTemplateLiteral &&
      token.kind !== SyntaxKind.RegularExpressionLiteral &&
      forbiddenProcessLoaders.has(token.value)
    ) {
      scanFailure("heldout_isolation_process_loader_identifier");
    }
  }
}

function parseModuleReferences(source: string): readonly ModuleReference[] {
  const tokens = tokenizeSource(source);
  assertNoDirectCapabilities(tokens);
  const references: ModuleReference[] = [];
  const handledRequireTokens = new Set<number>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === SyntaxKind.ImportKeyword) {
      const reference = staticImportReference(
        tokens,
        index,
        handledRequireTokens,
      );
      if (reference) references.push(reference);
      continue;
    }
    if (token.kind === SyntaxKind.ExportKeyword) {
      const reference = staticExportReference(tokens, index);
      if (reference) references.push(reference);
      continue;
    }
    if (
      token.kind !== SyntaxKind.RequireKeyword ||
      handledRequireTokens.has(index)
    ) {
      continue;
    }
    if (
      tokens[index - 1]?.kind === SyntaxKind.DotToken ||
      tokens[index - 1]?.kind === SyntaxKind.QuestionDotToken ||
      tokens[index + 1]?.kind === SyntaxKind.DotToken
    ) {
      scanFailure("heldout_isolation_indirect_require_loader");
    }
    references.push({
      kind: "require",
      specifier: requireLiteralCall(
        tokens,
        index,
        "heldout_isolation_require",
      ),
      position: token.position,
    });
  }
  return references;
}

function resolveLocalImport(importer: string, specifier: string): string {
  const unresolved = path.resolve(path.dirname(importer), specifier);
  const explicitExtension = path.extname(unresolved);
  const extensionlessBase = [".js", ".mjs", ".cjs"].includes(
    explicitExtension,
  )
    ? unresolved.slice(0, -explicitExtension.length)
    : unresolved;
  const candidates = [
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...(extensionlessBase === unresolved
      ? []
      : [".ts", ".tsx", ".mts", ".cts"].map(
          (extension) => `${extensionlessBase}${extension}`,
        )),
    ...sourceExtensions
      .filter((extension) => extension.length > 0)
      .map((extension) => path.join(unresolved, `index${extension}`)),
  ];
  const resolved = candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!resolved) scanFailure("heldout_isolation_unresolved_local_import");
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    scanFailure("heldout_isolation_local_import_escaped_project");
  }
  return resolved;
}

function packageRoot(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? "");
}

function assertStaticReference(reference: ModuleReference): void {
  if (reference.kind === "dynamic-import") {
    scanFailure("heldout_isolation_dynamic_module_load");
  }
}

function allowedLocalDependency(
  importer: string,
  reference: ModuleReference,
  policy: GraphPolicy,
): string | undefined {
  assertStaticReference(reference);
  const specifier = reference.specifier;
  const normalized = specifier.normalize("NFKC").toLowerCase();

  if (specifier.startsWith(".")) {
    const resolved = resolveLocalImport(importer, specifier);
    const relative = projectRelative(resolved);
    const normalizedRelative = relative.toLowerCase();
    if (relative === "src/main" || relative.startsWith("src/main/")) {
      scanFailure("heldout_isolation_main_dependency");
    }
    if (
      /(?:^|[/_.-])(?:openai|provider|providers|network)(?:$|[/_.-])/u.test(
        normalizedRelative,
      ) ||
      /(?:^|[/_.-])runtime(?:$|[/_.-])/u.test(normalizedRelative) ||
      normalizedRelative.includes("runtime-catalog")
    ) {
      scanFailure("heldout_isolation_provider_or_runtime_dependency");
    }
    if (
      policy.forbidPrivateEvaluatorModules &&
      /(?:evaluator|oracle|gold|witness|adjudicat)/u.test(normalizedRelative)
    ) {
      scanFailure("heldout_isolation_private_evaluator_dependency");
    }
    return resolved;
  }

  if (
    path.isAbsolute(specifier) ||
    normalized.startsWith("file:") ||
    normalized.startsWith("data:")
  ) {
    scanFailure("heldout_isolation_absolute_or_url_import");
  }
  if (normalized.startsWith("node:")) {
    const nodeModule = normalized.slice(5).split("/")[0] ?? "";
    if (forbiddenNodeModules.has(nodeModule)) {
      scanFailure("heldout_isolation_forbidden_node_module");
    }
    if (!policy.allowedNodeModules.has(nodeModule)) {
      scanFailure("heldout_isolation_unapproved_node_module");
    }
    return undefined;
  }

  const externalRoot = packageRoot(normalized);
  if (
    forbiddenNodeModules.has(externalRoot) ||
    forbiddenNetworkPackages.has(externalRoot)
  ) {
    scanFailure("heldout_isolation_forbidden_external_module");
  }
  if (!allowedExternalPackages.has(externalRoot)) {
    scanFailure("heldout_isolation_unapproved_external_module");
  }
  return undefined;
}

function inspectGraph(
  entrypoints: readonly string[],
  policy: GraphPolicy,
): Set<string> {
  const pending = entrypoints.map((entrypoint) =>
    path.join(projectRoot, entrypoint),
  );
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (!existsSync(current)) {
      scanFailure("heldout_isolation_missing_entrypoint");
    }
    visited.add(current);
    const source = readFileSync(current, "utf8");
    if (policy.forbidPrivateVocabulary) {
      const normalizedSource = source.normalize("NFKC").toLowerCase();
      for (const vocabulary of forbiddenRunnerVocabulary) {
        if (normalizedSource.includes(vocabulary)) {
          scanFailure("heldout_isolation_runner_private_vocabulary");
        }
      }
    }

    for (const reference of parseModuleReferences(source)) {
      const localDependency = allowedLocalDependency(
        current,
        reference,
        policy,
      );
      if (localDependency && !visited.has(localDependency)) {
        pending.push(localDependency);
      }
    }
  }
  return visited;
}

function relativeGraph(visited: ReadonlySet<string>): readonly string[] {
  return [...visited].map(projectRelative).sort();
}

const offlinePolicy: GraphPolicy = {
  allowedNodeModules: allowedOfflineNodeModules,
  forbidPrivateEvaluatorModules: false,
  forbidPrivateVocabulary: false,
};

const runnerPolicy: GraphPolicy = {
  allowedNodeModules: new Set(),
  forbidPrivateEvaluatorModules: true,
  forbidPrivateVocabulary: true,
};

const evaluatorPolicy: GraphPolicy = {
  allowedNodeModules: allowedEvaluatorNodeModules,
  forbidPrivateEvaluatorModules: false,
  forbidPrivateVocabulary: false,
};

describe("held-out static module scanner", () => {
  it("discovers static imports, re-exports, and literal requires while ignoring comments and strings", () => {
    const references = parseModuleReferences(`
      import "./side-effect";
      import value from "./default";
      import type { Shape } from "./types";
      export * from "./star";
      export { named } from "./named";
      export type { Exported } from "./exported-types";
      import assigned = require("./assigned");
      const common = require(\`./common\`);
      const ignored = "import('./string-only') require('./string-require')";
      const ignoredPattern = /import\\("ignored"\\)|require\\("ignored"\\)/u;
      // import "./comment-only"; require("./comment-require");
    `);
    expect(references.map(({ kind, specifier }) => ({ kind, specifier }))).toEqual([
      { kind: "import", specifier: "./side-effect" },
      { kind: "import", specifier: "./default" },
      { kind: "import", specifier: "./types" },
      { kind: "export", specifier: "./star" },
      { kind: "export", specifier: "./named" },
      { kind: "export", specifier: "./exported-types" },
      { kind: "import-equals", specifier: "./assigned" },
      { kind: "require", specifier: "./common" },
    ]);
  });

  it("fails closed on nonliteral or dynamic loaders and direct network/code capabilities", () => {
    expect(() => parseModuleReferences("require(candidate)")).toThrow(
      /heldout_isolation_require_nonliteral_or_ambiguous/u,
    );
    expect(() => parseModuleReferences("import(candidate)")).toThrow(
      /heldout_isolation_dynamic_import_nonliteral_or_ambiguous/u,
    );
    const dynamic = parseModuleReferences('import("./literal-but-dynamic")');
    expect(dynamic).toMatchObject([
      { kind: "dynamic-import", specifier: "./literal-but-dynamic" },
    ]);
    expect(() => assertStaticReference(dynamic[0]!)).toThrow(
      /heldout_isolation_dynamic_module_load/u,
    );
    expect(() => parseModuleReferences('module.require("./hidden")')).toThrow(
      /heldout_isolation_indirect_require_loader/u,
    );
    expect(() => parseModuleReferences('module["require"]("./hidden")')).toThrow(
      /heldout_isolation_computed_module_loader/u,
    );
    expect(() => parseModuleReferences('import.meta.resolve("./hidden")')).toThrow(
      /heldout_isolation_import_meta_loader/u,
    );
    expect(() =>
      parseModuleReferences('process.getBuiltinModule("node:http")'),
    ).toThrow(/heldout_isolation_process_module_loader/u);
    expect(() => parseModuleReferences('fetch("https://example.invalid")')).toThrow(
      /heldout_isolation_direct_network_or_code_capability/u,
    );
    expect(() =>
      parseModuleReferences('globalThis["fetch"]("https://example.invalid")'),
    ).toThrow(/heldout_isolation_direct_network_or_code_capability/u);
    expect(() => parseModuleReferences("function broken( {")).toThrow(
      /heldout_isolation_unbalanced_delimiter/u,
    );
  });

  it("rejects aliased and computed process loaders while preserving approved direct process members", () => {
    expect(() =>
      parseModuleReferences(
        'const { getBuiltinModule: load } = process; load("node:http")',
      ),
    ).toThrow(/heldout_isolation_process_loader_identifier/u);
    expect(() =>
      parseModuleReferences(
        'process["get" + "BuiltinModule"]("node:http")',
      ),
    ).toThrow(/heldout_isolation_computed_process_member/u);
    expect(() =>
      parseModuleReferences(
        "process.argv; process.stdin; process.stdout; process.stderr; process.exitCode",
      ),
    ).not.toThrow();
  });

  it.each([
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
    "node:dns",
    "node:dgram",
    "node:http2",
    "node:child_process",
    "node:cluster",
    "node:worker_threads",
    "node:module",
    "node:vm",
    "undici",
    "axios",
    "ws",
    "got",
  ])("rejects deny-listed dependency %s", (specifier) => {
    const importer = path.join(projectRoot, offlineCliEntrypoint);
    expect(() =>
      allowedLocalDependency(
        importer,
        { kind: "import", specifier, position: 0 },
        offlinePolicy,
      ),
    ).toThrow(/heldout_isolation_forbidden_/u);
  });
});

describe("held-out review privacy and recursive import isolation", () => {
  it("proves the runner graph has exactly its known shared dependency and no private vocabulary or modules", () => {
    const visited = inspectGraph(
      ["src/shared/heldout-review-runner-contracts.ts"],
      runnerPolicy,
    );
    expect(relativeGraph(visited)).toEqual([...expectedRunnerGraph].sort());
  });

  it("recursively discovers the exact production CLI graph under the strict safe-module allowlist", () => {
    const cliReferences = parseModuleReferences(
      readFileSync(path.join(projectRoot, offlineCliEntrypoint), "utf8"),
    );
    expect(cliReferences.map((reference) => reference.specifier)).toEqual(
      expect.arrayContaining([
        "node:crypto",
        "node:fs",
        "node:fs/promises",
        "node:path",
        "node:process",
        "zod",
        "../src/benchmark/heldout-review-evaluator.ts",
        "../src/benchmark/heldout-review-publication.ts",
      ]),
    );

    const visited = inspectGraph([offlineCliEntrypoint], offlinePolicy);
    expect(relativeGraph(visited)).toEqual([...expectedOfflineGraph].sort());
  });

  it("keeps the pure evaluator subtree free of filesystem and process dependencies", () => {
    const visited = inspectGraph(
      ["src/benchmark/heldout-review-evaluator.ts"],
      evaluatorPolicy,
    );
    expect(relativeGraph(visited)).toEqual([...expectedEvaluatorGraph].sort());
  });
});
