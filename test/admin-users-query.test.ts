import { describe, expect, it } from "vitest";
import { BAD_USERS_QUERY, DEFAULT_ADMIN_USERS_OPTIONS, compareAdminUsers, matchesAdminUser, normalizeAdminSearch, parseAdminUsersOptions } from "../src/accounts/adminUsersQuery";
import type { UserRow } from "../src/accounts/types";

const row = (id: string, over: Partial<UserRow> = {}, games = 0): UserRow & { games: number } => ({
  id,
  usernameKey: id,
  username: id,
  passwordHash: "x",
  role: "user",
  icon: "",
  color: "#fbbf24",
  disabled: false,
  sessionVersion: 0,
  createdAt: new Date(1000),
  lastLoginAt: null,
  ...over,
  games,
});
const parse = (qs: string, owner?: string) => parseAdminUsersOptions(new URLSearchParams(qs), owner);

describe("parseAdminUsersOptions", () => {
  it("defaults keep the old order: all users, newest first", () => {
    expect(parse("")).toEqual({ ok: true, options: { ...DEFAULT_ADMIN_USERS_OPTIONS, ownerKey: null } });
    expect(DEFAULT_ADMIN_USERS_OPTIONS).toMatchObject({ filter: "all", sort: "createdAt", order: "desc" });
  });

  it("accepts every value of each enum and the owner key", () => {
    for (const filter of ["all", "admin", "disabled", "owner"]) expect(parse(`filter=${filter}`).ok).toBe(true);
    for (const sort of ["createdAt", "lastLoginAt", "games"]) for (const order of ["asc", "desc"]) expect(parse(`sort=${sort}&order=${order}`).ok).toBe(true);
    expect(parse("filter=owner", " CHU  Nha ")).toMatchObject({ ok: true, options: { filter: "owner", ownerKey: "chu nha" } });
  });

  it("rejects unknown filter, sort or order (no free text reaches SQL)", () => {
    for (const qs of ["filter=role", "sort=username", "sort=created_at;drop table users", "order=up", "filter=", "sort="]) {
      expect(parse(qs)).toEqual({ ok: false, error: BAD_USERS_QUERY });
    }
  });
});

describe("normalizeAdminSearch", () => {
  it("normalises like usernames (NFC, case, spaces) but keeps Vietnamese accents", () => {
    expect(normalizeAdminSearch("  Hoà   LAN ")).toBe("hoà lan");
    expect(normalizeAdminSearch("Bình")).toBe("bình");
    expect(normalizeAdminSearch("Bình")).not.toBe("binh");
  });
});

describe("matchesAdminUser", () => {
  const opts = (filter: "all" | "admin" | "disabled" | "owner", ownerKey: string | null = null) => ({ ...DEFAULT_ADMIN_USERS_OPTIONS, filter, ownerKey });

  it("combines search and filter", () => {
    const lanAdmin = row("lan", { role: "admin" });
    const lanUser = row("lanh");
    expect(matchesAdminUser(lanAdmin, "lan", opts("admin"))).toBe(true);
    expect(matchesAdminUser(lanUser, "lan", opts("admin"))).toBe(false);
    expect(matchesAdminUser(lanUser, "xyz", opts("all"))).toBe(false);
    expect(matchesAdminUser(row("a", { disabled: true }), "", opts("disabled"))).toBe(true);
    expect(matchesAdminUser(row("a"), "", opts("disabled"))).toBe(false);
  });

  it("matches the search literally, so % and _ are not wildcards", () => {
    expect(matchesAdminUser(row("axb"), "a_b", opts("all"))).toBe(false);
    expect(matchesAdminUser(row("abc"), "%", opts("all"))).toBe(false);
  });

  it("owner filter matches only the owner, and nobody when no owner is set", () => {
    expect(matchesAdminUser(row("chu nha"), "", opts("owner", "chu nha"))).toBe(true);
    expect(matchesAdminUser(row("lan"), "", opts("owner", "chu nha"))).toBe(false);
    expect(matchesAdminUser(row("chu nha"), "", opts("owner", null))).toBe(false);
  });
});

describe("compareAdminUsers", () => {
  const sorted = (rows: (UserRow & { games: number })[], sort: "createdAt" | "lastLoginAt" | "games", order: "asc" | "desc") => {
    const input = [...rows];
    const out = [...rows].sort((a, b) => compareAdminUsers(a, b, { ...DEFAULT_ADMIN_USERS_OPTIONS, sort, order }));
    expect(rows).toEqual(input);
    return out.map((r) => r.id);
  };

  it("sorts by creation time both ways", () => {
    const rows = [row("b", { createdAt: new Date(2) }), row("a", { createdAt: new Date(3) }), row("c", { createdAt: new Date(1) })];
    expect(sorted(rows, "createdAt", "desc")).toEqual(["a", "b", "c"]);
    expect(sorted(rows, "createdAt", "asc")).toEqual(["c", "b", "a"]);
  });

  it("puts never-logged-in users last in both directions", () => {
    const rows = [row("n1"), row("x", { lastLoginAt: new Date(5) }), row("n0"), row("y", { lastLoginAt: new Date(9) })];
    expect(sorted(rows, "lastLoginAt", "desc")).toEqual(["y", "x", "n0", "n1"]);
    expect(sorted(rows, "lastLoginAt", "asc")).toEqual(["x", "y", "n0", "n1"]);
  });

  it("sorts by games, zero included, ties by id ascending", () => {
    const rows = [row("d", {}, 0), row("b", {}, 3), row("a", {}, 3), row("c", {}, 7)];
    expect(sorted(rows, "games", "desc")).toEqual(["c", "a", "b", "d"]);
    expect(sorted(rows, "games", "asc")).toEqual(["d", "a", "b", "c"]);
  });
});
