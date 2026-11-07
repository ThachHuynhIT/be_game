import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNER_LOCK, OWNER_PASSWORD, OWNER_ROLE, isOwnerUsername, ownerKey, ownerUpdateProblem, warnIfOwnerUnconfigured } from "../src/accounts/owner";

const owner = { id: "u-owner", username: "Chu Nha" };
const other = { id: "u-other", username: "Lan" };

describe("owner identity", () => {
  it("uses nameKey: case, NFC and whitespace do not matter", () => {
    expect(isOwnerUsername("Chu Nha", "chu nha")).toBe(true);
    expect(isOwnerUsername("Chu Nha", "  CHU   NHA ")).toBe(true);
    // "Hoà" in NFD (a + combining grave) equals the NFC spelling.
    expect(isOwnerUsername("Hoà", "Hoà")).toBe(true);
    expect(isOwnerUsername("Lan", "Chu Nha")).toBe(false);
  });

  it("has no owner when the setting is missing or blank", () => {
    expect(ownerKey(undefined)).toBeNull();
    expect(ownerKey("")).toBeNull();
    expect(ownerKey("   ")).toBeNull();
    expect(isOwnerUsername("Chu Nha", undefined)).toBe(false);
    expect(isOwnerUsername("Chu Nha", " ")).toBe(false);
  });
});

describe("ownerUpdateProblem", () => {
  it("refuses another admin changing the owner's role, locking them or setting their password", () => {
    expect(ownerUpdateProblem("u-boss", owner, { role: "user" }, "Chu Nha")).toBe(OWNER_ROLE);
    expect(ownerUpdateProblem("u-boss", owner, { role: "admin" }, "Chu Nha")).toBe(OWNER_ROLE);
    expect(ownerUpdateProblem("u-boss", owner, { disabled: true }, "Chu Nha")).toBe(OWNER_LOCK);
    expect(ownerUpdateProblem("u-boss", owner, { password: "x".repeat(20) }, "Chu Nha")).toBe(OWNER_PASSWORD);
    expect(ownerUpdateProblem("u-boss", owner, { password: "" }, "Chu Nha")).toBe(OWNER_PASSWORD);
  });

  it("reports role before lock before password for a mixed patch", () => {
    expect(ownerUpdateProblem("u-boss", owner, { role: "user", disabled: true, password: "x" }, "Chu Nha")).toBe(OWNER_ROLE);
    expect(ownerUpdateProblem("u-boss", owner, { disabled: true, password: "x" }, "Chu Nha")).toBe(OWNER_LOCK);
  });

  it("lets the owner act on their own account, lets others unlock the owner, and leaves other targets alone", () => {
    expect(ownerUpdateProblem("u-owner", owner, { password: "x".repeat(20) }, "Chu Nha")).toBeNull();
    expect(ownerUpdateProblem("u-boss", owner, { disabled: false }, "Chu Nha")).toBeNull();
    expect(ownerUpdateProblem("u-boss", owner, {}, "Chu Nha")).toBeNull();
    expect(ownerUpdateProblem("u-boss", other, { role: "user", disabled: true, password: "x" }, "Chu Nha")).toBeNull();
    expect(ownerUpdateProblem("u-boss", owner, { role: "user" }, undefined)).toBeNull();
  });
});

describe("warnIfOwnerUnconfigured", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns once per process when unset, never with a value, and not at all when set", async () => {
    vi.resetModules();
    const mod = await import("../src/accounts/owner");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mod.warnIfOwnerUnconfigured({ OWNER_USERNAME: "Chu Nha" });
    expect(warn).not.toHaveBeenCalled();
    mod.warnIfOwnerUnconfigured({});
    mod.warnIfOwnerUnconfigured({ OWNER_USERNAME: "  " });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[be_game] OWNER_USERNAME is not set; owner protection is disabled.");
  });

  it("is exported for the server start", () => {
    expect(typeof warnIfOwnerUnconfigured).toBe("function");
  });
});
