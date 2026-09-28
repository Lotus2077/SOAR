/** Public calculator responses for the production local/critic/repair bridge. */
export const criticFixtureScenarios = ["acceptable", "repair", "invalid", "unknown"] as const;
export type CriticFixtureScenario = typeof criticFixtureScenarios[number];

export const criticFixtureObjective = "Fix addition for signed and fractional operands while preserving the add(a, b) interface.";
export const criticFixtureIssue = "Using abs(b) discards the second operand's sign: add(3, -5) must be -2, but this draft returns 8.";
export const criticFixtureRepair = "Preserve the signed second operand by returning a + b. Keep the interface unchanged, run the visible checks, and submit the repaired draft.";
export const criticFixtureSecret = "synthetic-critic-fixture-key";
export const criticFixtureHidden = "SYNTHETIC_PRIVATE_REASONING_NEVER_REPLAY";

function edit(expression: string): string {
  return `python -c "from pathlib import Path; p=Path('calculator.py'); p.write_text('def add(a, b):\\n    return ${expression}\\n')"`;
}

export function nativeCriticFixtureReply(scenario: CriticFixtureScenario, stage: "draft" | "repair", call: number) {
  const expression = stage === "repair" || scenario === "acceptable" ? "a + b" : "a + abs(b)";
  const name = call === 1 ? "run_command" : call === 2 ? "run_visible_checks" : call === 3 ? "submit_task" : "request_help";
  const args = call === 1 ? { command: edit(expression) } : call > 3 ? { reason: "Fixture has no further actions; do not retry or escalate." } : {};
  return { model: "native-critic-fixture", choices: [{ index: 0, finish_reason: "tool_calls", message: {
    role: "assistant", content: null, reasoning_content: criticFixtureHidden,
    tool_calls: [{ id: `${stage}-${call}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
}

export function cloudCriticFixtureReply(scenario: Exclude<CriticFixtureScenario, "unknown">) {
  const verdict = scenario === "acceptable"
    ? { verdict: "acceptable", summary: "The draft preserves signed addition and the public interface.", findings: [], missingContext: [] }
    : { verdict: "repair_required", summary: "The draft changes the sign of a negative second operand.", findings: [{
      path: "calculator.py", revision: "candidate", startLine: 2, endLine: 2,
      issue: criticFixtureIssue, repair: criticFixtureRepair,
    }], missingContext: [] };
  return { model: "critic-fixture", choices: [{ index: 0, finish_reason: "stop", message: {
    role: "assistant", content: scenario === "invalid" ? "{invalid critic JSON" : JSON.stringify(verdict),
    reasoning_content: criticFixtureHidden,
  } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
}
