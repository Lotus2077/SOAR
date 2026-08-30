import { describe, expect, it } from "vitest";

import {
  localReviewExitCode,
  parseLocalReviewCliArguments,
} from "../../scripts/benchmark-local-review";

describe("local review benchmark CLI", () => {
  const valid = [
    "--calibration-id",
    "cal-001-soar-plan-approval",
    "--source-repository",
    ".",
    "--run-id",
    "local-review-001",
    "--live-local-vllm",
  ];

  it("accepts only the fixed fixture and explicit live opt-in", () => {
    expect(parseLocalReviewCliArguments(valid)).toMatchObject({
      calibrationId: "cal-001-soar-plan-approval",
      runId: "local-review-001",
      liveLocalVllm: true,
    });
    expect(parseLocalReviewCliArguments(["--", ...valid])).toMatchObject({
      calibrationId: "cal-001-soar-plan-approval",
      runId: "local-review-001",
      liveLocalVllm: true,
    });
  });

  it.each([
    { argv: [...valid, "--provider", "cloud"] },
    { argv: valid.filter((token) => token !== "--live-local-vllm") },
    {
      argv: valid.map((token) =>
        token === "cal-001-soar-plan-approval"
          ? "cal-002-soar-repeat-step-guard"
          : token,
      ),
    },
    { argv: [...valid, "--run-id", "duplicate"] },
    { argv: [...valid, "--"] },
    { argv: ["--", "--", ...valid] },
    {
      argv: valid.map((token) =>
        token === "local-review-001" ? "../escape" : token,
      ),
    },
  ])("rejects unsupported, missing, duplicate, or unsafe arguments", ({ argv }) => {
    expect(() => parseLocalReviewCliArguments(argv)).toThrow();
  });

  it.each([
    ["passed", 0],
    ["blocked", 2],
    ["failed", 2],
    ["invalid", 2],
    ["cancelled", 130],
  ] as const)("maps %s to process exit %d", (status, expected) => {
    expect(localReviewExitCode({ status })).toBe(expected);
  });
});
