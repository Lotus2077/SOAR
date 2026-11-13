/**
 * Backlog item 10 (BL-20261113-0920-assist-wrapper-design, decision 5, as the code reviews refined it): what an assist
 * packet's text may hold. Source identities become their opaque ids (`S{n}`), file names from the host's appended text
 * `[file]`, then every URL `[url]`, file path `[file]` and digest `[digest]`, pass after pass until one changes nothing. The
 * audit reads the finished strings again the same way, and model-written text for copied source text.
 *
 * Every pattern reads a view that keeps each UTF-16 index of the text: full-width ASCII forms read as ASCII, and source
 * forms are compared case-folded. Source forms are found through rolling hashes indexed by their first four characters and
 * their lengths, never by one regex of every form, and each generic pattern starts only where a run of its characters
 * starts. Every scan is linear in its text but one: in model-written text the bare-file-name scan also starts after an
 * apostrophe that follows a spaceless-script letter, inside such a run, so it is quadratic on that letter, an apostrophe and
 * a name character repeated (`汉'a汉'a…`). The callers' length caps on model-written text bound it. A letter or digit of the
 * same script bounds a name. In scripts written without spaces (CJK, Thai and their kin) a name may touch its neighbours,
 * and their letters belong to a path, URL or file name only where a connector (`/`, `.`, `=` and the like) touches them.
 */
import { domainToUnicode } from "node:url";
import type { ResearchSourceIdentity } from "./research-contract";
import { normalizeQuoteText } from "./research-coverage";

export const ASSIST_PLACEHOLDERS = Object.freeze({ digest: "[digest]", source: "[source]", url: "[url]", file: "[file]" });
/** The shortest source form (a name, a host, a path) treated as naming a source. */
export const ASSIST_NAME_MIN_CHARS = 4;
/** A name without its extension names its source in model-written text when it is this long and holds a digit, `_` or `-`. */
export const ASSIST_STEM_MIN_CHARS = 6;
/** A path segment of letters and digits this long names its source in model-written text (an opaque document id). */
export const ASSIST_OPAQUE_SEGMENT_MIN_CHARS = 16;
/** Any hexadecimal piece this long of a digest the request holds or implies is a digest. */
export const ASSIST_DIGEST_PART_MIN = 8;
/** Bare file names with these extensions are file names in model-written text, whoever they name. */
export const ASSIST_FILE_EXTENSIONS: readonly string[] = Object.freeze(["pdf", "doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx", "csv", "tsv", "json", "jsonl", "xml", "html", "htm",
  "md", "txt", "rtf", "odt", "ods", "odp", "zip", "tar", "gz", "tgz", "7z", "rar", "ipynb", "sql", "sqlite", "db", "log", "yaml", "yml", "toml", "png", "jpg", "jpeg", "gif", "svg",
  "mp4", "mov", "mp3", "wav", "epub", "eml", "msg", "key", "pages", "numbers", "bak"]);

// ---- Characters, views and boundaries ----
/** Scripts written without spaces between words, and the CJK punctuation and full-width blocks. */
const SPACELESS = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}\\p{sc=Thai}\\p{sc=Lao}\\p{sc=Khmer}\\p{sc=Myanmar}\\u3000-\\u303f\\uff00-\\uffef";
/** A letter, digit or mark of a spaceless script; and a spaceless character that is none of those (CJK punctuation). */
const SL = `(?:(?=[${SPACELESS}])[\\p{L}\\p{N}\\p{M}])`, SL_PUNCT = `(?:(?![\\p{L}\\p{N}\\p{M}])[${SPACELESS}])`;
const SL_LETTER = new RegExp(`^${SL}$`, "u");
/** A boundary character: a letter or decimal digit outside the spaceless scripts (a superscript or circled number is not one). */
const WORD_CHAR = new RegExp(`^(?![${SPACELESS}])[\\p{L}\\p{Nd}]$`, "u");
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu, HYPHENS = /[\u2010\u2011]/gu;
/** A run of more than 30 combining marks keeps its first 30: no text needs more, and normalizing a longer run costs its square. */
const MARK_FLOOD = /(\p{M}{30})\p{M}+/gu;
/** NFC, default-ignorable code points (zero-width spaces, soft hyphens) removed, Unicode hyphens as "-": how text is matched and sent. */
export const textForm = (text: string) => text.replace(MARK_FLOOD, "$1").normalize("NFC").replace(IGNORABLE, "").replace(HYPHENS, "-");
/** The audit's stricter view of source forms: NFKC, so ligatures and compatibility variants of a name are found too. */
export const auditForm = (text: string) => text.replace(MARK_FLOOD, "$1").normalize("NFKC").replace(IGNORABLE, "").replace(HYPHENS, "-");
/** Full-width ASCII forms and the ideographic space read as ASCII, one UTF-16 unit for one: the view every pattern reads. */
const wide = (text: string) => text.replace(/[\uff01-\uff5e\u3000]/gu, character => character === "\u3000" ? " " : String.fromCharCode(character.charCodeAt(0) - 0xfee0));
/** Lowercase that keeps every UTF-16 index, with the Turkish i letters folded together (İ, I, ı and i) and a final sigma as sigma. */
const fold = (text: string) => text.replace(/İ/gu, "i").toLowerCase().replace(/[ıς]/gu, character => character === "ı" ? "i" : "σ");
const codePointBefore = (text: string, index: number): string | undefined => {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  return low >= 0xdc00 && low <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text[index - 1];
};
const codePointAt = (text: string, index: number): string | undefined => { const point = text.codePointAt(index); return point === undefined ? undefined : String.fromCodePoint(point); };
const isWord = (character: string | undefined) => character !== undefined && WORD_CHAR.test(character);
const SCRIPTS: readonly (readonly [string, RegExp])[] = ["Latin", "Cyrillic", "Greek", "Armenian", "Georgian", "Hebrew", "Arabic", "Syriac", "Thaana", "Devanagari", "Bengali",
  "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Tibetan", "Ethiopic", "Mongolian"].map(name => [name, new RegExp(`^\\p{sc=${name}}$`, "u")] as const);
const scriptOf = (character: string) => /^\p{Nd}$/u.test(character) ? "digit" : SCRIPTS.find(([, test]) => test.test(character))?.[0] ?? "other";
/**
 * Whether `neighbour` glues to a match whose edge character is `edge`: a word character of the edge's own script, or a digit
 * beside a letter (`metadata.md` holds no `data.md`; `בalpha.md` and `alpha.md¹` name `alpha.md`). Nothing glues to a
 * spaceless-script edge, and any word character glues to an edge that is not one (`x_draft.md`).
 */
function glues(neighbour: string | undefined, edge: string | undefined): boolean {
  if (!isWord(neighbour)) return false;
  if (!isWord(edge)) return !(edge !== undefined && SL_LETTER.test(edge));
  const a = scriptOf(neighbour!), b = scriptOf(edge!);
  return a === b || a === "digit" || b === "digit";
}
/** Whether a match starting at `index` is glued to a word before it. An escape (`\n`) or a percent-encoded byte (`%20`) before it is a boundary. */
function gluedBefore(text: string, index: number): boolean {
  if (!glues(codePointBefore(text, index), codePointAt(text, index))) return false;
  if (index >= 2 && text[index - 2] === "\\") return false;
  return !(index >= 3 && /^%[0-9a-f]{2}$/iu.test(text.slice(index - 3, index)));
}
const gluedAfter = (text: string, index: number) => glues(codePointAt(text, index), codePointBefore(text, index));
const tally = (text: string, character: string) => { let count = 0; for (let at = text.indexOf(character); at >= 0; at = text.indexOf(character, at + 1)) count++; return count; };

