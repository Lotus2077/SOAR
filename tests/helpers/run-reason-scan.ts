import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "@babel/parser";
import { RUNNER_CONTRACT_ERRORS } from "../../src/main/general-tasks/run-reasons";

/**
 * Backlog item 6 (BL-20261109-0336-desktop-resume-reasons-design): the inventory of every run reason the desktop can record, read from
 * the sources' syntax trees. tests/unit/general-task-run-reasons.test.ts holds src/main/general-tasks/run-reasons.ts to it (the
 * run-reasons contract test), and a later item that keeps its own copy of these codes can assert against the same inventory.
 * It fails closed: a reason it cannot evaluate, a stop object outside the known helpers it cannot read, or a constant it cannot resolve
 * to one value throws with the place to handle it.
 */
/** `stop`: it ends a run paused or incomplete; `completion`: it never does; `record`: a value the controller stores on a task record. */
export interface RunReasonSite { reason: string; status: "stop" | "completion" | "record"; file: string; line: number }
type Node = { type: string; start?: number; end?: number; loc?: { start: { line: number } }; [key: string]: unknown };

const ROOT = resolve(__dirname, "..", "..");
const PRIVATE_AGENT = join(ROOT, "src", "main", "private-agent");
const STATUSES = ["queued", "running", "paused", "submitted", "incomplete", "cancelled"] as const;
const sources = new Map<string, string>();

function text(file: string): string { if (!sources.has(file)) sources.set(file, readFileSync(join(ROOT, file), "utf8")); return sources.get(file)!; }
function tree(file: string): Node { return parse(text(file), { sourceType: "module", plugins: ["typescript"] }).program as unknown as Node; }
function* walk(node: unknown): Generator<Node> {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const item of node) yield* walk(item); return; }
  const current = node as Node;
  if (typeof current.type === "string") yield current;
  for (const [key, value] of Object.entries(current)) if (key !== "loc" && value && typeof value === "object") yield* walk(value);
}
const unwrap = (node: Node): Node => ["TSAsExpression", "TSNonNullExpression", "ParenthesizedExpression", "TSSatisfiesExpression"].includes(node.type) ? unwrap(node.expression as Node) : node;
const where = (file: string, node: Node) => `${file}:${node.loc?.start.line} \`${text(file).slice(node.start, node.end).replace(/\s+/gu, " ").slice(0, 80)}\``;
const memberName = (node: Node): string | undefined => {
  const n = unwrap(node);
  if (n.type === "Identifier") return String(n.name);
  if (n.type === "ThisExpression") return "this";
  if (n.type === "MemberExpression" && !n.computed) { const object = memberName(n.object as Node), property = (n.property as Node).name; return object && property ? `${object}.${String(property)}` : undefined; }
  return undefined;
};
const inside = (node: Node, ranges: readonly [number, number][]) => ranges.some(([start, end]) => node.start! >= start && node.end! <= end);

/** Every `const NAME = "code"` under src/main/private-agent: a reason written as a constant resolves to its one value. */
export function reasonConstants(): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of readdirSync(PRIVATE_AGENT).filter(file => file.endsWith(".ts")).sort()) {
    for (const node of walk(tree(join("src", "main", "private-agent", name)))) {
      if (node.type !== "VariableDeclaration" || node.kind !== "const") continue;
      for (const declarator of node.declarations as Node[]) {
        const id = declarator.id as Node, init = declarator.init ? unwrap(declarator.init as Node) : undefined;
        if (id.type !== "Identifier" || !/^[A-Z][A-Z0-9_]*$/u.test(String(id.name)) || init?.type !== "StringLiteral") continue;
        const previous = found.get(String(id.name));
        if (previous !== undefined && previous !== init.value) throw new Error(`run_reason_scan_constant_ambiguous: ${id.name} in ${name}; give it a distinct name`);
        found.set(String(id.name), String(init.value));
      }
    }
  }
  return found;
}

/**
 * The reason values an expression can take. A literal is itself, a conditional either branch (never its condition), a constant its
 * value, a call to a local reason helper its returns; a computed form must be one of `computed`'s keys, and anything else throws.
 */
