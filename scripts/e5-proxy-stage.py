#!/usr/bin/env python3
"""Stage a fresh E5 proxy-only handoff. Read private scan policy exclusively from stdin."""

import argparse
import binascii
import ctypes
import errno
import hashlib
import html
from html.parser import HTMLParser
import io
import ipaddress
import json
import os
from pathlib import Path
import posixpath
import re
import runpy
import stat
import struct
import sys
import tempfile
import unicodedata
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
# Same high-confidence rules as the local privacy adapter, without loading any model.
try:
    RULES = runpy.run_path(str(ROOT / "runtime/privacy-filter/adapter.py"))["RULES"]
except Exception:
    sys.exit("scanner_unavailable")
BLOCKED = [re.compile(rule) for _, rule in RULES] + [
    re.compile(r"[\w.%+!#$&'*=/^{}|~-]{1,64}@[\w-]+(?:\.[\w-]+)+", re.I),
    re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])"),
    re.compile(r"(?:\blocalhost|\.(?:local|internal|localhost|lan|intranet|home\.arpa))\b", re.I),
    re.compile(r'''https?://(?:[a-z0-9-]+(?=[:/?#\s<>"']|$)|[^\s/<>"']{1,253}:\d{1,5}(?=[/?#\s<>"']|$))''', re.I),
    re.compile(r"(?<!\w)(?:file:/|~[/\\]|[a-z]:[/\\]|\\\\|\.{1,2}[/\\])", re.I),
    re.compile(r"(?<![\w/])/(?:Users|home|private|tmp|var|etc|opt|mnt|Volumes|Applications|Library|usr|root)(?:/|\b)", re.I),
    re.compile(r'''\b(?:authorization["']?\s*:\s*["']?(?:bearer|basic)\s+|(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password)["']?\s*[:=]\s*["']?)[^\s"'<>]{4,}''', re.I),
    re.compile(r"\b(?:xox[baprs]-[a-z0-9-]{10,}|glpat-[\w-]{16,})\b|-----BEGIN PGP PRIVATE KEY BLOCK-----", re.I),
]
ABSOLUTE_PATH = re.compile(r"(?:^|[\s=\"'(\[])/(?![/\s>])", re.M)
# Encoded blobs and embedded files have no inspected text representation.
OPAQUE = re.compile(r"(?:\bdata\s*:[^\s,]{0,160},|\bbase64(?:binary\b|\s*[:,])|[A-Za-z0-9+/_-]{128,}={0,2})", re.I)
IPV6 = re.compile(r"(?<![\w:])[0-9a-f:]{2,45}(?![\w:])", re.I)
TEXT = {".txt", ".md", ".csv", ".json", ".html", ".htm", ".css"}
OFFICE = {".docx": "word/document.xml", ".pptx": "ppt/presentation.xml", ".xlsx": "xl/workbook.xml"}
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_ENTRIES = 512
MAX_DEPTH = 16
MAX_XML_BYTES = 16 * 1024 * 1024
HTML_TAGS = set("""
    html head meta title style body main article section header footer aside nav h1 h2 h3 h4 h5 h6
    div span p br hr a b i em strong u s small mark sub sup abbr cite q blockquote code pre kbd
    samp var time address ol ul li dl dt dd table caption colgroup col thead tbody tfoot tr th td
    figure figcaption details summary bdi bdo wbr
""".split())
HTML_ATTRS = set("""
    class id title lang dir role hidden style charset name content colspan rowspan headers scope
    span width height align valign start reversed type value datetime tabindex
""".split())
CSS_FUNCTIONS = set("""
    rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix var calc min max clamp repeat
    minmax fit-content linear-gradient radial-gradient conic-gradient repeating-linear-gradient
    repeating-radial-gradient translate translatex translatey rotate scale matrix
    nth-child nth-of-type nth-last-child not is where has and or media supports selector
    counter counters rect
""".split())
CSS_TOKENS = re.compile(r'''"[^"\r\n]*"|'[^'\r\n]*'|/\*(.*?)\*/|/\*|\*/|["']''', re.S)


class Refusal(Exception):
    """The message is a fixed code; it must never include input or a local path."""


def require(ok, code):
    if not ok:
        raise Refusal(code)


def normal(text):
    return unicodedata.normalize("NFKC", text).casefold()


def name_key(text):
    # Office runs, line wrapping, punctuation and stylesheet/filename separators can divide a name.
    return re.sub(r"[\W_]+", "", text)


