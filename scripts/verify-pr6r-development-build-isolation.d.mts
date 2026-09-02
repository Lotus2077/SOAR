export function assertDevelopmentArtifactIdentities(artifacts: Readonly<
  Record<"main" | "preload" | "renderer", string>
>): void;
export function assertPr6rDevelopmentBundleSignatures(
  bundledText: string,
): void;
export function verifyNormalPr6rBuild(outputRoot?: string): Promise<void>;
export function verifyPr6rDevelopmentBuild(outputRoot?: string): Promise<void>;
