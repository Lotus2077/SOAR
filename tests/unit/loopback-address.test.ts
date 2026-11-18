import { describe, expect, it } from "vitest";
import { loopbackAddressForms } from "../helpers/loopback-address";

/** BL-20261117-1641-fixture-tests-loopback-address-forms: the role-fixture tests check records for these forms, never the bare port. */
describe("loopbackAddressForms: an address's forms, never the port's bare digits", () => {
  const forms = loopbackAddressForms("http://127.0.0.1:35339/v1");
  const holdsAddress = (text: string) => forms.some(form => text.includes(form));

  it("finds the base URL, the origin, and the host and port in each loopback spelling or before a path", () => {
    for (const leak of ["http://127.0.0.1:35339/v1/chat/completions", "{\"endpoint\":\"http://127.0.0.1:35339\"}", "127.0.0.1:35339", "localhost:35339",
      "[::1]:35339", "//host.docker.internal:35339/v1"]) expect(holdsAddress(leak)).toBe(true);
  });

  it("does not take the port's digits inside a digest, a number or a timestamp for an address (CI's check on #153)", () => {
    for (const benign of ["{\"bodySha256\":\"e44e9bdde8c35339a1\"}", "{\"elapsedMs\":35339}", "{\"bytes\":353390}", "2026-11-17T16:35:33.935Z", "run 35339 of 40000"])
      expect(holdsAddress(benign)).toBe(false);
  });

  it("refuses a base URL without an explicit port, whose `:port/` form every URL would hold", () => {
    expect(() => loopbackAddressForms("http://127.0.0.1/v1")).toThrow("loopback_address_without_port");
  });
});
