import { describe, expect, it } from "vitest";

import { FakeCredentialStore } from "../../src/main/providers/credential-store";

describe("FakeCredentialStore", () => {
  it("supports deterministic add, replace, read, and delete semantics", async () => {
    const store = new FakeCredentialStore();
    expect(await store.read("cloud-primary")).toBeUndefined();

    await store.write("cloud-primary", "first-test-value");
    await store.write("cloud-primary", "replacement-test-value");

    expect(store.references()).toEqual(["cloud-primary"]);
    expect(await store.read("cloud-primary")).toBe("replacement-test-value");
    expect(await store.delete("cloud-primary")).toBe(true);
    expect(await store.delete("cloud-primary")).toBe(false);
    expect(await store.read("cloud-primary")).toBeUndefined();
  });

  it("rejects invalid references and malformed values", async () => {
    const store = new FakeCredentialStore();
    await expect(store.write("../escape", "value")).rejects.toThrow(
      /bounded opaque identifier/u,
    );
    await expect(store.write("cloud-primary", " value ")).rejects.toThrow(
      /bounded exact value/u,
    );
    await expect(store.write("cloud-primary", "")).rejects.toThrow(
      /bounded exact value/u,
    );
  });
});
