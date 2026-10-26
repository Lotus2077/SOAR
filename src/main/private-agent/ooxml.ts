import { canonical, digest } from "./contracts";
import { GeneralJobContractSchema, type ArtifactCheck } from "./runner";
import type { SessionFile, SessionPhase } from "./session";

/**
 * H4 deck validity check (BL-20261019-0431 follow-up): PowerPoint repaired three of six Phase 2 decks and dropped their
 * charts; python-pptx read-back and the structural zip check passed all six. This host-owned, standard-library check runs
 * in the qualified image's verifier beside the other finish checks and refuses the three defect classes Phase 2 produced
 * (non-integer EMU coordinates, data-label positions Office rejects for the chart type) and the structural faults any
 * OOXML consumer refuses (unreadable package, parts without a content type, unresolved relationships, malformed XML,
 * no slides, duplicate slide ids). It is not a schema validator: element order, other enumerations and duplicate series
 * indices are not covered, and the universal-measure coordinate form ("1in") is refused although the schema allows it.
 * The agent gets the same script as a pinned workspace file to run before finish; the host check embeds its own copy.
 */
export const DECK_CHECK_ID = "deck_ooxml_validity";
export const DECK_CHECK_VERSION = 1;
export const DECK_CHECK_PATH = "review/soar_deck_check.py";
const DECK_EXTENSION = /\.pptx$/iu;
const SAFE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\u0000-\u001f\\]{1,240}$/u;
/** Raw literal: no backticks or dollar-brace; `__PARAMS__` is replaced by base64 JSON so no path can break the script. */
export const DECK_CHECK_PY = String.raw`import base64, json, os, posixpath, re, sys, zipfile
import xml.etree.ElementTree as ET
P = json.loads(base64.b64decode('__PARAMS__'))
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
C = '{http://schemas.openxmlformats.org/drawingml/2006/chart}'
PR = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
# A relationship of these types must target a part of the matching content type, or Office drops the target.
TYPED = {'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide': SLIDE, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart': CHART}
PIE = {'bestFit', 'ctr', 'inEnd', 'outEnd'}; LINE = {'ctr', 'l', 'r', 't', 'b'}
# Office's rules for c:dLblPos by chart group (MS-OI29500 section 21.2.2.48); an empty set means the element may not appear.
POSITIONS = {'pieChart': PIE, 'pie3DChart': PIE, 'ofPieChart': PIE, 'lineChart': LINE, 'scatterChart': LINE, 'bubbleChart': LINE, 'stockChart': LINE,
             'areaChart': set(), 'area3DChart': set(), 'bar3DChart': set(), 'line3DChart': set(), 'doughnutChart': set(), 'radarChart': set()}
CLUSTERED = {'ctr', 'inBase', 'inEnd', 'outEnd'}
# A bar group's grouping defaults to clustered; "standard" (a 3D arrangement) is checked as clustered.
BAR = {'clustered': CLUSTERED, 'standard': CLUSTERED, 'stacked': {'ctr', 'inBase', 'inEnd'}, 'percentStacked': {'ctr', 'inBase', 'inEnd'}}
COORD = re.compile(r'-?[0-9]+$'); POSITIVE = re.compile(r'[0-9]+$')
MAX_PROBLEMS = 40; MAX_DETAIL = 200; MAX_OUTPUT = 65536
# The host check names its paths and runs in the verifier's /workspace; the workspace copy takes them from its command line and runs where it is.
root = os.path.realpath(P.get('root') or ('/workspace' if P.get('paths') else os.getcwd()))
def workspace_file(name):
    if not isinstance(name, str) or not name or len(name) > 240 or any(ord(ch) < 32 or ord(ch) in (92, 127) for ch in name): return None
    parts = name.split('/')
    if any(not part or part in ('.', '..') for part in parts): return None
    cur = root
    for part in parts:
        cur = os.path.join(cur, part)
        if os.path.islink(cur): return None
    if not os.path.realpath(cur).startswith(root + os.sep) or not os.path.isfile(cur): return None
    return cur
def resolve(source, target):
    if target.startswith('/'): return target.lstrip('/').lower()
    return posixpath.normpath(posixpath.join(posixpath.dirname(source), target)).lower()
def check(path):
    problems = []
    def add(code, detail=''):
        if len(problems) < MAX_PROBLEMS: problems.append(code + (':' + detail[:MAX_DETAIL] if detail else ''))
    try:
        z = zipfile.ZipFile(path)
    except Exception:
        return ['zip_unreadable']
    try:
        with z:
            if z.testzip() is not None: return ['zip_corrupt']
            names = [n for n in z.namelist() if not n.endswith('/')]
            # Part names are case-insensitive in a package; a name that appears twice is a package Office cannot read reliably.
            lower = {}
            for n in names:
                if n.lower() in lower: add('zip_duplicate_entry', n)
                lower[n.lower()] = n
            parsed = {}
            for n in names:
                if n.endswith('.xml') or n.endswith('.rels'):
                    try: parsed[n.lower()] = ET.fromstring(z.read(n))
                    except Exception: add('xml_malformed', n)
            types = parsed.get('[content_types].xml')
            defaults, overrides = {}, {}
            if types is None:
                add('content_types_missing')
            else:
                for item in types:
                    if item.tag == CT + 'Default': defaults[(item.get('Extension') or '').lower()] = item.get('ContentType') or ''
                    elif item.tag == CT + 'Override': overrides[(item.get('PartName') or '').lstrip('/').lower()] = item.get('ContentType') or ''
                for part, value in overrides.items():
                    if part not in lower: add('override_without_part', part)
                    elif not value: add('content_type_missing', lower[part])
            def content_type(key):
                return overrides.get(key) or defaults.get(key.rsplit('.', 1)[-1] if '.' in key else '')
            for key, n in lower.items():
                if key == '[content_types].xml': continue
                if types is not None and not content_type(key): add('content_type_missing', n)
            rels = {}
            for key, tree in parsed.items():
                if not key.endswith('.rels'): continue
                source = key[:-5].replace('_rels/', '', 1) if '_rels/' in key else key
                if key == '_rels/.rels': source = ''
                rels[key] = {}
                for rel in tree:
                    if rel.tag != REL + 'Relationship' or rel.get('TargetMode') == 'External': continue
                    target = resolve(source, rel.get('Target') or '')
                    rels[key][rel.get('Id')] = target
                    if target not in lower: add('relationship_target_missing', lower.get(key, key) + '->' + (rel.get('Target') or ''))
                    elif TYPED.get(rel.get('Type') or '') and content_type(target) != TYPED[rel.get('Type')]: add('relationship_type_mismatch', lower.get(key, key) + '->' + (rel.get('Target') or ''))
            pres = parsed.get('ppt/presentation.xml')
            if pres is None:
                add('presentation_missing')
            else:
                targets = rels.get('ppt/_rels/presentation.xml.rels', {})
                seen = set(); count = 0
                for sld in pres.iter(PR + 'sldId'):
                    count += 1
                    sid = sld.get('id')
                    if sid in seen: add('slide_id_duplicate', sid or '')
                    seen.add(sid)
                    target = targets.get(sld.get(R + 'id'))
                    if target is None or target not in lower or content_type(target) != SLIDE: add('slide_relationship_missing', sld.get(R + 'id') or '')
                if count == 0: add('no_slides')
            for key, tree in parsed.items():
                bad = 0
                for el in tree.iter():
                    if el.tag in (A + 'off', A + 'chOff'):
                        if not (COORD.match(el.get('x') or '') and COORD.match(el.get('y') or '')): bad += 1
                    elif el.tag in (A + 'ext', A + 'chExt'):
                        # a:extLst/a:ext is an extension element (a uri attribute, no size); only a size element carries cx and cy.
                        if el.get('uri') is not None and el.get('cx') is None and el.get('cy') is None: continue
                        if not (POSITIVE.match(el.get('cx') or '') and POSITIVE.match(el.get('cy') or '')): bad += 1
                if bad: add('coordinate_not_integer', lower.get(key, key) + ':' + str(bad))
            for key, tree in parsed.items():
                if content_type(key) != CHART: continue
                n = lower.get(key, key)
                for area in tree.iter(C + 'plotArea'):
                    for group in area:
                        tag = group.tag[len(C):] if group.tag.startswith(C) else ''
                        if tag == 'barChart':
                            grouping = group.find(C + 'grouping')
                            allowed = BAR.get(grouping.get('val') if grouping is not None else 'clustered')
                        else:
                            allowed = POSITIONS.get(tag)
                        if allowed is None: continue
                        flagged = set()
                        # The value lists apply at series and chart level (k2 L-Heavy-2's chart-level outEnd was repaired); the
                        # "shall not be specified" groups are checked inside c:ser only, where Office's rule is stated.
                        scopes = [group] if allowed else list(group.iter(C + 'ser'))
                        for scope in scopes:
                            for pos in scope.iter(C + 'dLblPos'):
                                val = pos.get('val') or ''
                                if val not in allowed and (tag, val) not in flagged:
                                    flagged.add((tag, val)); add('data_label_position_invalid', n + ':' + tag + ':' + val)
    except Exception:
        return ['zip_unreadable']
    return problems
paths = P.get('paths') or sys.argv[1:]
if not paths:
    print('usage: give the deck paths to check, for example output/deck.pptx', file=sys.stderr); sys.exit(2)
result = {'version': 1, 'passed': True, 'decks': {}}
for name in paths:
    target = workspace_file(name)
    problems = ['file_invalid'] if target is None else check(target)
    result['decks'][name] = {'passed': not problems, 'problems': problems}
    if problems: result['passed'] = False
out = json.dumps(result, sort_keys=True)
if len(out) > MAX_OUTPUT:
    for deck in result['decks'].values():
        deck['problems'] = sorted({p.split(':', 1)[0] for p in deck['problems']})
    out = json.dumps(result, sort_keys=True)
print(out); sys.exit(0 if result['passed'] else 1)
`;
export const DECK_CHECK_SHA256 = digest(DECK_CHECK_PY);