// ---- The generic patterns, applied after the source forms, in the wide view ----
/** A character a URL or path runs through (not a space, quote, angle bracket or spaceless-script character), and through an apostrophe inside it. */
const RUN = `[^\\s"'<>${SPACELESS}]`, RUN_Q = `(?:${RUN}|'(?=${RUN}))`;
/** What joins the pieces of a URL, path or file name. */
const CONNECT = "/\\\\?#&=;,:.+@~%_-";
/**
 * Spaceless-script letters inside a URL, path or file name: a whole run of them that a connector touches (`/人事/`, `=张三&`,
 * `合并计划.docx`). A run glued to other letters with no connector is prose after the path (`/Acme里有`) and is left. Each run
 * can be taken one way only, so no pattern that holds one backtracks more than linearly.
 */
const SL_PIECE = `(?:(?<=[${CONNECT}])${SL}+(?!${SL})|(?<![${CONNECT}])${SL}+(?=[${CONNECT}]))`;
/** A character of a URL or path body: a run character, or such a piece. */
const BODY = `(?:${RUN_Q}|${SL_PIECE})`;
const TLDS = ["com", "org", "net", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "io", "ai", "app", "dev", "xyz", "online", "site", "tech", "cloud", "page", "blog", "news",
  "wiki", "store", "shop", "media", "agency", "global", "group", "company", "world", "today", "live", "life", "link", "space", "website", "academy", "institute", "foundation",
  "health", "law", "museum", "aero", "coop", "jobs", "mobi", "travel", "asia", "cat", "post", "example", "test", "local", "localhost", "internal", "corp", "home", "lan", "intranet"];
/** Two-letter labels that are file extensions more often than country domains, so `Node.js/Deno` stays prose. */
const NOT_TLDS = ["js", "ts", "py", "rb", "go", "rs", "cs", "md", "sh", "pl", "hs", "kt", "cc"];
const TLD = `(?:(?!(?:${NOT_TLDS.join("|")})(?![a-z]))[a-z]{2}|${TLDS.join("|")})(?![a-z0-9-])`;
const URL_PATTERNS: readonly RegExp[] = Object.freeze([
  new RegExp(`(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\\/\\/${BODY}+`, "giu"),
  // Schemes without slashes, each only in its own shape (`mailto:` an address, `tel:` a number, `doi:10.`), so `data:clean` stays prose.
  new RegExp(`(?<![a-z0-9+.-])(?:mailto:(?=[^\\s@]{1,64}@)|(?:tel|sms|callto):(?=[+(\\d])|data:(?=[a-z]+\\/|[,;])|file:(?=[/\\\\])|urn:(?=[a-z0-9-]{1,32}:)|doi:(?=10\\.)|magnet:(?=\\?)|geo:(?=-?\\d)|skype:(?=[a-z0-9]))${BODY}+`, "giu"),
  // A protocol-relative URL after a space, quote, bracket, or `=`, `:`, `,` or `;` (`src=//cdn.example/x.js`).
  new RegExp(`(?<![^\\s"'(\\[<=:,;${SPACELESS}])\\/\\/(?=[a-z0-9]|${SL})${BODY}+`, "giu"),
  // A `www.` host, its labels ASCII or spaceless-script letters each (`www.例子.测试/秘密`; `www.example.org上的年报` ends at `org`).
  new RegExp(`(?<![a-z0-9_./@-])www\\.(?:[a-z0-9-]+|${SL}+)(?:\\.(?:[a-z0-9-]+|${SL}+))+(?::\\d{1,5})?(?:\\/${BODY}*)?`, "giu"),
  new RegExp(`(?<![a-z0-9_./@:-])(?:[a-z0-9-]+\\.)+${TLD}(?::\\d{1,5})?\\/${BODY}*`, "giu"),
  // A scheme-less URL with `user:password@` before a dotted host is a credential: replaced with or without a path (`alice:pw@acme.example`).
  new RegExp(`(?<![a-z0-9_./@:-])[a-z0-9._~%!$&*+,;=-]{1,64}:[^\\s/@"'<>]{1,64}@(?:[a-z0-9-]+\\.)+[a-z0-9-]+(?::\\d{1,5})?(?:\\/${BODY}*)?`, "giu"),
  // An IPv4 address with a port or a path, but not a bare network prefix (`10.0.0.0/8`).
  new RegExp(`(?<![\\d.])(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d{1,5}(?:\\/${BODY}*)?|\\/(?!\\d{1,2}(?![\\w./-]))${BODY}*)`, "gu"),
  // A single-label `localhost` with a port or a path, and a bracketed IPv6 address with a port or a path (`[::2]` alone is a slice).
  new RegExp(`(?<![a-z0-9_./@-])localhost(?::\\d{1,5}(?:\\/${BODY}*)?|\\/${BODY}*)`, "giu"),
  new RegExp(`(?<![a-z0-9_./@:\\]-])\\[(?=[0-9a-f:.]{0,40}::|(?:[0-9a-f]{1,4}:){7})[0-9a-f:.]{2,45}(?:%[a-z0-9]{1,16})?\\](?::\\d{1,5}(?:\\/${BODY}*)?|\\/${BODY}*)`, "giu"),
]);
const SEGMENT = `[^\\s/\\\\"'<>${SPACELESS}]`, SEGMENT_Q = `(?:${SEGMENT}|'(?=${SEGMENT}))`;
/** A path segment character: a segment character, or spaceless-script letters a connector touches. */
const SEG = `(?:${SEGMENT_Q}|${SL_PIECE})`;
/**
 * A file extension: two to sixteen letters and digits, one a letter, after a dot that does not stand between two digits
 * (`2.5kg`), not a capitalized word (`h.It`), and followed by no letter, digit, `_` or `-` of a spaced script
 * (`合并计划.docx里` ends at `docx`). The patterns that hold it are case-sensitive.
 */
const EXT = `(?:(?<![0-9])\\.|\\.(?![0-9]))(?![A-Z][a-z])(?=[a-zA-Z0-9]{0,15}[a-zA-Z])[a-zA-Z0-9]{2,16}(?!(?![${SPACELESS}])[\\p{L}\\p{N}_-])`;
/**
 * Where a rooted path starts: not inside a word or a path (`and/or`, `a/b`, `Москва/Казань`). Spaceless-script letters glued
 * before it go with it when its first segment begins with an ASCII letter or digit (`资料/2024/report.pdf`, `文件在/Users/…`),
 * and a CJK list (`中国/日本/韩国`) is no path. A run of them is tried once, from its start, so the rule stays linear.
 */
const ROOTED = `(?<![\\p{L}\\p{N}_./~:\\\\-])`, GLUED_PREFIX = `(?:${SL}+(?=[/\\\\][a-zA-Z0-9]))?`;
/** A quoted path may hold spaces, but only one that starts like a path (`"/Users/…"`, `"C:\…"`, `"~/…"`, `"%APPDATA%\…"`, `"./…"`). */
const PATH_LIKE = `(?=[/\\\\~]|[a-zA-Z]:[\\\\/]|%[a-zA-Z_][a-zA-Z0-9_]*%|\\.{1,2}[/\\\\]|\\$[a-zA-Z_][a-zA-Z0-9_]*[/\\\\])`;
const PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  new RegExp(`"${PATH_LIKE}[^"\\n]{0,300}?[/\\\\][^"\\n]{0,300}?${EXT}"|“${PATH_LIKE}[^“”\\n]{0,300}?[/\\\\][^“”\\n]{0,300}?${EXT}”`, "gu"),
  new RegExp(`(?<![a-z0-9])[a-z]:[\\\\/]${BODY}+`, "giu"),
  new RegExp(`\\\\\\\\${SEG}+\\\\${BODY}+`, "gu"),
  new RegExp(`%[a-z_][a-z0-9_]*%[\\\\/]${BODY}+`, "giu"),
  new RegExp(`(?<![a-z0-9_./-])~[\\\\/]${BODY}+`, "giu"),
  new RegExp(`${ROOTED}${GLUED_PREFIX}\\/(?:${SEG}+\\/+){2,}${SEG}*`, "gu"),
  // A rooted path with an extension, under either slash (`/merger-plan.docx`, `\Users\alice\plan.docx`).
  new RegExp(`${ROOTED}${GLUED_PREFIX}[/\\\\](?:${SEG}+[/\\\\]+)*${SEG}+${EXT}`, "gu"),
]);
/**
 * A relative path's run: folder segments (empty ones allowed) and a last one, taken whole from the start of a run of path
 * characters only (a start inside the run would rescan it) and cut by `relativeEnd`; the lookahead and backreference make the
 * run atomic. A run starts after a space, quote, angle bracket, CJK punctuation or an escape (`\n`) that follows one of those,
 * or where a spaced-script run follows spaceless letters with no connector between.
 */
