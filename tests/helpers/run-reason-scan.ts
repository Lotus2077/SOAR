import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "@babel/parser";

/**
 * Backlog item 6 (BL-20261109-0336-desktop-resume-reasons-design): the inventory of every run reason the desktop can record, read from
 * the sources' syntax trees. tests/unit/general-task-run-reasons.test.ts holds src/main/general-tasks/run-reasons.ts to it (the
 * run-reasons contract test), and a later item that keeps its own copy of these codes can assert against the same inventory.
 */
/** `stop`: it ends a run paused or incomplete; `completion`: it never does; `record`: a value the controller stores on a task record. */
export interface RunReasonSite { reason: string; status: "stop" | "completion" | "record"; file: string; line: number }
type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

const ROOT = resolve(__dirname, "..", "..");
const PRIVATE_AGENT = join(ROOT, "src", "main", "private-agent");
const STATUSES = ["queued", "running", "paused", "submitted", "incomplete", "cancelled"] as const;

function tree(file: string): Node { return parse(readFileSync(join(ROOT, file), "utf8"), { sourceType: "module", plugins: ["typescript"] }).program as unknown as Node; }
function* walk(node: unknown): Generator<Node> {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const item of node) yield* walk(item); return; }
  const current = node as Node;
  if (typeof current.type === "string") yield current;
  for (const [key, value] of Object.entries(current)) if (key !== "loc" && key !== "start" && key !== "end" && value && typeof value === "object") yield* walk(value);
}
const unwrap = (node: Node): Node => ["TSAsExpression", "TSNonNullExpression", "ParenthesizedExpression", "TSSatisfiesExpression"].includes(node.type) ? unwrap(node.expression as Node) : node;
const source = (node: Node): string => { const n = node as { start?: number; end?: number }; return `${n.start}-${n.end}`; };
const memberName = (node: Node): string | undefined => {
  const n = unwrap(node);
  if (n.type === "Identifier") return String(n.name);
  if (n.type === "MemberExpression" && !n.computed) { const object = memberName(n.object as Node), property = (n.property as Node).name; return object && property ? `${object}.${String(property)}` : undefined; }
  if (n.type === "ThisExpression") return "this";
  return undefined;
};

/** Every `NAME = "code"` constant under src/main/private-agent: a reason written as a constant resolves to its value. */
export function reasonConstants(): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of readdirSync(PRIVATE_AGENT).filter(file => file.endsWith(".ts")).sort()) {
    for (const node of walk(tree(join("src", "main", "private-agent", name)))) {
      if (node.type !== "VariableDeclarator") continue;
      const id = node.id as Node, init = node.init ? unwrap(node.init as Node) : undefined;
      if (id.type === "Identifier" && /^[A-Z][A-Z0-9_]*$/u.test(String(id.name)) && init?.type === "StringLiteral") found.set(String(id.name), String(init.value));
    }
  }
  return found;
}

/**
 * The reason values an expression can take. A literal is itself, a conditional either branch (never its condition), a constant its
 * value, a call to a local reason helper its returns; a computed form must be one of `computed`'s keys, and anything else throws.
 */