def read_policy():
    def unique_fields(pairs):
        fields = dict(pairs)
        require(len(fields) == len(pairs), "invalid_policy")
        return fields

    raw = sys.stdin.buffer.read(65537)
    require(0 < len(raw) <= 65536, "invalid_policy")
    try:
        policy = json.loads(raw, object_pairs_hook=unique_fields)
    except (ValueError, UnicodeError):
        raise Refusal("invalid_policy") from None
    require(isinstance(policy, dict) and {"ownerNames", "endpointHosts", "materialRoots"} <= policy.keys()
            and policy.keys() <= {"ownerNames", "endpointHosts", "knownSecrets", "materialRoots"}, "invalid_policy")
    raw_roots = policy.pop("materialRoots")
    require(isinstance(raw_roots, list) and 0 < len(raw_roots) <= 16, "invalid_policy")
    roots = []
    for value in raw_roots:
        require(isinstance(value, str) and Path(value).is_absolute(), "invalid_policy")
        roots.append(material_root(value))
    terms = {"owner_data": [], "sensitive_content": []}
    for field, values in policy.items():
        require(isinstance(values, list) and len(values) <= 128 and (values or field == "knownSecrets"), "invalid_policy")
        for value in values:
            require(isinstance(value, str) and value.strip() == value and 1 <= len(value) <= 2048, "invalid_policy")
            require(all(ch.isprintable() for ch in value), "invalid_policy")
            if field == "endpointHosts":
                try:
                    host = str(ipaddress.ip_address(value))
                except ValueError:
                    try:
                        endpoint = urlsplit("//" + value)
                        host = endpoint.hostname
                        port = endpoint.port
                    except ValueError:
                        raise Refusal("invalid_policy") from None
                    require(host and not endpoint.path and not endpoint.query and not endpoint.fragment
                            and "@" not in value and not value.endswith(":")
                            and (port is None or 0 < port < 65536), "invalid_policy")
                    try:
                        host = str(ipaddress.ip_address(host))
                    except ValueError:
                        require(re.fullmatch(r"[a-z0-9][a-z0-9.-]*", host, re.I), "invalid_policy")
                value = host
            if field == "ownerNames":
                alias = name_key(normal(value))
                require(alias, "invalid_policy")
                terms["owner_data"].append(alias)
            else:
                terms["sensitive_content"].append(normal(value))
    return terms, roots


def scan_text(text, terms, css_openers=False):
    # Inspect both the bytes' literal text and representations used by browsers, URLs and Office.
    for _ in range(4):
        require(not any(unicodedata.category(ch) in ("Cc", "Cf") and ch not in "\r\n\t" for ch in text), "opaque_content")
        folded = normal(text)
        compact = name_key(folded)
        require(not any(term in compact for term in terms["owner_data"]), "owner_data")
        require(not any(term in folded for term in terms["sensitive_content"]), "sensitive_content")
        require(not OPAQUE.search(text), "opaque_content")
        require(not any(rule.search(text) or rule.search(folded) for rule in BLOCKED), "sensitive_content")
        # Raw markup is checked again in the parsed CSS/text/attribute/comment contexts below.
        path_text = folded.replace("/*", " *") if css_openers else folded
        require(not ABSOLUTE_PATH.search(path_text), "sensitive_content")
        if ":" in text:
            for match in IPV6.finditer(folded):
                if match[0].count(":") >= 2:
                    try:
                        ipaddress.IPv6Address(match[0])
                    except ValueError:
                        continue
                    raise Refusal("sensitive_content")
        decoded = html.unescape(unquote(text, errors="strict"))
        if decoded == text:
            return
        text = decoded
    raise Refusal("opaque_content")


def scan_css(css):
    # Limit the grammar to static styling. CSS can fetch even bare quoted strings in @import/image-set.
    require("\\" not in css, "opaque_content")

    def privacy_view(match):
        token, comment = match[0], match[1]
        if comment is not None:
            require("/*" not in comment, "opaque_content")
            return " " + comment + " "
        # Reject unmatched delimiters and comment markup inside a quoted string.
        require(len(token) >= 2 and token[0] in "\"'" and "/*" not in token and "*/" not in token, "opaque_content")
        return token

    text = CSS_TOKENS.sub(privacy_view, css)
    for separator in ("", " "):
        code = CSS_TOKENS.sub(lambda m: separator if m[1] is not None else m[0], css)
        require(not re.search(r"@(?!media\b|page\b|supports\b|layer\b)", code, re.I), "opaque_content")
        for function in re.finditer(r"([\w-]+)\s*\(", code):
            require(function[1].lower() in CSS_FUNCTIONS, "opaque_content")
    return text


