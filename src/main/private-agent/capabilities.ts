import { canonical, digest } from "./contracts";

export const SANDBOX_CAPABILITIES_VERSION = 1;
const QUALIFIED_IMAGE = "sha256:e5c7075fac7a7a68900db45e3de06e50e7b0f6896a5ca0f82cddb4ef8ad4ac2f";

// Retained public synthetic qualification, not a new probe or a claim for another image.
// Evidence identities contain no local evidence paths or environment values.
const QUALIFICATION_EVIDENCE = Object.freeze({
  qualificationSha256: "282761a035db5087cb73063bad3b96ae8d1af9ef7880d77aad08e26b1b52ceea",
  probeTerminalSha256: "d1d8b84b45c4b4ac28c647f3df7a8c2db197743704d9bfb9ff2dd1b7c097ce48",
  capabilityReceiptSha256: "0a021a3795338a8c282a208dd4060124a934a325d9f1485afaf0f7f6ec8c91c3",
  imageInspectionSha256: "3d8bac7dff4a57b3a4b62bc39939e96930652509e162624bf9e5f4dae186ebba",
  dockerfileSha256: "cbf1bc148cd328ac1d084c3c036ce3890e2837a2682c8c8bf6f036d26d7149ed",
  requirementsSha256: "9f7de5d75c0da089859901b179b73c02d2a434c8f38a9d026ed004fe541c21cf",
  sandboxSourceSha256: "100c0b0281ce149a4bbbad08be7bd7fec480c52d4518db1906609c86b0beee7e",
});
type Unverified = { status: "unverified" };
export interface SandboxCapabilityDescriptor {
  version: 1;
  imageId: string;
  qualification: "verified_for_image" | "unverified";
  evidenceSha256: string | null;
  evidence: typeof QUALIFICATION_EVIDENCE | null;
  tools: {
    python: Unverified | { status: "verified_for_image"; command: "python3"; isolated: true };
    pythonPlaywright: Unverified | { status: "verified_for_image"; version: string; import: "playwright.sync_api";
      chromiumVersion: string; executablePath: "/usr/bin/chromium"; headless: true; args: string[] };
    libreOffice: Unverified | { status: "verified_for_image"; version: string; command: "libreoffice"; headless: true; profileDirectory: "/tmp" };
    node: Unverified;
  };
}
export interface SandboxCapabilities { descriptor: SandboxCapabilityDescriptor; guidance: string; identity: string }

/** Call only with the host-selected image identity; this descriptor grants no execution authority. */
export function capabilitiesForImage(imageId: string): SandboxCapabilities {
  if (typeof imageId !== "string" || imageId.length !== 71 || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("sandbox_capability_image_invalid");
  const qualified = imageId === QUALIFIED_IMAGE;
  const evidence = qualified ? { ...QUALIFICATION_EVIDENCE } : null;
  const descriptor: SandboxCapabilityDescriptor = {
    version: SANDBOX_CAPABILITIES_VERSION, imageId, qualification: qualified ? "verified_for_image" : "unverified",
    evidenceSha256: evidence ? digest(canonical(evidence)) : null, evidence,
    tools: qualified ? {
      python: { status: "verified_for_image", command: "python3", isolated: true },
      pythonPlaywright: { status: "verified_for_image", version: "1.62.0", import: "playwright.sync_api", chromiumVersion: "152.0.7977.82",
        executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] },
      libreOffice: { status: "verified_for_image", version: "25.2.3.2", command: "libreoffice", headless: true, profileDirectory: "/tmp" },
      node: { status: "unverified" },
    } : { python: { status: "unverified" }, pythonPlaywright: { status: "unverified" }, libreOffice: { status: "unverified" }, node: { status: "unverified" } },
  };
  const guidance = qualified
    ? "Host-qualified capabilities for this exact immutable image: Python via python3 -I; Python Playwright 1.62.0 using from playwright.sync_api import sync_playwright. " +
      "Inside the existing restricted Docker context only, launch with playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage']). " +
      "LibreOffice 25.2.3.2 headless rendering was exercised; put its UserInstallation profile under /tmp (for example -env:UserInstallation=file:///tmp/soar-lo-profile). " +
      "The same probe exercised python-docx 1.2.0, openpyxl 3.1.5, python-pptx 1.0.2 and pypdf 6.18.0 for document creation/readback. " +
      "Node and npm were not qualified; do not assume they are present. These are retained image capability checks, not a fresh availability probe or proof that an artifact is correct. " +
      "Chromium capture reliability and Microsoft Office compatibility are not guaranteed. No new install, network permission or task acceptance is granted."
    : "This immutable image has no host-qualified capability inventory. Python, Python Playwright with Chromium, LibreOffice, Node and npm remain unverified; do not assume any is present. " +
      "The host did not perform a capability probe. This inventory grants no install, network permission or task acceptance.";
  const identity = digest(canonical({ descriptor, guidance }));
  return { descriptor, guidance, identity };
}
