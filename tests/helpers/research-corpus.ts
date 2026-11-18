/**
 * Invented research corpora for E1's 500 KB scenario (S7 of E1's card, BL-20261109-0351-e1-recoverability-card): sizes invented with
 * the aggregate shape of the fresh task f2, as the card's owner question proposes. Nothing is read from .soar/ or from the frozen
 * tasks' metadata, so the tasks' authoring separation (BL-20261027-0145-phase4-tasks-design) is untouched.
 */

/** U+2014, three bytes in UTF-8: a 20 KiB index preview may end inside one and must then be cut back to a character boundary. */
const EM_DASH = String.fromCharCode(0x2014);

/** f2's aggregate shape in KiB: 21 files, 512 KiB in all, 11 of them over 20 KiB, the largest 48 KiB, none over one 64 KiB chunk. */
export const F2_SHAPE_KIB: readonly number[] = Object.freeze([48, 44, 40, 36, 33, 30, 28, 26, 24, 22, 21, 19, 18, 18, 17, 16, 16, 15, 14, 14, 13]);

/** Sources named `<directory>/<label>-NN.md` in that order: a heading, then numbered lines with an em dash until the source holds at least its size in KiB. */
export function inventedCorpus(label: string, sizesKib: readonly number[], directory = "input"): { id: string; path: string; bytes: Buffer }[] {
  return sizesKib.map((kib, i) => {
    const id = `${directory}/${label}-${String(i).padStart(2, "0")}.md`, lines = [`# Invented ${label} source ${i}`];
    for (let j = 0, size = 0; size < kib * 1024; j++) {
      const line = `Row ${j} of ${label} source ${i} ${EM_DASH} an invented observation of ${(i * 37 + j * 11) % 997} units.`;
      lines.push(line); size += Buffer.byteLength(line) + 1;
    }
    return { id, path: id, bytes: Buffer.from(lines.join("\n")) };
  });
}

/**
 * A source of about 21 KiB whose only non-ASCII character, an em dash, starts at byte 20,479: the index preview's 20 KiB limit falls
 * inside it, so the preview holds exactly the first 20,479 bytes.
 */
export function previewBoundarySource(id: string): { id: string; path: string; bytes: Buffer } {
  const ascii = Array.from({ length: 400 }, (_, j) => `Row ${j} of the boundary source records an invented observation.`).join("\n");
  return { id, path: id, bytes: Buffer.from(`${ascii.slice(0, 20 * 1024 - 1)}${EM_DASH} the preview limit falls inside this dash.\n${ascii.slice(0, 600)}`) };
}
