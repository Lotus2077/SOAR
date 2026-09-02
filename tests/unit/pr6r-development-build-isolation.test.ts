import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES,
  PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
  assertRendererBundleLocked,
} from "../../scripts/locked-credential-package-policy.mjs";
import {
  PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST,
  PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST,
  PR6R_DEVELOPMENT_SOURCE_ALLOWLIST,
  assertNormalPr6rModuleGraph,
  assertPr6rDevelopmentExternalGraph,
  assertPr6rDevelopmentExternalBindings,
  assertPr6rDevelopmentModuleGraph,
  canonicalPr6rDevelopmentGraphProof,
  pr6rDevelopmentModuleGraphGuard,
  pr6rNormalModuleGraphGuard,
} from "../../scripts/pr6r-development-build-graph-policy.mjs";
import {
  assertDevelopmentArtifactIdentities,
  assertPr6rDevelopmentBundleSignatures,
  verifyPr6rDevelopmentBuild,
  verifyNormalPr6rBuild,
} from "../../scripts/verify-pr6r-development-build-isolation.mjs";
import { PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER } from "../../src/main/pr6r-development/runtime-authority";

const projectRoot = path.resolve(import.meta.dirname, "../..");

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(candidate)));
    if (entry.isFile()) files.push(candidate);
  }
  return files;
}