function params(paths: string[], root?: string): string {
  if (!paths.length || paths.length > 30 || new Set(paths).size !== paths.length || paths.some(path => !SAFE_PATH.test(path))) throw new Error("deck_check_paths_invalid");
  return Buffer.from(canonical({ version: DECK_CHECK_VERSION, paths, ...(root ? { root } : {}) })).toString("base64");
}

/** The finish check for the listed decks; `root` is for host-side tests only (the verifier's workspace is /workspace). */
export function deckValidityCheck(input: { paths: string[]; root?: string }): ArtifactCheck {
  return { id: DECK_CHECK_ID, python: DECK_CHECK_PY.replace("__PARAMS__", params(input.paths, input.root)) };
}

/** The same script as a workspace file; it takes the deck paths from its command line. */
export function deckCheckFile(): SessionFile {
  const script = DECK_CHECK_PY.replace("__PARAMS__", Buffer.from(canonical({ version: DECK_CHECK_VERSION, paths: [] })).toString("base64"));
  return { path: DECK_CHECK_PATH, bytes: Buffer.from(script, "utf8") };
}

/** The required artifacts the check applies to. */
export function deckArtifacts(phase: SessionPhase): string[] {
  return phase.contract.requiredArtifacts.map(artifact => artifact.path).filter(path => DECK_EXTENSION.test(path));
}

