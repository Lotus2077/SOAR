import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DECK_CHECK_ID, DECK_CHECK_PATH, DECK_CHECK_PY, DECK_CHECK_SHA256, deckArtifacts, deckCheckFile, deckValidityCheck, deckValidityInstructions, withDeckValidity } from "../../src/main/private-agent/ooxml";
import { checkCommand } from "../../src/main/private-agent/runner";
import { PRIVATE_SANDBOX_LIMITS } from "../../src/main/private-agent/sandbox";
import { digest } from "../../src/main/private-agent/contracts";
import type { SessionPhase } from "../../src/main/private-agent/session";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const step of cleanups.splice(0).reverse()) step(); });
const FIXTURES = join(__dirname, "..", "fixtures", "ooxml", "make_decks.py");
/** Runs the embedded check on the host's python3 under -I against a fixture directory standing in for /workspace. */
function run(root: string, paths: string[]): { exit: number; result: { passed: boolean; decks: Record<string, { passed: boolean; problems: string[] }> } } {
  const check = deckValidityCheck({ paths, root });
  try { return { exit: 0, result: JSON.parse(execFileSync("python3", ["-I", "-c", check.python], { encoding: "utf8" })) }; }
  catch (error) { const failure = error as { status: number; stdout: string }; return { exit: failure.status, result: JSON.parse(failure.stdout) }; }
}
function phase(artifacts: string[]): SessionPhase {
  return { files: [{ path: "brief.md", bytes: Buffer.from("Build a deck.") }, { path: "input/data.csv", bytes: Buffer.from("a,b\n1,2\n") }], checks: [{ id: "structure", python: "pass" }],
    contract: { version: 1, goal: "Build the deck from input/data.csv.", requiredArtifacts: artifacts.map(path => ({ path, description: "deliverable" })), requiredChecks: ["structure"], maxModelCalls: 5, maxToolCalls: 5, maxElapsedMs: 60_000 } };
}