class VisibleHTML(HTMLParser):
    def __init__(self, terms):
        super().__init__(convert_charrefs=True)
        self.terms = terms
        self.parts = []
        self.in_style = False

    def handle_decl(self, decl):
        require(decl.strip().lower() == "doctype html", "opaque_content")

    def handle_pi(self, data):
        raise Refusal("opaque_content")

    def handle_comment(self, data):
        scan_text(data, self.terms)

    def handle_data(self, data):
        if self.in_style:
            data = scan_css(data)
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        require(tag in HTML_TAGS, "opaque_content")
        self.in_style = tag == "style"
        for name, value in attrs:
            if name == "href" and tag == "a":
                # Only a user-activated public HTTPS link or document fragment. No fetching attributes.
                require(value and (value.startswith("#") or
                        (value.startswith("https://") and urlsplit(value).hostname and "@" not in urlsplit(value).netloc)), "opaque_content")
            else:
                require(name in HTML_ATTRS or name.startswith("aria-")
                        or re.fullmatch(r"data-[a-z0-9]+(?:-[a-z0-9]+)*", name), "opaque_content")
            if value:
                if name == "style":
                    value = scan_css(value)
                scan_text(value, self.terms)
                require(not value.lstrip().lower().startswith("javascript:"), "opaque_content")

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False


def scan_json(value, terms):
    if isinstance(value, (list, tuple)):
        for item in value:
            scan_json(item, terms)
    elif isinstance(value, str):
        scan_text(value, terms)


def scan_plain(raw, ext, terms):
    require(not raw.startswith((b"%PDF-", b"{\\rtf")), "unsupported_format")
    text = raw.decode("utf-8-sig", "strict")
    scan_text(text, terms, css_openers=ext in (".css", ".htm", ".html", ".md"))
    if ext == ".css":
        scan_text(scan_css(text), terms)
        return
    if ext == ".json":
        # object_pairs_hook also inspects overwritten duplicate keys and their values.
        scan_json(json.loads(text, object_pairs_hook=list), terms)
    elif ext in (".htm", ".html", ".md"):
        if ext == ".md":
            require("![" not in text, "opaque_content")
            # Markdown autolinks are manually activated. Raw HTML still gets the HTML gate.
            text = re.sub(r"<(https?://[^\s<>]+)>", r"\1", text)
        parser = VisibleHTML(terms)
        parser.feed(text)
        parser.close()
        scan_text("".join(parser.parts), terms)


def read_office_member(data, entry, offset):
    # Admit the exact ZIP interval, with no optional local metadata, gaps or trailing compressed bytes.
    header = struct.unpack_from("<4s5H3I2H", data, offset)
    name = entry.filename.encode("ascii")
    require(entry.header_offset == offset and header[0] == b"PK\x03\x04" and header[2] == entry.flag_bits
            and entry.flag_bits in (0, 0x800) and header[3] == entry.compress_type
            and header[6:] == (entry.CRC, entry.compress_size, entry.file_size, len(name), 0), "unsupported_office")
    start = offset + 30 + len(name)
    end = start + entry.compress_size
    require(data[offset + 30:start] == name and end <= len(data), "unsupported_office")
    payload = data[start:end]
    if entry.compress_type == zipfile.ZIP_DEFLATED:
        inflate = zlib.decompressobj(-15)
        payload = inflate.decompress(payload, entry.file_size + 1)
        require(inflate.eof and not inflate.unused_data and not inflate.unconsumed_tail, "unsupported_office")
    else:
        require(entry.compress_type == zipfile.ZIP_STORED, "unsupported_office")
    require(len(payload) == entry.file_size and binascii.crc32(payload) == entry.CRC, "unsupported_office")
    return payload, end


def package_reference(name, key, value, members):
    # The two OPC reference attributes can legitimately start with "/" or "../".
    # Exempt only that notation, only if it resolves to an independently scanned part.
    if key == "PartName" and name == "[Content_Types].xml" and value.startswith("/"):
        target = value[1:]
    elif key == "Target" and name.endswith(".rels") and value.startswith(("../", "./", "/")):
        if value.startswith("/"):
            target = value[1:]
        else:
            base = posixpath.dirname(posixpath.dirname(name))
            target = posixpath.normpath(posixpath.join(base, value))
    else:
        return value
    return target if target in members else value


