import type { Plugin } from "vite";

export type Pr6rBuildGraph = "main" | "preload" | "renderer";

export const PR6R_BUILD_GRAPHS: readonly Pr6rBuildGraph[];
export const PR6R_DEVELOPMENT_SOURCE_ALLOWLIST: Readonly<
  Record<Pr6rBuildGraph, readonly string[]>
>;
export const PR6R_DEVELOPMENT_EXTERNAL_ALLOWLIST: Readonly<
  Record<Pr6rBuildGraph, readonly string[]>
>;
export const PR6R_DEVELOPMENT_EXTERNAL_BINDING_ALLOWLIST: Readonly<
  Record<Pr6rBuildGraph, Readonly<Record<string, readonly string[]>>>
>;
export const PR6R_DEVELOPMENT_GRAPH_PROOF_FILE: string;

export function assertNormalPr6rModuleGraph(input: {
  graph: Pr6rBuildGraph;
  sourceModules: readonly string[];
}): void;
export function assertPr6rDevelopmentModuleGraph(input: {
  graph: Pr6rBuildGraph;
  sourceModules: readonly string[];
}): void;
export function assertPr6rDevelopmentExternalGraph(input: {
  graph: Pr6rBuildGraph;
  externalModules: readonly string[];
}): void;
export function assertPr6rDevelopmentExternalBindings(input: {
  graph: Pr6rBuildGraph;
  bindings: Readonly<Record<string, readonly string[]>>;
}): void;
export function canonicalPr6rDevelopmentGraphProof(
  graph: Pr6rBuildGraph,
): string;
export function pr6rNormalModuleGraphGuard(graph: Pr6rBuildGraph): Plugin;
export function pr6rDevelopmentModuleGraphGuard(
  graph: Pr6rBuildGraph,
  options: Readonly<{ artifactIdentity: string }>,
): Plugin;