function shellWord(value: string): string { return `'${value.replace(/'/gu, "'\\''")}'`; }

/** What the agent is told; the check, not this text, decides. */
export function deckValidityInstructions(paths: string[]): string {
  return [
    `Deck validity (host-checked). PowerPoint repairs a deck it cannot open cleanly and drops the content it repaired, so at finish the host validates ${paths.join(", ")} in a separate container: the package opens; every part has a content type and every relationship resolves; every XML part is well-formed; the presentation lists at least one slide with unique ids; every a:off and a:ext coordinate is an integer number of EMUs (914400 per inch; never a decimal or an inch value); and every data-label position (c:dLblPos) is one Office accepts for its chart type: clustered bar ctr, inBase, inEnd, outEnd; stacked bar ctr, inBase, inEnd; line, scatter, bubble and stock ctr, l, r, t, b; pie bestFit, ctr, inEnd, outEnd; area, 3D, doughnut and radar charts none at all.`,
    `Before finish run python3 -I ${DECK_CHECK_PATH} ${paths.map(shellWord).join(" ")}; it prints the problems the host's check will fail on, with the part and the value. Fix the deck, never the script: the host runs its own copy of ${DECK_CHECK_PATH}.`,
  ].join("\n");
}

/** Adds the check, the workspace copy and the instructions to a phase whose required artifacts include a deck; a phase without one is returned unchanged. */
export function withDeckValidity(phase: SessionPhase): SessionPhase {
  const paths = deckArtifacts(phase);
  if (!paths.length) return phase;
  if (phase.files.some(file => file.path === DECK_CHECK_PATH) || phase.contract.requiredArtifacts.some(artifact => artifact.path === DECK_CHECK_PATH) ||
      phase.checks.some(check => check.id === DECK_CHECK_ID) || phase.contract.requiredChecks.includes(DECK_CHECK_ID)) throw new Error("deck_check_path_taken");
  const contract = { ...phase.contract, goal: `${phase.contract.goal}\n${deckValidityInstructions(paths)}`, requiredChecks: [...phase.contract.requiredChecks, DECK_CHECK_ID] };
  if (!GeneralJobContractSchema.safeParse(contract).success) throw new Error("deck_check_contract_limits");
  return { ...phase, contract, files: [...phase.files, deckCheckFile()], checks: [...phase.checks, deckValidityCheck({ paths })] };
}