def scan_office(data, ext, terms, budget):
    tail = struct.unpack("<4s4H2IH", data[-22:])
    require(tail[0] == b"PK\x05\x06" and 0 < tail[4] <= MAX_ENTRIES and tail[-1] == 0, "unsupported_office")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = sorted(archive.infolist(), key=lambda entry: entry.header_offset)
        names = {entry.filename for entry in entries}
        require(0 < len(entries) <= MAX_ENTRIES and len(names) == len(entries)
                and OFFICE[ext] in names and "[Content_Types].xml" in names, "unsupported_office")
        xml_bytes = sum(entry.file_size for entry in entries)
        budget[2] += xml_bytes
        require(xml_bytes <= MAX_XML_BYTES and budget[2] <= MAX_TOTAL, "oversize")
        # No archive comment, prepended file, central-directory extensions, ZIP64 or trailing data.
        central_size = sum(46 + len(entry.filename.encode("ascii")) for entry in entries)
        require(tail == (b"PK\x05\x06", 0, 0, len(entries), len(entries), central_size, archive.start_dir, 0)
                and archive.start_dir + central_size + 22 == len(data), "unsupported_office")
        offset = 0
        for entry in entries:
            name = entry.filename
            require(name == entry.orig_filename and not entry.extra and not entry.comment and "\\" not in name
                    and all(part not in ("", ".", "..") for part in name.split("/"))
                    and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)
                    and name.lower().endswith((".xml", ".rels")), "unsupported_office")
            scan_text(name, terms)
            payload, offset = read_office_member(data, entry, offset)
            xml = payload.decode("utf-8-sig")
            require(xml.count("<") <= 160000, "oversize")
            require(not re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b|<\?(?!xml(?:\s|\?>))|<[\w:.-]*(?:binData|binaryData)\b", xml, re.I), "unsupported_office")
            encoding = re.match(r'''<\?xml\b[^?>]*?\bencoding\s*=\s*["']([^"']+)''', xml, re.I)
            require(not encoding or encoding[1].lower() in ("utf-8", "utf8"), "unsupported_office")
            xml_for_scan = re.sub(r'''(\b(PartName|Target)\s*=\s*["'])([^"']+)''',
                                  lambda m: m[1] + package_reference(name, m[2], m[3], names), xml)
            scan_text(xml_for_scan, terms)
            root = ET.fromstring(xml)
            scan_text("".join(root.itertext()), terms)
            for node in root.iter():
                local_tag = node.tag.rsplit("}", 1)[-1].lower()
                require(local_tag not in {"script", "svg", "oleobj", "externallink", "altchunk", "instrtext", "fldsimple"}
                        and not (ext == ".xlsx" and local_tag == "f"), "unsupported_office")
                if name.endswith(".rels") and local_tag == "relationship":
                    target = node.attrib.get("Target", "")
                    base = posixpath.dirname(posixpath.dirname(name))
                    resolved = target[1:] if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
                    require(node.attrib.get("TargetMode", "Internal") == "Internal" and resolved in names, "unsupported_office")
                for key, val in node.attrib.items():
                    require(not val.lstrip().lower().startswith(("javascript:", "vbscript:")), "unsupported_office")
                    scan_text(package_reference(name, key, val, names), terms)
        require(offset == archive.start_dir, "unsupported_office")


def has_git_root(path):
    return any(os.path.lexists(parent / ".git") for parent in (path, *path.parents))


def canonical_dir(path):
    # macOS provides /tmp and /var as system aliases. User-controlled links anywhere else are refused.
    path = Path(os.path.abspath(path))
    if sys.platform == "darwin" and len(path.parts) > 1 and path.parts[1] in ("tmp", "var", "etc"):
        path = Path("/private", *path.parts[1:])
    require(path == path.resolve(strict=True) and path.is_dir(), "unsafe_location")
    return path


def checkout_roots():
    roots = {ROOT}
    # Linked worktrees also share an ordinary primary checkout with the common .git directory.
    marker = ROOT / ".git"
    if marker.is_file():
        pointer = marker.read_text().strip()
        require(pointer.startswith("gitdir: "), "scanner_unavailable")
        admin = ROOT / pointer[len("gitdir: "):]
        common = (admin / (admin / "commondir").read_text().strip()).resolve(strict=True)
        if common.name == ".git":
            roots.add(common.parent)
    return roots


def material_root(value):
    root = canonical_dir(value)
    home = Path.home()
    require(root not in (home, *home.parents, Path(tempfile.gettempdir()).resolve())
            and root not in {home / name for name in ("Documents", "Downloads", "Desktop", "Developer", "Library")}, "unsafe_location")
    repos = checkout_roots()
    require(all(root != checkout and root not in checkout.parents for checkout in repos), "unsafe_location")
    if has_git_root(root):
        archives = [checkout / ".soar/experiments/e5-proxy" for checkout in repos]
        require(any(root == archive or archive in root.parents for archive in archives), "unsafe_location")
    info = root.stat()
    require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "material_root_not_private")
    return root


