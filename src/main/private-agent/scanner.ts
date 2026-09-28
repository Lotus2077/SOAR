import { secretPatterns } from "../../../scripts/secret-patterns.mjs";
import { canonical, digest, exactText } from "./contracts";
import type { LocalPacketScanner, ScanResult } from "./broker";

/**
 * Existing high-confidence credential patterns only. This is deliberately not a
 * PII classifier or a replacement for the separate learned-detector calibration.
 */
export class RulePacketScanner implements LocalPacketScanner {
  readonly identity = `soar-credential-patterns:${digest(canonical(secretPatterns.map(item => ({ name: item.name, source: item.pattern.source, flags: item.pattern.flags }))))}`;
  async scan(text: string): Promise<ScanResult> {
    exactText(text);
    if (Buffer.byteLength(text) > 512 * 1024) return { complete: false, blocked: false, detector: this.identity };
    return { complete: true, blocked: secretPatterns.some(item => item.pattern.test(text)), detector: this.identity };
  }
}
