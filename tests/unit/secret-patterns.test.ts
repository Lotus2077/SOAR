import { describe, expect, it } from "vitest";

import { secretPatterns } from "../../scripts/secret-patterns.mjs";

const openAiStyleCredential = secretPatterns.find(
  ({ name }) => name === "OpenAI-style API credential",
);

describe("readiness secret patterns", () => {
  it("does not classify sk- inside a normal identifier as a credential", () => {
    expect(openAiStyleCredential).toBeDefined();
    expect(
      openAiStyleCredential?.pattern.test(
        "cal-flask-899929545331006514cad3dbbad5b45956664dc5",
      ),
    ).toBe(false);
  });

  it.each([
    ["OPENAI_API_KEY=", "sk", "-", "12345678901234567890"].join(""),
    ['"apiKey":"', "sk", "-or-v1-", "12345678901234567890", '"'].join(""),
    ["credential: ", "sk", "-", "abcdefghijklmnopqrst"].join(""),
  ])("still detects a standalone OpenAI-style credential in %s", (candidate) => {
    expect(openAiStyleCredential).toBeDefined();
    expect(openAiStyleCredential?.pattern.test(candidate)).toBe(true);
  });
});