const RUN_START = `(?:(?<=^|[\\s"<>]|${SL_PUNCT}|(?<!${SEGMENT})'|(?:^|[\\s"'<>])\\\\[ntr])|(?<=${SL})(?=${SEGMENT}))`;
const RELATIVE_RUN = new RegExp(`${RUN_START}(?=((?:${SEG}+[/\\\\]+)+${SEG}+))\\1`, "gu");
const RUN_STARTS = new RegExp(RUN_START, "gu"), RUN_AT = new RegExp(RELATIVE_RUN.source, "yu"), SEGS_AT = new RegExp(`${SEG}+`, "yu");
/**
 * The matches of RELATIVE_RUN, as matchAll gives them, in linear time. When no run matches at a start, the next start is looked
 * for after the path characters read from there: a start inside them reads a suffix of the same run, so it cannot match either.
 * matchAll would try each of those starts, and on CJK text joined by commas that rescans the run from each one.
 */
function* relativeRuns(view: string): Generator<RegExpExecArray> {
  for (let at = 0; at <= view.length;) {
    RUN_STARTS.lastIndex = at; const start = RUN_STARTS.exec(view); if (!start) return;
    RUN_AT.lastIndex = start.index; const match = RUN_AT.exec(view);
    if (match) { yield match; at = match.index + match[0].length; continue; }
    SEGS_AT.lastIndex = start.index; const read = SEGS_AT.exec(view);
    at = Math.max(start.index + (codePointAt(view, start.index)?.length ?? 1), read ? start.index + read[0].length : 0);
  }
}
const EXTENSION_AT = new RegExp(`^[a-zA-Z0-9]{2,16}(?!(?![${SPACELESS}])[\\p{L}\\p{N}_-])`, "u"), NAMED = /^[\p{L}\p{N}\p{M}_-]$/u;
/** Whether an extension reads as one: a letter in it, not a capitalized word (`It`, `Then`), not a decimal's digits after a digit (`2.5`). */
const extensionLike = (extension: string, before: string | undefined) =>
  /[a-zA-Z]/u.test(extension) && !/^[A-Z][a-z]/u.test(extension) && !(before !== undefined && /^[0-9]$/u.test(before) && /^[0-9]/u.test(extension));
/**
 * Where the longest relative path that begins `run` ends, or -1: at least one folder, then a last segment holding a letter,
 * digit, `_` or `-` of any script before an extension that reads as one. One pass, so a run of any length costs its length.
 */
function relativeEnd(run: string): number {
  let best = -1, folders = 0, named = false, afterSeparator = true, previous: string | undefined;
  for (let i = 0; i < run.length;) {
    const character = String.fromCodePoint(run.codePointAt(i)!);
    if (character === "/" || character === "\\") { if (!afterSeparator) folders++; named = false; afterSeparator = true; }
    else {
      afterSeparator = false;
      if (character === "." && folders > 0 && named) {
        const extension = EXTENSION_AT.exec(run.slice(i + 1, i + 18))?.[0];
        if (extension && extensionLike(extension, previous)) best = i + 1 + extension.length;
      }
      if (NAMED.test(character)) named = true;
    }
    previous = character; i += character.length;
  }
  return best;
}
/** A character of a bare file name: not a space, quote, angle bracket, slash or `;:!?`, spaceless-script letters included. */
const NAME_CLASS = `[^\\s/\\\\"'<>;:!?${SPACELESS}]`, NAME_CHAR = `(?:${NAME_CLASS}|${SL}|'(?=${NAME_CLASS}))`;
/**
 * Where a bare file name may start: where a run of its characters starts, or after an escape (`\n`) that follows a space.
 * An apostrophe after a spaceless-script letter is such a start too, though the run goes on through it: on that letter, an
 * apostrophe and a name character repeated, the scan is quadratic, and only the callers' length caps bound it.
 */
const NAME_START = `(?<=^|[\\s"<>;:!?]|${SL_PUNCT}|(?<!${NAME_CLASS})'|(?:^|[\\s"'<>])\\\\[ntr])`;
const FILE_EXTENSIONS = [...ASSIST_FILE_EXTENSIONS, ...ASSIST_FILE_EXTENSIONS.map(extension => extension.toUpperCase())];
/**
 * A bare file name with an allowlisted extension, lowercase or capitals: a file name in model-written text, whoever it names.
 * Its last character before the dot is a letter, digit, `_`, `-` or closing bracket of any script (`Отчёт.docx`, `plan(1).docx`).
 */
const FILE_NAME_PATTERN = new RegExp(`${NAME_START}${NAME_CHAR}*[\\p{L}\\p{N}\\p{M}_)\\]-](?:(?<![0-9])\\.|\\.(?![0-9]))(?:${FILE_EXTENSIONS.join("|")})(?!(?![${SPACELESS}])[\\p{L}\\p{N}_-])`, "gu");
/** A file name in the host's appended text: a name with an extension of two to eight letters. */
const HOST_FILE_TOKEN = new RegExp(`(?<![\\p{L}\\p{N}_./-])[\\p{L}\\p{N}_-][\\p{L}\\p{N}_.-]*\\.\\p{L}{2,8}(?![\\p{L}\\p{N}_-])`, "gu");
/**
 * A hexadecimal run, and hexadecimal groups of two or more joined by `-`, `:`, `.`, `_`, an en dash or white space
 * (`89:22:92:1f`, `8922.921f`), starting at a word's start (`ref 0b2d…` is no group of `ef`).
 */
