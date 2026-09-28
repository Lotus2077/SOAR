import { describe, expect, it } from "vitest";
import { capabilitiesForImage, SANDBOX_CAPABILITIES_VERSION } from "../../src/main/private-agent/capabilities";
import { canonical, digest } from "../../src/main/private-agent/contracts";

const qualifiedImage = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";

describe("host-qualified sandbox capabilities", () => {
  it("qualifies only the exact immutable image and preserves the exercised Python Chromium invocation", () => {
    const value = capabilitiesForImage(qualifiedImage);
    expect(value.descriptor.version).toBe(SANDBOX_CAPABILITIES_VERSION);
    expect(value.descriptor.qualification).toBe("verified_for_image");
    expect(value.descriptor.tools.pythonPlaywright).toMatchObject({ status: "verified_for_image", import: "playwright.sync_api",
      executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    expect(value.guidance).toContain("Inside the existing restricted Docker context only");
    expect(value.guidance).toContain("not a fresh availability probe");
    expect(value.descriptor.tools.node.status).toBe("unverified");
    expect(value.guidance).toContain("Node and npm were not qualified");
  });

  it("one changed image byte removes every positive capability and evidence claim", () => {
    for (const id of [qualifiedImage.slice(0, -1) + "0", `sha256:${"0".repeat(64)}`]) {
      const value = capabilitiesForImage(id);
      expect(value.descriptor.imageId).toBe(id);
      expect(value.descriptor.qualification).toBe("unverified");
      expect(value.descriptor.evidence).toBeNull(); expect(value.descriptor.evidenceSha256).toBeNull();
      expect(Object.values(value.descriptor.tools)).toEqual(Array.from({ length: 4 }, () => ({ status: "unverified" })));
      expect(value.guidance).not.toContain("--no-sandbox");
      expect(value.guidance).not.toContain("1.62.0");
    }
  });

  it.each(["latest", "artifact:latest", qualifiedImage + "\n", qualifiedImage.toUpperCase(), "https://synthetic.invalid/private-value", ""])(
    "rejects an invalid or mutable image identity without echoing it: %s", id => {
      expect(() => capabilitiesForImage(id)).toThrow(/^sandbox_capability_image_invalid$/u);
    });

  it("binds the evidence bundle, image descriptor and exact guidance deterministically", () => {
    const first = capabilitiesForImage(qualifiedImage), second = capabilitiesForImage(qualifiedImage);
    expect(second).toEqual(first);
    expect(first.descriptor.evidenceSha256).toBe(digest(canonical(first.descriptor.evidence)));
    expect(first.identity).toBe(digest(canonical({ descriptor: first.descriptor, guidance: first.guidance })));
    expect(Object.values(first.descriptor.evidence!)).toHaveLength(7);
    for (const hash of Object.values(first.descriptor.evidence!)) expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest(canonical({ descriptor: first.descriptor, guidance: first.guidance + " changed" }))).not.toBe(first.identity);
    expect(capabilitiesForImage(`sha256:${"0".repeat(64)}`).identity).not.toBe(first.identity);
  });

  it("returns independent data so one caller cannot broaden later inventories", () => {
    const first = capabilitiesForImage(qualifiedImage), original = structuredClone(first);
    first.descriptor.qualification = "unverified";
    if (first.descriptor.tools.pythonPlaywright.status === "verified_for_image") first.descriptor.tools.pythonPlaywright.args.push("--unexpected");
    Object.assign(first.descriptor.evidence!, { qualificationSha256: "0".repeat(64) });
    expect(capabilitiesForImage(qualifiedImage)).toEqual(original);
    const unknown = capabilitiesForImage(`sha256:${"0".repeat(64)}`); Object.assign(unknown.descriptor.tools.node, { status: "verified_for_image" });
    expect(capabilitiesForImage(`sha256:${"0".repeat(64)}`).descriptor.tools.node.status).toBe("unverified");
  });

  it("keeps both variants bounded and free of local evidence paths or mutable environment claims", () => {
    for (const image of [qualifiedImage, `sha256:${"0".repeat(64)}`]) {
      const value = capabilitiesForImage(image), text = canonical(value);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096);
      expect(Buffer.byteLength(JSON.stringify(value.guidance))).toBeLessThanOrEqual(2048);
      for (const forbidden of [".soar/", "/Users/", "process.env", "apiKey", "credential", "endpoint"]) expect(text).not.toContain(forbidden);
      expect(value.guidance).toContain("network permission");
    }
  });
});