def rename_exclusive(src, dst):
    # os.rename would replace a competing empty directory between the existence check and publication.
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        rc = libc.renamex_np(os.fsencode(src), os.fsencode(dst), 4)  # RENAME_EXCL
    elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
        rc = libc.renameat2(-100, os.fsencode(src), -100, os.fsencode(dst), 1)  # RENAME_NOREPLACE
    else:
        raise Refusal("unsupported_platform")
    if rc:
        raise Refusal("destination_exists" if ctypes.get_errno() in (errno.EEXIST, errno.ENOTEMPTY) else "publication_failed")


def source_files(directory, prefix, terms, budget):
    before = os.fstat(directory)
    names = []
    with os.scandir(directory) as entries:
        for entry in entries:
            budget[0] += 1
            require(budget[0] <= MAX_ENTRIES and len(prefix.parts) < MAX_DEPTH, "oversize")
            names.append(entry.name)
    for name in sorted(names):
        require(not name.startswith(".") and "/" not in name and "\\" not in name and ":" not in name, "unsafe_entry")
        scan_text(name, terms)
        relative = prefix / name
        info = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), "unsafe_entry")
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        desc = os.open(name, flags | (os.O_DIRECTORY if stat.S_ISDIR(info.st_mode) else 0), dir_fd=directory)
        try:
            opened = os.fstat(desc)
            require(os.path.samestat(info, opened), "source_changed")
            if stat.S_ISDIR(opened.st_mode):
                yield from source_files(desc, relative, terms, budget)
            else:
                require(opened.st_nlink == 1, "unsafe_entry")
                require(opened.st_size <= MAX_FILE and opened.st_size + budget[1] <= MAX_TOTAL, "oversize")
                with os.fdopen(os.dup(desc), "rb") as file:
                    raw = file.read(opened.st_size + 1)
                after = os.fstat(desc)
                require(len(raw) == opened.st_size and after.st_ctime_ns == opened.st_ctime_ns
                        and after.st_mtime_ns == opened.st_mtime_ns, "source_changed")
                budget[1] += len(raw)
                ext = relative.suffix.lower()
                if ext in OFFICE:
                    scan_office(raw, ext, terms, budget)
                else:
                    require(ext in TEXT, "unsupported_format")
                    scan_plain(raw, ext, terms)
                yield relative, raw
        finally:
            os.close(desc)
    after = os.fstat(directory)
    require(after.st_ctime_ns == before.st_ctime_ns and after.st_mtime_ns == before.st_mtime_ns, "source_changed")


def stage(source, out, terms, roots):
    source = canonical_dir(source)
    parent = canonical_dir(out.parent)
    require(out.name not in ("", ".", "..") and not out.name.startswith("."), "unsafe_location")
    scan_text(out.name, terms)
    dest = parent / out.name
    require(any(source == root or root in source.parents for root in roots)
            and any(root in dest.parents for root in roots), "outside_material_roots")
    require(source != dest and source not in dest.parents and dest not in source.parents, "unsafe_location")
    require(source not in (Path.home(), *Path.home().parents) and not has_git_root(parent), "unsafe_location")
    if has_git_root(source):
        require(any((checkout / ".soar/experiments/e5-proxy") in source.parents
                    for checkout in checkout_roots()), "unsafe_location")
    info = parent.stat()
    require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "output_parent_not_private")
    require(not os.path.lexists(dest), "destination_exists")
    # The byte cap lets us finish the entire job's scan before writing even a temporary file.
    desc = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        files = list(source_files(desc, Path(), terms, [0, 0, 0]))
    finally:
        os.close(desc)
    require(files, "empty_bundle")
    digest = hashlib.sha256()
    with tempfile.TemporaryDirectory(prefix=".e5-staging-", dir=parent) as scratch:
        pending = Path(scratch) / "handoff"
        pending.mkdir(mode=0o700)
        for relative, raw in files:
            target = pending / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as file:
                file.write(raw)
            path_bytes = relative.as_posix().encode("utf-8")
            digest.update(len(path_bytes).to_bytes(4, "big") + path_bytes + hashlib.sha256(raw).digest())
        rename_exclusive(pending, dest)
    return {"status": "staged", "files": len(files), "sha256": digest.hexdigest()}


class PrivateArguments(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "invalid_arguments\n")


def main():
    parser = PrivateArguments(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(stage(args.source, args.out, *read_policy()), sort_keys=True))
    except Refusal as exc:
        sys.exit(str(exc))
    except KeyboardInterrupt:
        sys.exit("handoff_interrupted")
    except Exception:
        # Standard-library parsers can embed the untrusted filename, XML/HTML token or path in an error.
        sys.exit("invalid_handoff")


if __name__ == "__main__":
    main()