describe("H4 deck validity check", () => {
  it("embeds a raw script with no backtick, dollar-brace or NUL, and its finish command fits the sandbox command cap", () => {
    expect(DECK_CHECK_PY).not.toMatch(/`|\$\{|\u0000/u);
    expect(DECK_CHECK_PY.split("__PARAMS__")).toHaveLength(2);
    const check = deckValidityCheck({ paths: ["output/deck.pptx", "output/it's.pptx"] });
    expect(check.id).toBe(DECK_CHECK_ID); expect(check.python).not.toContain("__PARAMS__");
    expect(Buffer.byteLength(checkCommand(check))).toBeLessThan(PRIVATE_SANDBOX_LIMITS.commandBytes / 4);
    expect(DECK_CHECK_SHA256).toBe(digest(DECK_CHECK_PY));
    for (const paths of [[], ["../x.pptx"], ["output/./a.pptx"], ["a.pptx", "a.pptx"], Array.from({ length: 31 }, (_, i) => `output/${i}.pptx`)]) expect(() => deckValidityCheck({ paths })).toThrow("deck_check_paths_invalid");
  });
  it("passes the valid fixtures and fails each defective one with the expected code", () => {
    const root = mkdtempSync(join(tmpdir(), "soar-ooxml-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    execFileSync("python3", ["-I", "-W", "ignore", FIXTURES, root]);
    const expected: Record<string, string | null> = {
      // Every valid fixture carries an a:extLst extension element on its chart frame, the way PowerPoint saves shapes, which is not a size and must not be refused;
      // a chart-level position on an area chart is valid (Office constrains the "none at all" groups inside c:ser only).
      // Part names are case-insensitive, so an Override spelled with another case still names the part.
      "valid.pptx": null, "valid-chart-level-outend-bar.pptx": null, "valid-line-top.pptx": null, "valid-pie-bestfit.pptx": null, "valid-stacked-center.pptx": null, "valid-bar-default-grouping.pptx": null, "valid-area-chart-level-center.pptx": null, "valid-override-case.pptx": null,
      // A chart whose Override is missing or empty is not a chart to Office: the relationship that names it as one is refused, and the empty type is a missing type.
      "chart-override-missing-bad-pos.pptx": "relationship_type_mismatch:ppt/slides/_rels/slide1.xml.rels->../charts/chart1.xml", "override-empty-ct.pptx": "content_type_missing:ppt/charts/chart1.xml",
      "bar-standard-top.pptx": "data_label_position_invalid:ppt/charts/chart1.xml:barChart:t", "slide-outside-ppt-bad-coord.pptx": "coordinate_not_integer:slides/slide1.xml:2",
      "duplicate-entry.pptx": "zip_duplicate_entry:ppt/charts/chart1.xml",
      "coordinate.pptx": "coordinate_not_integer:ppt/slides/slide1.xml:2", "bar-top.pptx": "data_label_position_invalid:ppt/charts/chart1.xml:barChart:t",
      "line-outend-chart-level.pptx": "data_label_position_invalid:ppt/charts/chart1.xml:lineChart:outEnd", "stacked-outend.pptx": "data_label_position_invalid:ppt/charts/chart1.xml:barChart:outEnd",
      "area-position.pptx": "data_label_position_invalid:ppt/charts/chart1.xml:areaChart:ctr", "relationship-missing.pptx": "relationship_target_missing:ppt/slides/_rels/slide1.xml.rels->../charts/chart9.xml",
      "content-type-missing.pptx": "content_type_missing:ppt/media/image1.png", "override-without-part.pptx": "override_without_part:ppt/slides/slide2.xml", "malformed.pptx": "xml_malformed:ppt/slides/slide1.xml",
      "no-slides.pptx": "no_slides", "duplicate-slide-id.pptx": "slide_id_duplicate:256", "slide-relationship-missing.pptx": "slide_relationship_missing:rId7", "not-a-zip.pptx": "zip_unreadable" };
    const { exit, result } = run(root, Object.keys(expected));
    expect(exit).toBe(1); expect(result.passed).toBe(false);
    // Details are bounded and the whole output stays far under the sandbox's 256 KiB stdout cap even for an absurd relationship target.
    const huge = run(root, ["huge-target.pptx"]);
    expect(huge.result.decks["huge-target.pptx"]!.problems[0]!.length).toBeLessThan(260); expect(JSON.stringify(huge.result).length).toBeLessThan(65_536);
    for (const [name, code] of Object.entries(expected)) {
      const deck = result.decks[name]!;
      if (code === null) expect(deck, name).toEqual({ passed: true, problems: [] });
      else { expect(deck.passed, name).toBe(false); expect(deck.problems, name).toContain(code); }
    }
    const good = run(root, ["valid.pptx", "valid-line-top.pptx"]);
    expect(good.exit).toBe(0); expect(good.result.passed).toBe(true);
    // A missing deck and a path that leaves the root are refused without reading anything.
    const missing = run(root, ["absent.pptx"]);
    expect(missing.exit).toBe(1); expect(missing.result.decks["absent.pptx"]!.problems).toEqual(["file_invalid"]);
  });
  it("adds the check, the workspace copy and the instructions only to a phase with a deck deliverable", () => {
    const plain = phase(["output/report.md"]);
    expect(withDeckValidity(plain)).toBe(plain);
    const deck = withDeckValidity(phase(["output/report.md", "output/Deck.PPTX", "output/second.pptx"]));
    expect(deckArtifacts(deck)).toEqual(["output/Deck.PPTX", "output/second.pptx"]);
    expect(deck.contract.requiredChecks).toEqual(["structure", DECK_CHECK_ID]); expect(deck.checks.map(check => check.id)).toEqual(["structure", DECK_CHECK_ID]);
    expect(deck.files.map(file => file.path)).toEqual(["brief.md", "input/data.csv", DECK_CHECK_PATH]);
    expect(deck.contract.goal).toBe(`Build the deck from input/data.csv.\n${deckValidityInstructions(["output/Deck.PPTX", "output/second.pptx"])}`);
    expect(deck.contract.goal).toContain(`python3 -I ${DECK_CHECK_PATH} 'output/Deck.PPTX' 'output/second.pptx'`);
    // The workspace copy is the same script reading its paths from the command line, so it reports what the host check will.
    const copy = deckCheckFile().bytes.toString("utf8");
    expect(copy).not.toContain("__PARAMS__"); expect(digest(copy.replace(/'[A-Za-z0-9+/=]+'\)\)/u, "'__PARAMS__'))"))).toBe(DECK_CHECK_SHA256);
    const root = mkdtempSync(join(tmpdir(), "soar-ooxml-copy-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    execFileSync("python3", ["-I", "-W", "ignore", FIXTURES, root]);
    const failed = (() => { try { execFileSync("python3", ["-I", "-c", copy, "bar-top.pptx"], { cwd: root, encoding: "utf8", stdio: "pipe" }); return undefined; } catch (error) { return error as { status: number; stdout: string }; } })();
    expect(failed?.status).toBe(1); expect(JSON.parse(failed!.stdout).decks["bar-top.pptx"].problems).toEqual(["data_label_position_invalid:ppt/charts/chart1.xml:barChart:t"]);
    expect(JSON.parse(execFileSync("python3", ["-I", "-c", copy, "valid.pptx"], { cwd: root, encoding: "utf8" }))).toMatchObject({ passed: true });
    // Run without a path the copy refuses with a usage line instead of reporting an empty pass.
    const noPath = (() => { try { execFileSync("python3", ["-I", "-c", copy], { cwd: root, encoding: "utf8", stdio: "pipe" }); return undefined; } catch (error) { return error as { status: number; stderr: string }; } })();
    expect(noPath?.status).toBe(2); expect(noPath?.stderr).toContain("usage");
    // Reserved paths and a second application are refused before any state is written.
    const taken = phase(["output/deck.pptx"]); taken.files.push({ path: DECK_CHECK_PATH, bytes: Buffer.from("x") });
    expect(() => withDeckValidity(taken)).toThrow("deck_check_path_taken");
    expect(() => withDeckValidity(deck)).toThrow("deck_check_path_taken");
  });
});