function values(node: Node, file: string, constants: Map<string, string>, computed: Record<string, readonly string[]>, helpers: Map<string, Node>): string[] {
  const n = unwrap(node);
  if (n.type === "StringLiteral") return [String(n.value)];
  if (n.type === "ConditionalExpression") return [...values(n.consequent as Node, file, constants, computed, helpers), ...values(n.alternate as Node, file, constants, computed, helpers)];
  if (n.type === "Identifier" && constants.has(String(n.name))) return [constants.get(String(n.name))!];
  if (n.type === "CallExpression") {
    const callee = memberName(n.callee as Node);
    if (callee && helpers.has(callee)) return values(helpers.get(callee)!, file, constants, computed, helpers);
    if (callee && computed[`${callee}()`]) return [...computed[`${callee}()`]!];
  }
  if (n.type === "TemplateLiteral") {
    const quasis = (n.quasis as Node[]).map(q => String((q.value as { cooked: string }).cooked)), expressions = n.expressions as Node[];
    if (quasis.length === 2 && quasis[1] === "" && expressions.length === 1) {
      const inner = memberName(expressions[0]!);
      if (inner && computed[inner]) return computed[inner]!.map(value => `${quasis[0]}${value}`);
    }
  }
  const name = memberName(n);
  if (name && computed[name]) return [...computed[name]!];
  throw new Error(`run_reason_scan_unhandled: ${where(file, n)}; handle it in tests/helpers/run-reason-scan.ts`);
}
function statusOf(node: Node, file: string): "stop" | "completion" | "computed" {
  const n = unwrap(node);
  if (n.type === "StringLiteral") return ["completed", "submitted"].includes(String(n.value)) ? "completion" : "stop";
  if (n.type === "ConditionalExpression") {
    const both = [statusOf(n.consequent as Node, file), statusOf(n.alternate as Node, file)];
    if (both.every(kind => kind === "stop")) return "stop";
    throw new Error(`run_reason_scan_mixed_status: ${where(file, n)}`);
  }
  return "computed";
}
/** Local arrow helpers that return a reason, such as the session's `policyReason`. */
function reasonHelpers(program: Node, names: readonly string[]): Map<string, Node> {
  const found = new Map<string, Node>();
  for (const node of walk(program)) {
    if (node.type !== "VariableDeclarator" || (node.id as Node).type !== "Identifier" || !names.includes(String((node.id as Node).name))) continue;
    const init = unwrap(node.init as Node);
    if (init.type === "ArrowFunctionExpression" && (init.body as Node).type !== "BlockStatement") found.set(String((node.id as Node).name), init.body as Node);
  }
  return found;
}
/** The source ranges of a file's own result helper (`const finish = (...) =>`), whose shorthand `{ status, reason }` is the helper itself. */
function helperRanges(program: Node, name: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const node of walk(program)) if (node.type === "VariableDeclarator" && (node.id as Node).type === "Identifier" && (node.id as Node).name === name) ranges.push([node.start!, node.end!]);
  return ranges;
}
const calls = (program: Node, name: string) => [...walk(program)].filter(node => node.type === "CallExpression" && memberName(node.callee as Node) === name);
/**
 * Object literals that carry a reason: a `reason` key beside a `status` key, or beside a spread of a task record (`{ ...record, reason }`).
 * `status` is undefined when the object has no status key and null when it is shorthand; `reason` is null when it is shorthand.
 */
function reasonObjects(program: Node): { object: Node; status: Node | null | undefined; reason: Node | null }[] {
  const out: { object: Node; status: Node | null | undefined; reason: Node | null }[] = [];
  for (const node of walk(program)) {
    if (node.type !== "ObjectExpression") continue;
    const properties = node.properties as Node[];
    const property = (key: string) => properties.find(p => p.type === "ObjectProperty" && !p.computed && ((p.key as Node).name === key || (p.key as Node).value === key));
    const status = property("status"), reason = property("reason");
    const spreadsRecord = properties.some(p => p.type === "SpreadElement" && ["record", "next", "latest"].includes(memberName(p.argument as Node) ?? ""));
    if (!reason || !status && !spreadsRecord) continue;
    out.push({ object: node, status: status ? status.shorthand ? null : status.value as Node : undefined, reason: reason.shorthand ? null : reason.value as Node });
  }
  return out;
}

