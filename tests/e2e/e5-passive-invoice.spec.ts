import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const repo = path.resolve(import.meta.dirname, "../..");

test("a scanned offline invoice can filter, sort both ways and preserve ties without form controls", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "soar-passive-invoice-")));
  const source = path.join(root, "source");
  const output = path.join(root, "staged");
  const states = [
    { id: "all-up", title: "All ascending", rows: ["C -4", "D 0", "E 5", "A 12", "B 12"] },
    { id: "all-down", title: "All descending", rows: ["A 12", "B 12", "E 5", "D 0", "C -4"] },
    { id: "due-up", title: "Unpaid ascending", rows: ["E 5", "A 12", "B 12"] },
    { id: "due-down", title: "Unpaid descending", rows: ["A 12", "B 12", "E 5"] },
  ];
  try {
    await mkdir(source, { mode: 0o700 });
    const links = states.map(({ id, title }) => `<a href="#${id}">${title}</a>`).join(" ");
    const sections = states.map(({ id, title, rows }) => `<section id="${id}"><h2>${title}</h2><table>
      ${rows.map((row) => `<tr><td>${row}</td></tr>`).join("")}</table></section>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice summary</title>
      <style>section {display:none} #all-up,section:target {display:block}
      main:has(section:target) #all-up:not(:target) {display:none}</style></head>
      <body><nav>${links}</nav><main>${sections}</main></body></html>`;
    await writeFile(path.join(source, "report.html"), html);
    const scan = (dest: string) => spawnSync("python3", ["-IB", path.join(repo, "scripts/e5-proxy-stage.py"),
      "--source", source, "--out", dest], { encoding: "utf8", input: JSON.stringify({
        ownerNames: ["Fixture Alias"], endpointHosts: ["fixture.invalid"], materialRoots: [root],
      }) });
    expect(scan(output).status).toBe(0);
    const fixture = path.join(root, "viewer.cjs");
    await writeFile(fixture, `const { app, BrowserWindow } = require('electron');
      app.setPath('userData', process.argv[3]);
      app.whenReady().then(() => new BrowserWindow({show:false,webPreferences:{javaScript:false}}).loadFile(process.argv[2]));`);
    const app = await electron.launch({ args: [fixture, path.join(output, "report.html"), path.join(root, "browser")] });
    try {
      const page = await app.firstWindow();
      await expect(page.locator("section:visible")).toHaveAttribute("id", "all-up");
      for (const state of [...states.slice(1), states[0]]) {
        await page.getByRole("link", { name: state.title }).click();
        await expect(page.locator("section:visible")).toHaveCount(1);
        await expect(page.locator("section:visible td")).toHaveText(state.rows);
      }
    } finally {
      await app.close();
    }
    await writeFile(path.join(source, "report.html"), '<html><body><input type="radio"></body></html>');
    const refused = scan(path.join(root, "refused"));
    expect(refused.status).not.toBe(0);
    expect(refused.stderr.trim()).toBe("opaque_content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