const HEX_RUN = /[0-9a-f]{8,}/giu, HEX_GROUPS = /(?<![\p{L}\p{N}])[0-9a-f]{2,}(?:[-:._\s\u2013][0-9a-f]{2,})+/giu, HEX_JOINS = /[-:._\s\u2013]/gu;
/** A URL or path match with the sentence punctuation (and the unbalanced closing brackets) that followed it left outside. Linear. */
function trimToken(token: string): { core: string; tail: string } {
  const surplus = new Map<string, number>([[")", tally(token, ")") - tally(token, "(")], ["]", tally(token, "]") - tally(token, "[")], ["}", tally(token, "}") - tally(token, "{")]]);
  let end = token.length;
  while (end > 0) {
    const last = token[end - 1]!, extra = surplus.get(last);
    if (/[.,;:!?'"]/u.test(last)) end--;
    else if (extra !== undefined && extra > 0) { surplus.set(last, extra - 1); end--; }
    else break;
  }
  return { core: token.slice(0, end), tail: token.slice(end) };
}
/** The opening brackets a path or file-name match took from before it (`(plan.docx)`), which stay outside its placeholder. */
function openingLead(token: string): string {
  const surplus = new Map<string, number>([["(", tally(token, "(") - tally(token, ")")], ["[", tally(token, "[") - tally(token, "]")], ["{", tally(token, "{") - tally(token, "}")]]);
  let lead = "";
  for (const character of token) { const left = surplus.get(character); if (left === undefined || left <= 0) break; surplus.set(character, left - 1); lead += character; }
  return lead;
}
/** The matches of a pattern in a view: matchAll for a global pattern, or a walk such as relativeRuns. */
type Finder = RegExp | ((view: string) => Iterable<RegExpMatchArray>);
const findAll = (view: string, finder: Finder): Iterable<RegExpMatchArray> => finder instanceof RegExp ? view.matchAll(finder) : finder(view);
/**
 * A provisional replacement in a text (see formScanner), and what it becomes when no URL or path rule takes it. An `alias` mark
 * holds a source's alias and takes `placeholder` back. A `url` mark holds `placeholder` and takes the URL's rest after it, and
 * with `slashes` the `//` before it too, as `[url]`.
 */
interface Mark { start: number; end: number; kind: "alias" | "url"; placeholder: string; slashes: boolean }
/** The rest of a URL or path after a position: its body characters, as the URL rules read them. */
const URL_REST = new RegExp(`${BODY}*`, "uy");
/** What a rule replaces inside its match: the characters from `from` to `to` become `placeholder`, and the rest of the match stays. */
interface Cut { from: number; to: number; placeholder: string }
/**
 * Replaces, in the text and the view, what `cut` returns for each match (undefined keeps it). A mark the replaced characters
 * touch goes with them; every other mark moves with the text.
 */
function replaceBoth(state: { text: string; view: string; marks: readonly Mark[] }, finder: Finder, cut: (original: string, viewed: string) => Cut | undefined): void {
  let text = "", view = "", last = 0, shift = 0, next = 0, changed = false;
  const marks: Mark[] = [], moved = (mark: Mark) => marks.push({ ...mark, start: mark.start + shift, end: mark.end + shift });
  for (const match of findAll(state.view, finder)) {
    const start = match.index!, swap = cut(state.text.slice(start, start + match[0].length), match[0]);
    if (swap === undefined) continue;
    const from = start + swap.from, to = start + swap.to;
    for (; next < state.marks.length && state.marks[next]!.start < to; next++) if (state.marks[next]!.end <= from) moved(state.marks[next]!);
    text += state.text.slice(last, from) + swap.placeholder; view += state.view.slice(last, from) + wide(swap.placeholder);
    shift += swap.placeholder.length - (to - from); last = to; changed = true;
  }
  if (!changed) return;
  for (; next < state.marks.length; next++) moved(state.marks[next]!);
  state.text = text + state.text.slice(last); state.view = view + state.view.slice(last); state.marks = marks;
}

// ---- Source forms ----
/** `name`: bounded by words, absorbs extensions after it and a folder prefix before it. `host`: bounded, never part of a longer host, absorbs a path after it. `url`/`path`: plain, absorb a path after them. */
type FormKind = "name" | "host" | "url" | "path";
/** `model`: matched in model-written text only (gists, plan text), where a stem or a bare host names a file; in the brief and quotes it is a word. */
type Form = { text: string; replacement: string; kind: FormKind; scope: "all" | "model" };
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const EXTENSION = /\.[\p{L}\p{N}]{1,16}$/u, EXTENSIONS = /(?:\.[\p{L}\p{N}]{1,16})+$/u;
const decodedUri = (value: string) => { try { return decodeURI(value); } catch { return value; } };
const points = (text: string) => [...text].length;
const distinctive = (text: string) => points(text) >= ASSIST_STEM_MIN_CHARS && /[\p{N}_-]/u.test(text);
const opaque = (text: string) => points(text) >= ASSIST_OPAQUE_SEGMENT_MIN_CHARS && /^[\p{L}\p{N}_-]+$/u.test(text) && /\p{L}/u.test(text) && /\p{N}/u.test(text);
/** The forms of a name: itself, and in model-written text its distinctive stems. */
function nameForms(name: string, replacement: string): Form[] {
  const forms: Form[] = [];
  if (EXTENSION.test(name) && /[^.]\./u.test(name)) forms.push({ text: name, replacement, kind: "name", scope: "all" });
  for (const stem of new Set([name.replace(EXTENSION, ""), name.replace(EXTENSIONS, "")])) if (stem && stem !== name && distinctive(stem)) forms.push({ text: stem, replacement, kind: "name", scope: "model" });
  if (!EXTENSION.test(name) && distinctive(name)) forms.push({ text: name, replacement, kind: "name", scope: "model" });
  return forms;
}
/** Every string by which a packet could name source n. */
function sourceForms(source: ResearchSourceIdentity, alias: string): Form[] {
  const forms: Form[] = [];
  for (const value of new Set([source.id, source.path])) {
    let url: URL | undefined;
    if (SCHEME.test(value)) { try { url = new URL(value); } catch { url = undefined; } }
    if (url) {
      const unicode = domainToUnicode(url.hostname) || url.hostname;
      // A URL's whole forms leave out its query and fragment: a matched form takes whatever path, query or fragment follows it.
      const wholes = new Set<string>();
      for (const whole of [value, url.href]) if (!/[?#]/u.test(whole)) wholes.add(whole);
      for (const host of new Set([url.host, url.host.replace(url.hostname, unicode)])) {
        const base = `${host}${url.pathname}`;
        for (const form of [`${url.protocol}//${base}`, base]) { wholes.add(form); wholes.add(form.replace(/\/+$/u, "")); }
      }
      for (const form of [...wholes]) wholes.add(decodedUri(form));
      for (const form of wholes) if (form !== url.hostname && form !== unicode && form !== url.host) forms.push({ text: form, replacement: alias, kind: "url", scope: "all" });
      // A dotted host names its source everywhere, with or without `www.`; a single-label intranet host only in model-written text.
      const hosts = new Set([url.hostname, unicode, url.host]);
      for (const host of [...hosts]) if (/^www\./iu.test(host) && host.slice(4).includes(".")) hosts.add(host.slice(4));
      for (const host of hosts) forms.push({ text: host, replacement: alias, kind: "host", scope: host.includes(".") ? "all" : "model" });
      // A file named in the query (`viewer?file=minutes-2025.pdf`) or the fragment names the source as its path does.
      for (const part of [...url.searchParams.values(), decodedUri(url.hash.slice(1))]) {
        const name = part.split(/[/\\]/u).filter(Boolean).at(-1) ?? "";
        if (EXTENSION.test(name) && /[^.]\./u.test(name)) forms.push(...nameForms(name, alias));
        else if (points(name) >= 8 && distinctive(name) && /\p{L}/u.test(name)) forms.push({ text: name, replacement: alias, kind: "name", scope: "model" });
      }
    } else {
      forms.push({ text: value, replacement: alias, kind: "path", scope: "all" }, { text: value.replaceAll("/", "%2F"), replacement: alias, kind: "path", scope: "all" });
      const decoded = decodedUri(value); if (decoded !== value) forms.push({ text: decoded, replacement: alias, kind: "path", scope: "all" });
    }
    const segments = decodedUri(url ? url.pathname : value).split("/").filter(Boolean);
    // The last two and three segments name their file as surely as the whole path ("corpus/alpha.md"); deeper folders are absorbed.
    for (const size of [2, 3]) if (segments.length >= size && (url || segments.length > size)) forms.push({ text: segments.slice(-size).join("/"), replacement: alias, kind: "name", scope: "all" });
    for (const segment of segments) if (opaque(segment)) forms.push({ text: segment, replacement: alias, kind: "name", scope: "model" });
    const name = segments.at(-1);
    if (name) forms.push(...nameForms(name, alias));
  }
  return forms.filter(form => points(form.text) >= ASSIST_NAME_MIN_CHARS);
}
/** File names and paths in the text the driver or session appended to the brief (claims ledger, evidence contract, transfer note). */
function hostFileForms(suffix: string): Form[] {
  const relative = [...relativeRuns(suffix)].flatMap(match => { const end = relativeEnd(match[0]); return end < 0 ? [] : [match[0].slice(0, end)]; });
  const tokens = new Set([...[...PATH_PATTERNS, HOST_FILE_TOKEN].flatMap(pattern => [...suffix.matchAll(pattern)].map(match => trimToken(match[0].replace(/^["“]|["”]$/gu, "")).core)), ...relative]);
  return [...tokens].flatMap(token => {
    const name = token.split(/[/\\]/u).at(-1)!;
    return [...(token !== name ? [{ text: token, replacement: ASSIST_PLACEHOLDERS.file, kind: "path" as const, scope: "all" as const }] : []), ...nameForms(name, ASSIST_PLACEHOLDERS.file)];
  }).filter(form => points(form.text) >= ASSIST_NAME_MIN_CHARS);
}
const KIND_RANK: Readonly<Record<FormKind, number>> = { host: 3, name: 2, url: 1, path: 0 };
/**
 * `dotted`: the form holds a dot, so a name with an extension; such a name takes the decimal digits glued to it.
 * `hostLed`: the form starts with the source's host (a host, or a URL form written without its scheme).
 */
interface Entry { folded: string; replacement: string; kind: FormKind; dotted: boolean; hostLed: boolean }
const hostLed = (kind: FormKind, folded: string) => kind === "host" || (kind === "url" && !SCHEME.test(folded));
const HASH_BASE = 0x01000193;
const stringHash = (text: string) => { let hash = 0; for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, HASH_BASE) + text.charCodeAt(i)) | 0; return hash; };
/** The hash of any span of `text` in two lookups, from its prefix hashes (the same hash as `stringHash` of the span). */
function spanHasher(text: string): (start: number, end: number) => number {
  const hashes = new Int32Array(text.length + 1), powers = new Int32Array(text.length + 1);
  powers[0] = 1;
  for (let i = 0; i < text.length; i++) { hashes[i + 1] = (Math.imul(hashes[i]!, HASH_BASE) + text.charCodeAt(i)) | 0; powers[i + 1] = Math.imul(powers[i]!, HASH_BASE); }
  return (start, end) => (hashes[end]! - Math.imul(hashes[start]!, powers[end - start]!)) | 0;
}
/**
 * The scanner over one scope's forms. Forms equal under the fold merge: two sources' form names neither (`[source]`), a
 * source's form wins over a host file name, and a bounded kind wins over a plain one (a root URL's bare host stays bounded).
 * At each position it looks up only the lengths of the forms that share the text's next four characters, each by one hash, so
 * the cost per position does not grow with the number of sources or with how long a prefix they share.
 */
function formScanner(forms: readonly Form[], normalize: (text: string) => string) {
  const table = new Map<string, Entry>();
  for (const form of forms) {
    const folded = fold(wide(normalize(form.text))), prior = table.get(folded);
    if (folded.length < ASSIST_NAME_MIN_CHARS) continue;
    if (!prior) { table.set(folded, { folded, replacement: form.replacement, kind: form.kind, dotted: folded.includes("."), hostLed: hostLed(form.kind, folded) }); continue; }
    const file = (value: string) => value === ASSIST_PLACEHOLDERS.file;
    const replacement = prior.replacement === form.replacement ? prior.replacement : file(prior.replacement) ? form.replacement : file(form.replacement) ? prior.replacement : ASSIST_PLACEHOLDERS.source;
    const kind = KIND_RANK[form.kind] > KIND_RANK[prior.kind] ? form.kind : prior.kind;
    table.set(folded, { folded, replacement, kind, dotted: prior.dotted, hostLed: prior.hostLed || hostLed(form.kind, folded) });
  }
  const index = new Map<string, { lengths: number[]; byLength: Map<number, Map<number, Entry[]>> }>();
  for (const entry of table.values()) {
    const key = entry.folded.slice(0, ASSIST_NAME_MIN_CHARS);
    let bucket = index.get(key);
    if (!bucket) { bucket = { lengths: [], byLength: new Map() }; index.set(key, bucket); }
    let byHash = bucket.byLength.get(entry.folded.length);
    if (!byHash) { byHash = new Map(); bucket.byLength.set(entry.folded.length, byHash); bucket.lengths.push(entry.folded.length); }
    const hash = stringHash(entry.folded), list = byHash.get(hash);
    if (list) list.push(entry); else byHash.set(hash, [entry]);
  }
  for (const bucket of index.values()) bucket.lengths.sort((a, b) => b - a);
  // An extension is letters and digits outside the spaceless scripts and not a capitalized word: "alpha.md。记录" ends at "md",
  // "alpha.记录" at "alpha", and "alpha.md.Then" at "md".
  const EXTENSION_STEP = new RegExp(`\\.(?![A-Z][a-z])(?:(?![${SPACELESS}])[\\p{L}\\p{N}]){1,16}`, "uy");
  const CONTINUATION = new RegExp(`[/?#;,:](?=${BODY})${BODY}*`, "uy"), AFTER_SLASH = new RegExp(`${BODY}*`, "uy");
  const DIGIT = /^\p{Nd}$/u;
  /** Past the decimal digits glued after `end`. */
  const digitsAfter = (text: string, end: number) => { let at = end; while (DIGIT.test(codePointAt(text, at) ?? "")) at += (codePointAt(text, at) ?? "").length; return at; };
  /**
   * Where a name match ending at `raw` ends: with up to four extensions after it, the longest that no word glues to; undefined
   * when none. A name with an extension takes the digits glued after it first (`alpha.md1`, a quote's NFKC footnote mark).
   */
  const nameEnd = (text: string, raw: number, dotted: boolean): number | undefined => {
    const ends = [raw];
    while (ends.length <= 4) { EXTENSION_STEP.lastIndex = ends.at(-1)!; const step = EXTENSION_STEP.exec(text); if (!step) break; ends.push(ends.at(-1)! + step[0].length); }
    for (let k = ends.length - 1; k >= 0; k--) { const end = dotted ? digitsAfter(text, ends[k]!) : ends[k]!; if (!gluedAfter(text, end)) return end; }
    return undefined;
  };
  /** Where a URL, path or host match ends: a form that ends in "/" (a root URL) takes whatever path follows it; any other a path that starts with a separator. */
  const pathEnd = (text: string, raw: number): number => {
    const pattern = text[raw - 1] === "/" ? AFTER_SLASH : CONTINUATION;
    pattern.lastIndex = raw; const run = pattern.exec(text)?.[0];
    return run ? raw + trimToken(run).core.length : raw;
  };
  /**
   * The span a match of `entry` from `at` to `raw` really covers, or undefined when its boundaries refuse it. A name with an
   * extension takes the decimal digits glued before it too (`1alpha.md`, a list's NFKC circled number), and every span takes
   * the digits glued after it, so an alias is never followed by a digit (`S1` then `1` would read as `S11`).
   */
  const entrySpan = (text: string, at: number, raw: number, entry: Entry): { start: number; end: number } | undefined => {
    let start = at, end: number | undefined;
    if (entry.kind === "name") {
      if (entry.dotted) {
        // Digits after `%` or `\` belong to an escape (`%20alpha.md`), which is already a boundary.
        let back = start;
        while (DIGIT.test(codePointBefore(text, back) ?? "")) back -= (codePointBefore(text, back) ?? "").length;
        if (back < start && !/[%\\]/u.test(text[back - 1] ?? "")) start = back;
      }
      end = gluedBefore(text, start) ? undefined : nameEnd(text, raw, entry.dotted);
    } else if (entry.kind === "host") {
      // A host that goes on to the right is another host (`example.org.evil.test`); what is glued on its left goes with it (matches()).
      end = gluedAfter(text, raw) || text[raw] === "-" || (text[raw] === "." && isWord(codePointAt(text, raw + 1))) ? undefined : pathEnd(text, raw);
    } else end = pathEnd(text, raw);
    return end === undefined ? undefined : { start, end: digitsAfter(text, end) };
  };
  const SEGMENT_CHAR = new RegExp(`^(?:${SEGMENT}|${SL})$`, "u");
  /**
   * Where a name match really starts: a folder prefix glued to it ("Clients/Acme/alpha.md") goes with it, back to `floor`, and
   * so does the root slash of a rooted one ("/tmp/alpha.md"), but never the second slash of `//`, which leaves a URL for the
   * generic rules (`https://other.test/alpha.md?q` is `[url]`, not `https:/S1?q`). A UNC path's `\\` has no such guard: its
   * second backslash goes with the match, so one is left before it (`\\fileserver\share\old-alpha.md` is `\[file]`).
   */
  const absorbPrefix = (text: string, start: number, floor: number) => {
    let at = start;
    while (at > floor && (text[at - 1] === "/" || text[at - 1] === "\\")) {
      let back = at - 1;
      while (back > floor && SEGMENT_CHAR.test(codePointBefore(text, back) ?? "")) back -= (codePointBefore(text, back) ?? "").length;
      if (back === at - 1) { if (at < start && !SEGMENT_CHAR.test(codePointBefore(text, back) ?? "") && text[back - 1] !== "/") at = back; break; }
      at = back;
    }
    return at;
  };
  const NAME_RUN_CHAR = new RegExp(`^(?![${SPACELESS}])[\\p{L}\\p{N}\\p{M}_.-]$`, "u"), NAME_WORD = new RegExp(`^(?![${SPACELESS}])[\\p{L}\\p{N}\\p{M}]$`, "u");
  /** Where a file name's run starts when `-`, `_` or `.` glues more name before it (`secret-merger-report.md`), back to `floor`. */
  const nameRunStart = (text: string, start: number, floor: number) => {
    if (start - 1 <= floor || !/[-_.]/u.test(text[start - 1] ?? "") || !NAME_WORD.test(codePointBefore(text, start - 1) ?? "")) return start;
    let at = start;
    while (at > floor && NAME_RUN_CHAR.test(codePointBefore(text, at) ?? "")) at -= (codePointBefore(text, at) ?? "").length;
    return at;
  };
  /** Where a file name's run ends when `-` or `_` glues more name after it (`report.md-secret`), short of a trailing `-`, `_` or `.` (a full stop). */
  const nameRunEnd = (text: string, end: number) => {
    if (!/[-_]/u.test(text[end] ?? "") || !NAME_WORD.test(codePointAt(text, end + 1) ?? "")) return end;
    let at = end;
    while (NAME_RUN_CHAR.test(codePointAt(text, at) ?? "")) at += (codePointAt(text, at) ?? "").length;
    while (at > end && /[-_.]/u.test(text[at - 1] ?? "")) at--;
    return at;
  };
  /** A host-label or userinfo character: a letter, digit or mark of a spaced script, or one of `. _ ~ % ! $ & * + , ; = : @ -`. */
  const LEAD_CHAR = new RegExp(`^(?![${SPACELESS}])[\\p{L}\\p{N}\\p{M}._~%!$&*+,;=:@-]$`, "u");
  /**
   * Where what is glued before a host-led match starts, back to `floor`: host labels and userinfo (`payroll.intranet.`,
   * `alice:pw@`, `evil-`), then a `//` and the scheme before it. `www` is set when that is a lone `www.`, which keeps the alias.
   */
  const hostLead = (text: string, start: number, floor: number): { start: number; www: boolean } => {
    let at = start;
    while (at > floor && LEAD_CHAR.test(codePointBefore(text, at) ?? "")) at -= (codePointBefore(text, at) ?? "").length;
    if (at === start) return { start, www: false };
    const www = /^www\.$/iu.test(text.slice(at, start));
    if (at - 2 >= floor && text.slice(at - 2, at) === "//") {
      at -= 2;
      let back = at;
      if (text[back - 1] === ":") { back--; while (back > floor && /[a-z0-9+.-]/iu.test(text[back - 1] ?? "")) back--; }
      if (back < at && /^[a-z][a-z0-9+.-]*:$/iu.test(text.slice(back, at))) at = back;
    }
    return { start: at, www };
  };
  /** Whether the protocol-relative URL rule may start at `at`, its lookbehind read in this view, and not inside an earlier match. */
  const URL_OPENER = new RegExp(`^[\\s"'(\\[<=:,;${SPACELESS}]$`, "u");
  const urlMayStart = (text: string, at: number, floor: number) => at === 0 || (at > floor && URL_OPENER.test(codePointBefore(text, at) ?? ""));
  /** Every match, leftmost and longest first. Matched in the folded wide view; bounded and extended in the wide view. */
  const matches = (text: string) => {
    const shown = wide(text), view = fold(shown), hashOf = spanHasher(view), found: { start: number; end: number; replacement: string; mark?: Omit<Mark, "start" | "end"> }[] = [];
    let at = 0, floor = 0;
    while (at + ASSIST_NAME_MIN_CHARS <= view.length) {
      const bucket = index.get(view.slice(at, at + ASSIST_NAME_MIN_CHARS));
      let hit: { start: number; end: number; entry: Entry } | undefined;
      if (bucket) {
        search: for (const length of bucket.lengths) {
          if (at + length > view.length) continue;
          for (const entry of bucket.byLength.get(length)!.get(hashOf(at, at + length)) ?? []) {
            if (!view.startsWith(entry.folded, at)) continue;
            const span = entrySpan(shown, at, at + length, entry);
            if (!span || span.start < floor) continue;
            hit = { ...span, entry }; break search;
          }
        }
      }
      if (!hit) { at++; continue; }
      let { start, end } = hit, replacement = hit.entry.replacement, mark: Omit<Mark, "start" | "end"> | undefined, led = false;
      // A file name glued to more name through `-`, `_` or `.` is another file, not the source: the whole run is `[file]`.
      if (hit.entry.kind === "name" && hit.entry.dotted) {
        const before = nameRunStart(shown, start, floor), after = nameRunEnd(shown, end);
        if (before < start || after > end) { start = before; end = after; replacement = ASSIST_PLACEHOLDERS.file; }
      }
      // Labels, userinfo or another word glued before the source's host make another host or a credential: the whole of it is `[url]`.
      if (hit.entry.hostLed) {
        const lead = hostLead(shown, start, floor);
        if (lead.start < start) { start = lead.start; if (!lead.www) { replacement = ASSIST_PLACEHOLDERS.url; led = true; } }
      }
      if (hit.entry.kind !== "host") start = absorbPrefix(shown, start, floor);
      if (start - 2 >= floor && shown.slice(start - 2, start) === "//" && replacement.startsWith("[")) {
        // A placeholder right after `//` is provisional. A glued file name of one source stands as its alias: a rule that takes
        // the alias takes the whole token as before (`//cdn.other.test/x/q3-report.html?token=…`, `x=1;//…`, `S1:///…`, a relative
        // path), and where none does, scrub() puts `[file]` back, so no other file is shown as the source (`a//old-alpha.md` is
        // `a//[file]`). Any other placeholder keeps its place for the rules where the URL rule could start, so a relative path
        // still takes the word before the `//` with it, and where no rule takes it, scrub() makes the `//`, the placeholder and
        // the URL's rest `[url]` (`see //cdn.other.test/x/old-report.html?token=…` is `see [url]`).
        if (replacement === ASSIST_PLACEHOLDERS.file && !hit.entry.replacement.startsWith("[")) { mark = { kind: "alias", placeholder: replacement, slashes: false }; replacement = hit.entry.replacement; led = false; }
        else if (urlMayStart(shown, start - 2, floor)) { mark = { kind: "url", placeholder: replacement, slashes: true }; led = false; }
      }
      // A URL source's form that a local copy shares is a name, so the match ends at the name: led like a URL, it keeps its place for
      // the rules, and where none takes it, scrub() gives it the URL's path, query and fragment, as the URL rule did before.
      if (led && hit.entry.kind === "name") mark = { kind: "url", placeholder: replacement, slashes: false };
      found.push(mark === undefined ? { start, end, replacement } : { start, end, replacement, mark });
      at = floor = end;
    }
    return found;
  };
  return {
    /**
     * The text with every match replaced, their counts (a provisional alias counts as its source), and the marks: each of
     * `carried` that no match touches, moved with the text, and one for each provisional replacement.
     */
    replace(text: string, carried: readonly Mark[]): { text: string; sources: number; files: number; urls: number; marks: Mark[] } {
      let out = "", last = 0, sources = 0, files = 0, urls = 0, next = 0;
      const marks: Mark[] = [];
      const keep = (to: number, from: number) => {
        for (; next < carried.length && carried[next]!.start < to; next++) {
          const mark = carried[next]!;
          if (mark.end <= from) marks.push({ ...mark, start: mark.start - last + out.length, end: mark.end - last + out.length });
        }
      };
      for (const match of matches(text)) {
        keep(match.end, match.start);
        out += text.slice(last, match.start);
        if (match.mark) marks.push({ start: out.length, end: out.length + match.replacement.length, ...match.mark });
        if (match.replacement === ASSIST_PLACEHOLDERS.file) files++; else if (match.replacement === ASSIST_PLACEHOLDERS.url) urls++; else sources++;
        out += match.replacement; last = match.end;
      }
      keep(Infinity, Infinity);
      return { text: out + text.slice(last), sources, files, urls, marks };
    },
    found: (text: string) => matches(text).length > 0,
  };
}

// ---- Digests ----
/**
 * Whether a hexadecimal run is a digest: it holds an 8-character piece of a digest the request holds or implies, or it is 64
 * characters or longer with a letter (as groups, groups of eight or more), so a table of years or numbers never makes one.
 */
function digestRule(known: readonly string[]): (run: string, grouped: boolean) => boolean {
  const parts = new Set<string>();
  for (const hash of known) for (let i = 0; i + ASSIST_DIGEST_PART_MIN <= hash.length; i++) parts.add(hash.slice(i, i + ASSIST_DIGEST_PART_MIN).toLowerCase());
  return (run, grouped) => {
    const value = run.replace(HEX_JOINS, "").toLowerCase();
    if (value.length >= 64 && /[a-f]/u.test(value) && (!grouped || run.split(HEX_JOINS).every(group => group.length >= ASSIST_DIGEST_PART_MIN))) return true;
    for (let i = 0; i + ASSIST_DIGEST_PART_MIN <= value.length; i++) if (parts.has(value.slice(i, i + ASSIST_DIGEST_PART_MIN))) return true;
    return false;
  };
}

/** A quoted span the path rule took whole: its quotes stay around the placeholder. */
const QUOTED = /^["\u201c]/u;
/** Counts of what a scrub replaced, by kind. */
export interface ScrubCounts { sources: number; files: number; urls: number; digests: number }
export interface Scrubber {
  /** A text field as it may leave. `model` adds the forms and file-name rule that only model-written text gets. */
  scrub(text: string, scope: "text" | "model"): { text: string; counts: ScrubCounts };
  /** What the audit finds in a finished string: source forms in the stricter NFKC view, the rest in the wide view the scrub reads. */
  finding(text: string, scope: "text" | "model"): "source_identity" | "digest" | "url_or_path" | undefined;
}
/** The scrubber for one request: its sources (in inventory order: source n is `S{n}`), the host's appended text and the digests it implies. */
export function createScrubber(input: { sources: readonly ResearchSourceIdentity[]; suffix: string; knownDigests: readonly string[] }): Scrubber {
  const forms = [...input.sources.flatMap((source, i) => sourceForms(source, `S${i + 1}`)), ...hostFileForms(input.suffix)];
  const general = forms.filter(form => form.scope === "all");
  const sending = { text: formScanner(general, textForm), model: formScanner(forms, textForm) }, auditing = { text: formScanner(general, auditForm), model: formScanner(forms, auditForm) };
  const isDigest = digestRule(input.knownDigests);
  /**
   * One pass of the URL, path, file-name and digest rules: matched in the wide view, replaced in the text at the same indices.
   * It returns the provisional marks that no rule took, moved to where they now stand.
   */
  const generic = (text: string, scope: "text" | "model", marks: readonly Mark[]) => {
    const state = { text, view: wide(text), marks }, counts = { urls: 0, files: 0, digests: 0 };
    /** A token's placeholder, keeping the sentence punctuation and unbalanced brackets that followed it. */
    const token = (placeholder: string, kind: "urls" | "files") => (_original: string, viewed: string): Cut | undefined => {
      const { core } = trimToken(viewed); if (!core) return undefined;
      counts[kind]++; return { from: 0, to: core.length, placeholder };
    };
    for (const pattern of URL_PATTERNS) replaceBoth(state, pattern, token(ASSIST_PLACEHOLDERS.url, "urls"));
    for (const pattern of PATH_PATTERNS) replaceBoth(state, pattern, (original, viewed) => {
      if (!QUOTED.test(viewed)) return token(ASSIST_PLACEHOLDERS.file, "files")(original, viewed);
      counts.files++; return { from: 1, to: original.length - 1, placeholder: ASSIST_PLACEHOLDERS.file };
    });
    replaceBoth(state, relativeRuns, (_original, viewed) => {
      const end = relativeEnd(viewed);
      if (end < 0) return undefined;
      // A dotted folder is no extension: when the path goes on after it (`src/com.example.app/ui`), the whole run is the path.
      const cut = /^[/\\]/u.test(viewed.slice(end)) ? trimToken(viewed).core.length : end, lead = openingLead(viewed.slice(0, cut));
      counts.files++; return { from: lead.length, to: cut, placeholder: ASSIST_PLACEHOLDERS.file };
    });
    if (scope === "model") replaceBoth(state, FILE_NAME_PATTERN, (original, viewed) => { counts.files++; return { from: openingLead(viewed).length, to: original.length, placeholder: ASSIST_PLACEHOLDERS.file }; });
    replaceBoth(state, HEX_GROUPS, (_, viewed) => { if (!isDigest(viewed, true)) return undefined; counts.digests++; return { from: 0, to: viewed.length, placeholder: ASSIST_PLACEHOLDERS.digest }; });
    replaceBoth(state, HEX_RUN, (_, viewed) => { if (!isDigest(viewed, false)) return undefined; counts.digests++; return { from: 0, to: viewed.length, placeholder: ASSIST_PLACEHOLDERS.digest }; });
    return { text: state.text, ...counts, marks: state.marks };
  };
  const holds = (view: string, finder: Finder, accept: (token: string) => boolean) => { for (const match of findAll(view, finder)) if (accept(match[0])) return true; return false; };
  const holdsGeneric = (view: string, scope: "text" | "model") =>
    [...URL_PATTERNS, ...PATH_PATTERNS].some(pattern => holds(view, pattern, matched => trimToken(matched).core.length > 0)) ||
    holds(view, relativeRuns, run => relativeEnd(run) >= 0) || (scope === "model" && holds(view, FILE_NAME_PATTERN, () => true));
  const holdsDigest = (view: string) => holds(view, HEX_GROUPS, run => isDigest(run, true)) || holds(view, HEX_RUN, run => isDigest(run, false));
  return {
    scrub(raw, scope) {
      let text = textForm(raw);
      const counts: ScrubCounts = { sources: 0, files: 0, urls: 0, digests: 0 };
      // A replacement can change what its neighbours read as (`example.org.report.md`): passes repeat until one changes nothing, at most
      // three. The provisional marks go through every pass, so each pass reads the text as if they were final, and a rule in a later
      // pass can still take one (`localhost:8080s3://[source]`: the first pass takes the host and port, the second the `s3:` URL).
      // Then the marks that no rule took are settled, and if that changed the text, the passes run once more on what it left.
      for (let round = 0; round < 2; round++) {
        let marks: readonly Mark[] = [];
        for (let pass = 0; pass < 3; pass++) {
          const named = sending[scope].replace(text, marks), linked = generic(named.text, scope, named.marks);
          counts.sources += named.sources; counts.files += named.files + linked.files; counts.urls += named.urls + linked.urls; counts.digests += linked.digests;
          marks = linked.marks;
          if (linked.text === text) break;
          text = linked.text;
        }
        // A provisional alias that no rule took gets its placeholder back. A placeholder that no rule took takes the URL's rest after
        // it, and the `//` before it when it had one, as `[url]`; a mark inside that rest goes with it.
        const shown = wide(text);
        let settled = "", last = 0;
        for (const mark of marks) {
          if (mark.start < last) continue;
          if (mark.kind === "alias") { settled += text.slice(last, mark.start) + mark.placeholder; last = mark.end; counts.sources--; counts.files++; continue; }
          const from = mark.slashes && mark.start - 2 >= last && text.slice(mark.start - 2, mark.start) === "//" ? mark.start - 2 : mark.start;
          URL_REST.lastIndex = mark.end;
          settled += text.slice(last, from) + ASSIST_PLACEHOLDERS.url; last = mark.end + trimToken(URL_REST.exec(shown)?.[0] ?? "").core.length;
          if (mark.placeholder !== ASSIST_PLACEHOLDERS.url) { counts.urls++; if (mark.placeholder === ASSIST_PLACEHOLDERS.file) counts.files--; else counts.sources--; }
        }
        settled += text.slice(last);
        if (settled === text) break;
        text = settled;
      }
      return { text, counts };
    },
    finding(text, scope) {
      if (auditing[scope].found(auditForm(text))) return "source_identity";
      const view = wide(textForm(text));
      if (holdsDigest(view)) return "digest";
      if (holdsGeneric(view, scope)) return "url_or_path";
      return undefined;
    },
  };
}

// ---- Copied text: verbatim windows of code points, compared case-folded in NFKC with long hexadecimal runs masked on both sides ----
const ROLL_BASE = 0x01000193, HEX_LONG = /[0-9a-f]{16,}/giu;
/** The view two texts are compared in: everything kept (a copy holding a name or a URL is still a copy), long hexadecimal runs masked, NFKC with white space collapsed, folded. */
const copyForm = (text: string) => fold(normalizeQuoteText(text.replace(MARK_FLOOD, "$1").replace(IGNORABLE, "").replace(HYPHENS, "-").replace(HEX_LONG, " ")));
const codePointsOf = (text: string) => { const out: number[] = []; for (const character of text) out.push(character.codePointAt(0)!); return out; };
/** Visits the rolling hash of every window of `size` code points; stops when `visit` returns true. */
function rollWindows(values: readonly number[], size: number, visit: (hash: number, start: number) => boolean | void): boolean {
  if (values.length < size) return false;
  let power = 1; for (let i = 1; i < size; i++) power = Math.imul(power, ROLL_BASE);
  let hash = 0; for (let i = 0; i < size; i++) hash = (Math.imul(hash, ROLL_BASE) + values[i]!) | 0;
  if (visit(hash, 0)) return true;
  for (let start = 1; start + size <= values.length; start++) {
    hash = (Math.imul((hash - Math.imul(values[start - 1]!, power)) | 0, ROLL_BASE) + values[start + size - 1]!) | 0;
    if (visit(hash, start)) return true;
  }
  return false;
}
/** Whether any field holds `size` consecutive code points of any reference, both in the copy view. Hash hits are confirmed by comparison. */
export function copiesText(fields: readonly string[], references: readonly string[], size: number): boolean {
  const wanted = new Map<number, Set<string>>();
  for (const field of fields) {
    const values = codePointsOf(copyForm(field));
    rollWindows(values, size, (hash, start) => { const window = String.fromCodePoint(...values.slice(start, start + size)); const set = wanted.get(hash); if (set) set.add(window); else wanted.set(hash, new Set([window])); });
  }
  if (!wanted.size) return false;
  return references.some(reference => { const values = codePointsOf(copyForm(reference));
    return rollWindows(values, size, (hash, start) => wanted.get(hash)?.has(String.fromCodePoint(...values.slice(start, start + size))) === true); });
}
/**
 * Whether any field holds a whole literal heading of at least `min` code points, markers stripped, in the copy view. Headings
 * are indexed by the hash of their first `min` code points, so each field is read once whatever the number of headings.
 */
export function holdsHeading(fields: readonly string[], headings: readonly string[], min: number): boolean {
  const wanted = new Map<number, number[][]>();
  for (const heading of headings) {
    const values = codePointsOf(copyForm(heading.replace(/^\uFEFF?\s{0,3}#{1,6}/u, "").replace(/\s#+\s*$/u, "")));
    if (values.length < min) continue;
    rollWindows(values.slice(0, min), min, hash => { const list = wanted.get(hash); if (list) list.push(values); else wanted.set(hash, [values]); return true; });
  }
  if (!wanted.size) return false;
  return fields.some(field => {
    const values = codePointsOf(copyForm(field));
    return rollWindows(values, min, (hash, start) => (wanted.get(hash) ?? []).some(heading => start + heading.length <= values.length && heading.every((value, k) => values[start + k] === value)));
  });
}
const SPACELESS_CHAR = new RegExp(`[${SPACELESS}]`, "u"), TOKEN_CHAR = /[\p{L}\p{N}_\-[\]]/u;
/** A gist cut to at most `max` code points without splitting an ASCII token (an alias, a placeholder, a word): back to whitespace, or to a spaceless-script character. */
export function cutWhole(text: string, max: number): string {
  const values = [...text];
  if (values.length <= max) return text;
  let cut = max;
  const token = (character: string | undefined) => character !== undefined && TOKEN_CHAR.test(character) && !SPACELESS_CHAR.test(character);
  while (cut > 0 && token(values[cut - 1]) && token(values[cut])) cut--;
  return values.slice(0, cut).join("").trimEnd();
}

/** The rules and patterns, bound into the assist protocol block. */
export const SCRUB_POLICY = Object.freeze({
  version: 4, text: "mark_runs_cut_at_30; NFC_without_default_ignorables_with_unicode_hyphens_as_ascii", view: "full_width_ascii_as_ascii_index_preserving",
  audit: "source_forms_in_NFKC; digests_urls_and_paths_in_the_wide_view", fold: "lowercase_with_turkish_i_letters_folded_and_final_sigma_as_sigma",
  boundary: "a_letter_or_decimal_digit_of_the_edge_script_glues_and_a_digit_glues_to_a_letter; nothing_glues_to_a_spaceless_letter; an_escape_or_percent_byte_before_is_a_boundary",
  forms: "ids_paths_%2F_paths_url_variants(scheme,slash,decoded,unicode_host)_without_query_dotted_hosts_with_and_without_www_last_2_and_3_segments_file_names_query_and_fragment_file_names; model_text_also_distinctive_stems_single_label_hosts_opaque_segments_distinctive_query_and_fragment_names; host_appended_paths_and_file_names_[file]",
  matching: "rolling_hashes_by_first_4_and_length_leftmost_longest; names_absorb_up_to_4_extensions_the_longest_unglued_and_a_folder_prefix_before; hosts_urls_paths_absorb_a_path_after; shared_form_[source]",
  glued: "a_file_name_glued_to_more_name_by_-_or__or_._on_either_side_is_[file]; a_host_led_form_glued_after_labels_userinfo_or_a_word_with_its_//_and_scheme_is_[url]; a_lone_www._keeps_the_alias",
  spacelessInPaths: "spaceless_letters_inside_urls_paths_and_file_names_only_where_a_connector_touches_them",
  extensions: "2_to_16_letters_and_digits_with_a_letter_not_a_capitalized_word_not_a_decimal",
  relative: "whole_run_from_a_run_start_cut_after_the_longest_extension_whole_when_a_separator_follows_it",
  order: "source_forms_then_urls_then_paths_(model_text_also_bare_file_names)_then_digests_repeated_until_unchanged_at_most_3_passes",
  spaceless: SPACELESS, connectors: CONNECT, tlds: TLDS, notTlds: NOT_TLDS, fileExtensions: ASSIST_FILE_EXTENSIONS,
  patterns: { url: URL_PATTERNS.map(pattern => pattern.source), path: PATH_PATTERNS.map(pattern => pattern.source), relative: { run: RELATIVE_RUN.source, extension: EXTENSION_AT.source },
    fileName: FILE_NAME_PATTERN.source, hostFile: HOST_FILE_TOKEN.source, hex: [HEX_RUN.source, HEX_GROUPS.source] },
  digests: "a_known_8_char_piece_in_a_run_or_groups; a_run_of_64_with_a_letter; groups_of_8_or_more_totalling_64_with_a_letter",
  nameMinChars: ASSIST_NAME_MIN_CHARS, stemMinChars: ASSIST_STEM_MIN_CHARS, opaqueSegmentMinChars: ASSIST_OPAQUE_SEGMENT_MIN_CHARS, digestPartMin: ASSIST_DIGEST_PART_MIN,
  placeholders: ASSIST_PLACEHOLDERS, copy: "case_folded_NFKC_hex_runs_of_16_masked_rolling_windows", headings: "whole_headings_indexed_by_their_first_min_code_points",
});