/** Every reason the runner, the research pipeline, the session and the controller can record, with where it comes from. */
export function scanRunReasons(): RunReasonSite[] {
  const constants = reasonConstants(), sites: RunReasonSite[] = [];
  const add = (file: string, node: Node, status: RunReasonSite["status"], reasons: string[]) => { for (const reason of reasons) sites.push({ reason, status, file, line: node.loc?.start.line ?? 0 }); };
  const runner = "src/main/private-agent/runner.ts", pipeline = "src/main/private-agent/research-pipeline.ts", session = "src/main/private-agent/session.ts";
  const stopsOf = (file: string) => [...new Set(sites.filter(site => site.file === file && site.status === "stop").map(site => site.reason))].sort();
  /** A file's stop objects outside its result helper (the helper's own shorthand body is the only object skipped), then its helper calls. */
  const scanFile = (file: string, helper: string, computed: Record<string, readonly string[]>, helpers: Map<string, Node>, callsToo = true) => {
    const program = tree(file), ranges = helperRanges(program, helper), found = calls(program, helper);
    if (found.length === 0 || ranges.length !== 1) throw new Error(`run_reason_scan_helper: ${file} needs exactly one ${helper} helper and at least one call`);
    for (const { object, status, reason } of reasonObjects(program)) {
      if ((reason === null || status === null) && inside(object, ranges)) continue;
      if (reason === null || !status) throw new Error(`run_reason_scan_unhandled_object: ${where(file, object)}; handle it in tests/helpers/run-reason-scan.ts`);
      const kind = statusOf(status, file);
      if (kind === "computed") throw new Error(`run_reason_scan_computed_status: ${where(file, object)}; handle it in tests/helpers/run-reason-scan.ts`);
      add(file, object, kind, values(reason, file, constants, {}, helpers));
    }
    if (!callsToo) return;
    for (const call of found) {
      const [status, reason] = call.arguments as Node[];
      if (!status || !reason) throw new Error(`run_reason_scan_arity: ${where(file, call)}`);
      add(file, call, statusOf(status, file) === "completion" ? "completion" : "stop", values(reason, file, constants, computed, helpers));
    }
  };
  scanFile(runner, "finish", {}, new Map());
  scanFile(pipeline, "finish", {}, new Map());
  // The session's own phase results (runPhase's early returns and completed()) travel as privateResult and publicResult.
  const sessionTree = tree(session), helpers = reasonHelpers(sessionTree, ["policyReason"]);
  const before = sites.length;
  scanFile(session, "result", {}, helpers, false);
  const phaseStops = [...new Set(sites.slice(before).filter(site => site.status === "stop").map(site => site.reason))];
  const phaseReasons = [...new Set([...stopsOf(runner), ...phaseStops])].sort();
  sites.splice(before);
  scanFile(session, "result", { "outcome.reason": stopsOf(pipeline), "privateResult.reason": phaseReasons, "publicResult.reason": phaseReasons }, helpers);
  // The controller: every reason it stores, from its assignments and its record literals. caughtRunReason's own returns are read from run-reasons.ts.
  const caughtFunction = [...walk(tree("src/main/general-tasks/run-reasons.ts"))].find(node => node.type === "FunctionDeclaration" && (node.id as Node).name === "caughtRunReason");
  if (!caughtFunction) throw new Error("run_reason_scan_helper: src/main/general-tasks/run-reasons.ts needs caughtRunReason");
  const caught = [...new Set([...walk(caughtFunction.body)].filter(node => node.type === "ReturnStatement" && (node.argument as Node | undefined)?.type === "StringLiteral")
    .map(node => String((node.argument as Node).value)))];
  const controller = "src/main/general-tasks/controller.ts", controllerTree = tree(controller);
  const controllerComputed = { "next.status": STATUSES, "record.status": STATUSES, "storedRunReason()": ["incomplete"], "caughtRunReason()": [...caught, ...RUNNER_CONTRACT_ERRORS] };
  const snapshot = [...walk(controllerTree)].filter(node => node.type === "ClassMethod" && (node.key as Node).name === "get").map(node => [node.start!, node.end!] as [number, number]);
  for (const node of walk(controllerTree)) {
    if (node.type !== "AssignmentExpression" || node.operator !== "=" || (node.left as Node).type !== "MemberExpression") continue;
    const left = node.left as Node, property = left.property as Node;
    if (left.computed ? property.type === "StringLiteral" && property.value === "reason" : property.name === "reason") add(controller, node, "record", values(node.right as Node, controller, constants, controllerComputed, new Map()));
  }
  for (const { object, status, reason } of reasonObjects(controllerTree)) {
    // get()'s snapshot carries the reason's text, never a code.
    if (inside(object, snapshot)) continue;
    if (reason === null || status === null || status && statusOf(status, controller) === "computed")
      throw new Error(`run_reason_scan_unhandled_object: ${where(controller, object)}; handle it in tests/helpers/run-reason-scan.ts`);
    add(controller, object, "record", values(reason, controller, constants, controllerComputed, new Map()));
  }
  return sites;
}
