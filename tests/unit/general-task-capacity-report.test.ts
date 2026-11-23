import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capacityReportFile } from "../../src/main/general-tasks/capacity-report";

function render(rows: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), "soar-capacity-"));
  try {
    const helper = join(root, "soar_capacity.py");
    const input = join(root, "rows.json");
    writeFileSync(helper, capacityReportFile().bytes);
    writeFileSync(input, JSON.stringify(rows));
    return spawnSync("python3", ["-I", helper, input], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("desktop staffing report", () => {
  it("renders its summary, assignments and relief hours from the same figures", () => {
    const result = render([
      { role: "Field", week: "First", capacity: 7.5, assignments: [{ project: "A", hours: 5.3 }, { project: "B", hours: 3.4 }] },
      { role: "Field", week: "Second", capacity: 7.5, assignments: [{ project: "A", hours: 7.5 }] },
      { role: "Office", week: "First", capacity: 9, assignments: [{ project: "A", hours: 2 }] },
      { role: "Office", week: "Second", capacity: null, assignments: [{ project: "<Field>", hours: 10 }] },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("<p>Overloaded role-weeks: 1 of 3 assessed. Role-weeks with unknown capacity: 1.</p>");
    const expectedRows = [
      ["Field", "First", "A (5.3 h), B (3.4 h)", "8.7", "7.5", "-1.2", "Over by 1.2 h"],
      ["Field", "Second", "A (7.5 h)", "7.5", "7.5", "0", "At capacity"],
      ["Office", "First", "A (2 h)", "2", "9", "7", "7 h available"],
      ["Office", "Second", "&lt;Field&gt; (10 h)", "10", "Unknown", "Unknown", "Capacity unknown"],
    ];
    for (const [role, ...cells] of expectedRows) {
      expect(result.stdout).toContain(`<tr><th scope="row">${role}</th>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`);
    }
    expect(result.stdout).not.toContain("<Field>");
  });

  it("refuses duplicate role-weeks instead of inflating the overload count", () => {
    const row = { role: "Field", week: "First", capacity: 1, assignments: [{ project: "A", hours: 2 }] };
    const result = render([row, row]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("combine assignments");
  });
});