describe("PR6R development-canary structural build isolation", () => {
  it("uses a distinct compile-time config and marked main entry", async () => {
    const [
      normalConfig,
      canaryConfig,
      normalEntry,
      canaryEntry,
      canaryBootstrap,
      canaryPreload,
      canaryRenderer,
      runtimeAuthority,
    ] =
      await Promise.all([
        source("electron.vite.config.ts"),
        source("electron.vite.pr6r-development-canary.config.ts"),
        source("src/main/index.ts"),
        source("src/main/index.pr6r-development-canary.ts"),
        source("src/main/pr6r-development/bootstrap.ts"),
        source("src/preload/index.pr6r-development-canary.ts"),
        source("src/renderer/pr6r-development-canary/index.html"),
        source("src/main/pr6r-development/runtime-authority.ts"),
      ]);

    expect(normalConfig).toContain('input: resolve("src/main/index.ts")');
    expect(normalConfig).not.toContain("index.pr6r-development-canary.ts");
    expect(normalConfig).not.toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);
    expect(normalEntry).not.toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);

    expect(canaryConfig).toContain(
      'input: resolve("src/main/index.pr6r-development-canary.ts")',
    );
    expect(canaryConfig).toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);
    expect(canaryConfig).toContain(
      "PR6R_DEVELOPMENT_CANARY_MAIN_IDENTITY",
    );
    expect(canaryConfig).toContain(
      "PR6R_DEVELOPMENT_CANARY_PRELOAD_IDENTITY",
    );
    expect(canaryConfig).toContain(
      "PR6R_DEVELOPMENT_CANARY_RENDERER_IDENTITY",
    );
    expect(canaryConfig).toContain(
      'pr6rDevelopmentModuleGraphGuard("main",',
    );
    expect(canaryConfig).toContain(
      'pr6rDevelopmentModuleGraphGuard("preload",',
    );
    expect(canaryConfig).toContain(
      'pr6rDevelopmentModuleGraphGuard("renderer",',
    );
    expect(canaryConfig).toContain('entryFileNames: "index.js"');
    expect(canaryEntry).toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);
    expect(canaryConfig).toContain(
      'input: resolve("src/preload/index.pr6r-development-canary.ts")',
    );
    expect(canaryConfig).toContain(
      'root: resolve("src/renderer/pr6r-development-canary")',
    );
    expect(canaryConfig).toContain(
      'input: resolve("src/renderer/pr6r-development-canary/index.html")',
    );
    expect(canaryEntry).not.toContain('import "./index"');
    expect(canaryEntry).not.toContain('import "./bootstrap"');
    expect(canaryEntry).toContain("if (app.isPackaged)");
    expect(canaryEntry.indexOf("if (app.isPackaged)")).toBeLessThan(
      canaryEntry.indexOf('import("./pr6r-development/bootstrap")'),
    );
    expect(canaryBootstrap).not.toMatch(
      /from ["'][^"']*(?:config|runtime-catalog|\.\.\/bootstrap)["']/u,
    );
    expect(canaryPreload).not.toContain("ipcRenderer");
    expect(canaryRenderer).not.toMatch(/<script\b/iu);
    expect(canaryRenderer).toContain(
      `content="default-src 'none'; style-src 'unsafe-inline'"`,
    );
    expect(runtimeAuthority).toContain(
      PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
    );
    expect(canaryPreload).toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);
    expect(canaryRenderer).toContain(PR6R_DEVELOPMENT_CANARY_BUILD_MARKER);
    expect(canaryConfig).not.toMatch(/process\.env|import\.meta\.env/u);
    expect(canaryEntry).not.toMatch(/process\.env|import\.meta\.env/u);
  });

  it("keeps normal scripts on the normal config and exposes explicit canary scripts", async () => {
    const manifest = JSON.parse(await source("package.json")) as {
      scripts: Record<string, string>;
    };
    const workflow = await source(".github/workflows/ci.yml");

    expect(manifest.scripts.dev).toBe(
      "pnpm build:native:locked && electron-vite dev",
    );
    expect(manifest.scripts.build).not.toContain(
      "electron.vite.pr6r-development-canary.config.ts",
    );
    expect(manifest.scripts["dev:pr6r-development-canary"]).toContain(
      "--config electron.vite.pr6r-development-canary.config.ts",
    );
    expect(manifest.scripts["build:pr6r-development-canary"]).toContain(
      "--config electron.vite.pr6r-development-canary.config.ts",
    );
    expect(manifest.scripts["build:pr6r-development-canary"]).toContain(
      "verify-pr6r-development-build-isolation.mjs development-canary",
    );
    expect(manifest.scripts["verify:pr6r-development-build-flavors"]).toBe(
      "node scripts/verify-pr6r-development-build-flavors.mjs",
    );
    expect(manifest.scripts.check).toContain(
      "pnpm verify:pr6r-development-build-flavors",
    );
    expect(workflow).toContain("run: pnpm check");
    expect(workflow).toContain(
      "run: pnpm verify:pr6r-development-build-flavors",
    );
  });

  it("structurally rejects every PR6R development source from normal graphs", async () => {
    const allPr6rDevelopmentSources = (await sourceFiles(
      path.join(projectRoot, "src"),
    ))
      .map((file) => path.relative(projectRoot, file).replaceAll(path.sep, "/"))
      .filter((file) => file.includes("pr6r-development"));
    expect(allPr6rDevelopmentSources.length).toBeGreaterThan(8);
    for (const sourceModule of allPr6rDevelopmentSources) {
      expect(() =>
        assertNormalPr6rModuleGraph({
          graph: "main",
          sourceModules: [sourceModule],
        }),
      ).toThrow(/forbidden PR6R development source/iu);
    }

    for (const [graph, sources] of Object.entries(
      PR6R_DEVELOPMENT_SOURCE_ALLOWLIST,
    ) as Array<
      [keyof typeof PR6R_DEVELOPMENT_SOURCE_ALLOWLIST, readonly string[]]
    >) {
      for (const sourceModule of sources) {
        expect(() =>
          assertNormalPr6rModuleGraph({
            graph,
            sourceModules: [sourceModule],
          }),
        ).toThrow(/forbidden PR6R development source/iu);
      }
    }
    expect(() =>
      assertNormalPr6rModuleGraph({
        graph: "main",
        sourceModules: [
          "src/main/index.ts",
          "src/main/providers/runtime-catalog.ts",
        ],
      }),
    ).not.toThrow();
  });

  it("requires exact source allowlists and canonical graph proofs for every special graph", () => {
    for (const [graph, sourceModules] of Object.entries(
      PR6R_DEVELOPMENT_SOURCE_ALLOWLIST,
    ) as Array<
      [keyof typeof PR6R_DEVELOPMENT_SOURCE_ALLOWLIST, readonly string[]]
    >) {
      expect(() =>
        assertPr6rDevelopmentModuleGraph({ graph, sourceModules }),
      ).not.toThrow();
      expect(() =>
        assertPr6rDevelopmentModuleGraph({
          graph,
          sourceModules: [...sourceModules, "src/shared/session-events.ts"],
        }),
      ).toThrow(/unexpected=src\/shared\/session-events\.ts/iu);
      expect(() =>
        assertPr6rDevelopmentModuleGraph({
          graph,
          sourceModules: sourceModules.slice(1),
        }),
      ).toThrow(/missing=/iu);

      const proof = JSON.parse(canonicalPr6rDevelopmentGraphProof(graph)) as {
        schemaVersion: string;
        graph: string;
        sourceModules: string[];
        sourceModulesSha256: string;
        externalModules: string[];
        externalModulesSha256: string;
        externalBindings: Record<string, string[]>;
        externalBindingsSha256: string;
      };
      expect(proof.schemaVersion).toBe(
        "soar-pr6r-development-module-graph-v5",
      );
      expect(proof.graph).toBe(graph);
      expect(proof.sourceModules).toEqual(sourceModules);
      expect(proof.sourceModulesSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(proof.externalModules).toEqual(
        PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST[graph],
      );
      expect(proof.externalModulesSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(proof.externalBindings).toEqual(
        PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST[graph],
      );
      expect(proof.externalBindingsSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("rejects repo-owned modules outside the exact special graph", () => {
    for (const unexpected of [
      "scripts/benchmark.ts",
      "native/macos-credential-lease/index.js",
      "electron.vite.config.ts",
    ]) {
      expect(() =>
        assertPr6rDevelopmentModuleGraph({
          graph: "main",
          sourceModules: [
            ...PR6R_DEVELOPMENT_SOURCE_ALLOWLIST.main,
            unexpected,
          ],
        }),
      ).toThrow(new RegExp(`unexpected=${unexpected.replaceAll("/", "\\/")}`, "u"));
    }
  });

  it("allows only the exact bare externals for each special graph", () => {
    for (const [graph, externalModules] of Object.entries(
      PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST,
    ) as Array<
      [keyof typeof PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST, readonly string[]]
    >) {
      expect(() =>
        assertPr6rDevelopmentExternalGraph({ graph, externalModules }),
      ).not.toThrow();
      expect(() =>
        assertPr6rDevelopmentExternalGraph({
          graph,
          externalModules: [...externalModules, "openai"],
        }),
      ).toThrow(/unexpected=openai/iu);
      if (externalModules.length > 0) {
        expect(() =>
          assertPr6rDevelopmentExternalGraph({
            graph,
            externalModules: externalModules.slice(1),
          }),
        ).toThrow(/missing=/iu);
      }
    }
  });

  it("allows only the exact imported members of broad special externals", () => {
    for (const [graph, bindings] of Object.entries(
      PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST,
    ) as Array<
      [
        keyof typeof PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST,
        Readonly<Record<string, readonly string[]>>,
      ]
    >) {
      expect(() =>
        assertPr6rDevelopmentExternalBindings({ graph, bindings }),
      ).not.toThrow();
      expect(() =>
        assertPr6rDevelopmentExternalBindings({
          graph,
          bindings: {
            ...bindings,
            electron: [...(bindings.electron ?? []), "net", "shell"],
          },
        }),
      ).toThrow(/external bindings do not match/iu);
    }
  });

  it("rejects retained local output imports outside emitted chunks in normal and special hooks", () => {
    const sourceModuleIds = PR6R_DEVELOPMENT_SOURCE_ALLOWLIST.main.map(
      (sourceModule) => path.join(projectRoot, sourceModule),
    );
    const context = {
      emitFile: vi.fn(),
      getModuleIds: () => sourceModuleIds.values(),
    };
    const developmentPlugin = pr6rDevelopmentModuleGraphGuard("main", {
      artifactIdentity: "test-main-identity",
    }) as any;
    for (const external of PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST.main) {
      developmentPlugin.resolveId.call(context, external);
    }
    const escapedBundle = {
      "index.js": {
        type: "chunk",
        isEntry: true,
        code: "entry",
        imports: ["../../src/main/index.js"],
        dynamicImports: [],
        importedBindings: {},
      },
    };
    expect(() =>
      developmentPlugin.generateBundle.call(context, {}, escapedBundle),
    ).toThrow(/outside its emitted bundle/iu);
    expect(context.emitFile).not.toHaveBeenCalled();

    const emittedBundle = {
      "index.js": {
        type: "chunk",
        isEntry: true,
        code: "entry",
        imports: ["./chunks/internal.js"],
        dynamicImports: [],
        importedBindings:
          PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST.main,
      },
      "chunks/internal.js": {
        type: "chunk",
        isEntry: false,
        code: "internal",
        imports: [],
        dynamicImports: [],
        importedBindings: {},
      },
    };
    expect(() =>
      developmentPlugin.generateBundle.call(context, {}, emittedBundle),
    ).not.toThrow();

    const normalContext = {
      getModuleIds: () =>
        [path.join(projectRoot, "src/main/index.ts")].values(),
    };
    const normalPlugin = pr6rNormalModuleGraphGuard("main") as any;
    expect(() =>
      normalPlugin.generateBundle.call(normalContext, {}, escapedBundle),
    ).toThrow(/outside its emitted bundle/iu);

    const unsafeNamedBundle = {
      "../escaped.js": {
        type: "chunk",
        isEntry: false,
        code: "escaped",
        imports: [],
        dynamicImports: [],
        importedBindings: {},
      },
      "index.js": {
        type: "chunk",
        isEntry: true,
        code: "entry",
        imports: ["../escaped.js"],
        dynamicImports: [],
        importedBindings: {},
      },
    };
    expect(() =>
      developmentPlugin.generateBundle.call(context, {}, unsafeNamedBundle),
    ).toThrow(/unsafe emitted file name/iu);
  });

  it("rejects computed dynamic imports before special-graph emission", () => {
    const plugin = pr6rDevelopmentModuleGraphGuard("main", {
      artifactIdentity: "test-main-identity",
    }) as any;

    expect(() =>
      plugin.resolveDynamicImport({ type: "Identifier", name: "target" }),
    ).toThrow(/computed dynamic import/iu);
    expect(() => plugin.resolveDynamicImport("openai")).toThrow(
      /cannot dynamically import an external module/iu,
    );
    expect(() => plugin.resolveDynamicImport("./pr6r-development/bootstrap"))
      .not.toThrow();
  });

  it("rejects broad Electron capabilities even when the module itself is allowlisted", () => {
    const sourceModuleIds = PR6R_DEVELOPMENT_SOURCE_ALLOWLIST.main.map(
      (sourceModule) => path.join(projectRoot, sourceModule),
    );
    const context = {
      emitFile: vi.fn(),
      getModuleIds: () => sourceModuleIds.values(),
    };
    const plugin = pr6rDevelopmentModuleGraphGuard("main", {
      artifactIdentity: "test-main-identity",
    }) as any;
    for (const external of PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST.main) {
      plugin.resolveId.call(context, external);
    }
    const bundle = {
      "index.js": {
        type: "chunk",
        isEntry: true,
        code: "entry",
        imports: [...PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST.main],
        dynamicImports: [],
        importedBindings: {
          electron: ["BrowserWindow", "app", "net", "shell"],
          "node:path": ["default"],
          "node:url": ["pathToFileURL"],
        },
      },
    };

    expect(() => plugin.generateBundle.call(context, {}, bundle)).toThrow(
      /external bindings do not match/iu,
    );
    expect(context.emitFile).not.toHaveBeenCalled();
  });

  it("rejects dynamic loaders, evaluation, and global network primitives in allowlisted special sources", () => {
    const plugin = pr6rDevelopmentModuleGraphGuard("main", {
      artifactIdentity: "test-main-identity",
    }) as any;
    const allowedSource = path.join(
      projectRoot,
      PR6R_DEVELOPMENT_SOURCE_ALLOWLIST.main[0],
    );

    for (const adversarialSource of [
      'const target = process.argv[2]; require(target);',
      'require("openai");',
      'process.getBuiltinModule("node:https");',
      'process["getBuiltinModule"]("node:module").createRequire(import.meta.url)("openai");',
      'const execute = eval; execute("require")("openai");',
      'new Function("return require")()("openai");',
      'fetch("https://example.invalid");',
      'new WebSocket("wss://example.invalid");',
      'process.binding("tcp_wrap");',
    ]) {
      expect(() => plugin.transform(adversarialSource, allowedSource)).toThrow(
        /dynamic runtime syntax forbidden/iu,
      );
    }
    expect(() =>
      plugin.transform('import { app } from "electron";', allowedSource),
    ).not.toThrow();
    expect(() =>
      plugin.transform(
        [
          '// fetch("comment.invalid"); require("comment-only");',
          '/* new WebSocket("comment.invalid") */',
          'const message = "fetch require Function WebSocket";',
          "const quoted = 'eval getBuiltinModule process.binding';",
          'const template = `fetch("template.invalid") ${"require"}`;',
          "const staticTemplate = `fetch require WebSocket`;",
          "const pattern = /fetch|require|WebSocket/u;",
        ].join("\n"),
        allowedSource,
      ),
    ).not.toThrow();
    expect(() =>
      plugin.transform(
        'const template = `safe ${fetch("https://example.invalid")}`;',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'const slash = /\\\//; fetch("https://example.invalid");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'const quote = /"/; require("node:https");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'const quote = /"/; process.binding("tcp_wrap");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'const value = `safe ${/}/.test("x") ? fetch("https://example.invalid") : 0}`;',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        "globalThis[`fetch`](\"https://example.invalid\");",
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'process[`binding`]("tcp_wrap");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        '(process as any).binding("tcp_wrap");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        '(<any>process).binding("tcp_wrap");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'process[("binding" as string)]("tcp_wrap");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    expect(() =>
      plugin.transform(
        'globalThis[("fetch" as string)]("https://example.invalid");',
        allowedSource,
      ),
    ).toThrow(/dynamic runtime syntax forbidden/iu);
    for (const bindingSource of [
      'globalThis.process.binding("tcp_wrap");',
      'globalThis["process"].binding("tcp_wrap");',
      'global.process["binding"]("tcp_wrap");',
    ]) {
      expect(() => plugin.transform(bindingSource, allowedSource)).toThrow(
        /dynamic runtime syntax forbidden/iu,
      );
    }
  });

  it("requires a distinct exact identity in each special output artifact", () => {
    const artifacts = {
      main:
        `${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER} ` +
        PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES.main,
      preload:
        `${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER} ` +
        PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES.preload,
      renderer:
        `${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER} ` +
        PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES.renderer,
    };
    expect(() => assertDevelopmentArtifactIdentities(artifacts)).not.toThrow();

    const genericMarkerInjectedIntoNormalArtifacts = {
      main: `normal main ${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER}`,
      preload: `normal preload ${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER}`,
      renderer: `normal renderer ${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER}`,
    };
    expect(() =>
      assertDevelopmentArtifactIdentities(
        genericMarkerInjectedIntoNormalArtifacts,
      ),
    ).toThrow(/main artifact does not have its one exact flavor identity/iu);
    expect(() =>
      assertDevelopmentArtifactIdentities({
        ...artifacts,
        preload:
          artifacts.preload +
          ` ${PR6R_DEVELOPMENT_CANARY_ARTIFACT_IDENTITIES.main}`,
      }),
    ).toThrow(/preload artifact contains the main flavor identity/iu);
  });

  it("rejects normal session, routing, provider, and credential signatures", () => {
    expect(() =>
      assertPr6rDevelopmentBundleSignatures("development-only shell"),
    ).not.toThrow();
    for (const signature of [
      "AgenticExecutionPolicySchema",
      "RoutingDecisionPayloadSchema",
      "ProviderDescriptorSchema",
      "AcquireCredentialLeaseInputSchema",
      "@soar/macos-credential-lease",
    ]) {
      expect(() =>
        assertPr6rDevelopmentBundleSignatures(`bundle ${signature}`),
      ).toThrow(/forbidden normal-runtime signature/iu);
    }
  });

  it("makes marker survival a hard normal-package policy failure", () => {
    expect(PR6R_DEVELOPMENT_RUNTIME_BUILD_MARKER).toBe(
      PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
    );
    expect(() => assertRendererBundleLocked("normal sealed bundle")).not.toThrow();
    expect(() =>
      assertRendererBundleLocked(
        `normal sealed bundle ${PR6R_DEVELOPMENT_CANARY_BUILD_MARKER}`,
      ),
    ).toThrow(/development-canary marker survived packaging/iu);
  });

  it("scans every bounded output artifact and rejects unsupported entry types", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-output-scan-"),
    );
    try {
      await mkdir(path.join(outputRoot, "main"), { recursive: true });
      await writeFile(
        path.join(outputRoot, "main", "hidden-runtime.mjs"),
        PR6R_DEVELOPMENT_CANARY_BUILD_MARKER,
        "utf8",
      );
      await expect(verifyNormalPr6rBuild(outputRoot)).rejects.toThrow(
        /development-canary marker survived packaging/iu,
      );

      await writeFile(
        path.join(outputRoot, "main", "hidden-runtime.mjs"),
        "normal output",
        "utf8",
      );
      await symlink(
        path.join(outputRoot, "main", "hidden-runtime.mjs"),
        path.join(outputRoot, "main", "unsupported-link"),
      );
      await expect(verifyNormalPr6rBuild(outputRoot)).rejects.toThrow(
        /unsupported output entry type/iu,
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects oversized output from metadata before attempting an unbounded read", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-output-size-preflight-"),
    );
    try {
      const oversizedArtifact = path.join(outputRoot, "oversized.bin");
      await writeFile(oversizedArtifact, "", "utf8");
      // Sparse allocation keeps the regression cheap. An implementation that
      // calls readFile first reaches Node's multi-gigabyte read failure instead
      // of the verifier's stable bound.
      await truncate(oversizedArtifact, 3 * 1024 * 1024 * 1024);
      await expect(verifyNormalPr6rBuild(outputRoot)).rejects.toThrow(
        /build isolation scan exceeded its byte bound/iu,
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("preflights development artifacts before any exact-file read", async () => {
    const outputRoot = await mkdtemp(
      path.join(tmpdir(), "soar-pr6r-development-size-preflight-"),
    );
    try {
      await mkdir(path.join(outputRoot, "main"), { recursive: true });
      const oversizedEntry = path.join(outputRoot, "main", "index.js");
      await writeFile(oversizedEntry, "", "utf8");
      await truncate(oversizedEntry, 3 * 1024 * 1024 * 1024);
      await expect(verifyPr6rDevelopmentBuild(outputRoot)).rejects.toThrow(
        /build isolation scan exceeded its byte bound/iu,
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
