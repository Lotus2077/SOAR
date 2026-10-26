import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DockerSandbox } from "../../src/main/private-agent/sandbox";
import { checkCommand } from "../../src/main/private-agent/runner";
import { DECK_CHECK_PATH, deckCheckFile, deckValidityCheck } from "../../src/main/private-agent/ooxml";

const enabled = process.env.SOAR_RUN_PRIVATE_AGENT_RUNTIME === "true";
const imageId = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";
/** Decks the way an agent makes them in the qualified image: python-pptx with charts, tables and data labels. */
const MAKE = String.raw`from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION
from pptx.util import Inches
def deck(path, line_pos):
    prs = Presentation()
    data = CategoryChartData(); data.categories = ["Q1", "Q2", "Q3"]; data.add_series("Revenue", (10, 12, 15)); data.add_series("Cost", (6, 7, 8))
    for kind, pos in ((XL_CHART_TYPE.COLUMN_CLUSTERED, XL_LABEL_POSITION.OUTSIDE_END), (XL_CHART_TYPE.LINE_MARKERS, line_pos), (XL_CHART_TYPE.BAR_STACKED, XL_LABEL_POSITION.CENTER), (XL_CHART_TYPE.PIE, XL_LABEL_POSITION.BEST_FIT)):
        slide = prs.slides.add_slide(prs.slide_layouts[5]); slide.shapes.title.text = "Chart"
        series = data if kind != XL_CHART_TYPE.PIE else None
        if series is None:
            series = CategoryChartData(); series.categories = ["A", "B"]; series.add_series("Share", (1, 2))
        chart = slide.shapes.add_chart(kind, Inches(0.5), Inches(1.5), Inches(8), Inches(5), series).chart
        chart.plots[0].has_data_labels = True; chart.plots[0].data_labels.position = pos
    slide = prs.slides.add_slide(prs.slide_layouts[5]); slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(4), Inches(1)).table.cell(0, 0).text = "Term"
    prs.save(path)
deck("output/valid.pptx", XL_LABEL_POSITION.ABOVE)
deck("output/line-outend.pptx", XL_LABEL_POSITION.OUTSIDE_END)
print("made")
`;

describe.skipIf(!enabled)("H4 deck validity check inside the qualified image", () => {
  it("passes python-pptx decks with valid data-label positions, fails outEnd on a line chart, and the workspace copy agrees with the host check", async () => {
    const sandbox = await DockerSandbox.create({ imageId, jobId: `deck-${randomUUID().slice(0, 8)}`, contextId: randomUUID(),
      files: [{ path: "make.py", bytes: Buffer.from(MAKE) }, deckCheckFile()] });
    try {
      const made = await sandbox.execute("mkdir -p output && python3 -I make.py", { timeoutMs: 120_000 });
      expect(made.stdout.trim()).toBe("made");
      // The host's finish check, exactly as the verifier runs it.
      const good = await sandbox.execute(checkCommand(deckValidityCheck({ paths: ["output/valid.pptx"] })), { timeoutMs: 90_000 });
      expect(good.exitCode, good.stderr).toBe(0); expect(JSON.parse(good.stdout)).toMatchObject({ passed: true, decks: { "output/valid.pptx": { passed: true, problems: [] } } });
      const bad = await sandbox.execute(checkCommand(deckValidityCheck({ paths: ["output/valid.pptx", "output/line-outend.pptx"] })), { timeoutMs: 90_000 });
      expect(bad.exitCode).toBe(1);
      const result = JSON.parse(bad.stdout) as { passed: boolean; decks: Record<string, { problems: string[] }> };
      expect(result.passed).toBe(false); expect(result.decks["output/line-outend.pptx"]!.problems).toEqual(["data_label_position_invalid:ppt/charts/chart2.xml:lineChart:outEnd"]);
      // The agent's copy, run as the instructions say, prints the same problems.
      const copy = await sandbox.execute(`python3 -I ${DECK_CHECK_PATH} output/line-outend.pptx`, { timeoutMs: 90_000 });
      expect(copy.exitCode).toBe(1); expect(JSON.parse(copy.stdout).decks["output/line-outend.pptx"].problems).toEqual(result.decks["output/line-outend.pptx"]!.problems);
    } finally { await sandbox.close(); }
  }, 300_000);
});