function values(node: Node, file: string, constants: Map<string, string>, computed: Record<string, readonly string[]>, helpers: Map<string, Node>): string[] {
  const n = unwrap(node), at = `${file}:${n.loc?.start.line}`;
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
  throw new Error(`run_reason_scan_unhandled: ${at} (${n.type} ${name ?? source(n)}); handle it in tests/helpers/run-reason-scan.ts`);
}
function statusOf(node: Node, file: string, constants: Map<string, string>): "stop" | "completion" | "computed" {
  const n = unwrap(node);
  if (n.type === "StringLiteral") return ["completed", "submitted"].includes(String(n.value)) ? "completion" : "stop";
  if (n.type === "ConditionalExpression") {
    const both = [statusOf(n.consequent as Node, file, constants), statusOf(n.alternate as Node, file, constants)];
    if (both.every(kind => kind === "stop")) return "stop";
    throw new Error(`run_reason_scan_mixed_status: ${file}:${n.loc?.start.line}`);
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
/** Each call `name(status, reason)`, skipping the helper's own definition. */
function calls(program: Node, name: string): Node[] {
  return [...walk(program)].filter(node => node.type === "CallExpression" && memberName(node.callee as Node) === name);
}
/** Object literals that carry a stop of their own: both a `status` and a `reason` key whose value is not the helper's shorthand. */
function stopObjects(program: Node): { status: Node; reason: Node }[] {
  const out: { status: Node; reason: Node }[] = [];
  for (const node of walk(program)) {
    if (node.type !== "ObjectExpression") continue;
    const property = (key: string) => (node.properties as Node[]).find(p => p.type === "ObjectProperty" && !p.computed && ((p.key as Node).name === key || (p.key as Node).value === key));
    const status = property("status"), reason = property("reason");
    if (status && reason && !reason.shorthand) out.push({ status: status.value as Node, reason: reason.value as Node });
  }
  return out;
}

/** Every reason the runner, the research pipeline, the session and the controller can record, with where it comes from. */
export function scanRunReasons(): RunReasonSite[] {
  const constants = reasonConstants(), sites: RunReasonSite[] = [];
  const add = (file: string, line: number | undefined, status: RunReasonSite["status"], reasons: string[]) => { for (const reason of reasons) sites.push({ reason, status, file, line: line ?? 0 }); };
  const scanCalls = (file: string, helper: string, computed: Record<string, readonly string[]>, helpers: Map<string, Node>) => {
    const program = tree(file), found = calls(program, helper);
    if (!found.length) throw new Error(`run_reason_scan_empty: ${file} ${helper}()`);
    for (const call of found) {
      const [status, reason] = call.arguments as Node[];
      if (!status || !reason) throw new Error(`run_reason_scan_arity: ${file}:${call.loc?.start.line}`);
      const kind = statusOf(status, file, constants);
      add(file, call.loc?.start.line, kind === "completion" ? "completion" : "stop", values(reason, file, constants, computed, helpers));
    }
    return program;
  };
  const runner = "src/main/private-agent/runner.ts", pipeline = "src/main/private-agent/research-pipeline.ts", session = "src/main/private-agent/session.ts";
  scanCalls(runner, "finish", {}, new Map());
  scanCalls(pipeline, "finish", {}, new Map());
  const stopsOf = (file: string) => sites.filter(site => site.file === file && site.status === "stop").map(site => site.reason);
  const sessionTree = tree(session), helpers = reasonHelpers(sessionTree, ["policyReason"]);
  // The session's own phase results (runPhase's early returns and completed()) travel as privateResult and publicResult.
  const phaseStops: string[] = [];
  for (const object of stopObjects(sessionTree)) {
    const kind = statusOf(object.status, session, constants);
    if (kind === "computed") continue;
    if (kind === "completion") { add(session, object.reason.loc?.start.line, "completion", values(object.reason, session, constants, {}, helpers)); continue; }
    const reasons = values(object.reason, session, constants, {}, helpers); phaseStops.push(...reasons); add(session, object.reason.loc?.start.line, "stop", reasons);
  }
  const phaseReasons = [...new Set([...stopsOf(runner), ...phaseStops])].sort();
  scanCalls(session, "result", { "outcome.reason": [...new Set(stopsOf(pipeline))].sort(), "privateResult.reason": phaseReasons, "publicResult.reason": phaseReasons }, helpers);
  // The controller: every reason it stores, from its assignments and its record literals.
  const controller = "src/main/general-tasks/controller.ts", controllerTree = tree(controller);
  const controllerComputed = { "next.status": STATUSES, "record.status": STATUSES, "storedRunReason()": [], "caughtRunReason()": ["configuration_changed", "task_integrity_failed", "runtime_unavailable"] };
  for (const node of walk(controllerTree)) {
    if (node.type === "AssignmentExpression" && node.operator === "=" && (node.left as Node).type === "MemberExpression" && ((node.left as Node).property as Node).name === "reason") {
      add(controller, node.loc?.start.line, "record", values(node.right as Node, controller, constants, controllerComputed, new Map()));
    }
  }
  // Record literals only (a literal status): the snapshot get() returns carries the reason's text, never a code.
  for (const object of stopObjects(controllerTree)) {
    if (statusOf(object.status, controller, constants) !== "computed") add(controller, object.reason.loc?.start.line, "record", values(object.reason, controller, constants, controllerComputed, new Map()));
  }
  return sites;
}
