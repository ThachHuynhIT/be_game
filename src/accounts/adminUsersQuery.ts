import { nameKey } from "../server/store";
import { ownerKey } from "./owner";
import type { UserRow } from "./types";

/**
 * Filter and sort for the admin user list (GET /api/admin/users). Applied by the store before paging, so `total` and
 * every page follow the same order. The memory store uses `matchesAdminUser` / `compareAdminUsers`; the Postgres store
 * builds the same semantics in SQL from the allow-listed values only.
 */
export type AdminUsersFilter = "all" | "admin" | "disabled" | "owner";
export type AdminUsersSort = "createdAt" | "lastLoginAt" | "games";
export type SortOrder = "asc" | "desc";
export type AdminUsersOptions = { filter: AdminUsersFilter; sort: AdminUsersSort; order: SortOrder; ownerKey: string | null };

export const ADMIN_USERS_FILTERS: readonly AdminUsersFilter[] = ["all", "admin", "disabled", "owner"];
export const ADMIN_USERS_SORTS: readonly AdminUsersSort[] = ["createdAt", "lastLoginAt", "games"];
export const SORT_ORDERS: readonly SortOrder[] = ["asc", "desc"];
export const BAD_USERS_QUERY = "Bộ lọc hoặc sắp xếp không hợp lệ";
/** All users, newest first: the order the list had before filters existed. */
export const DEFAULT_ADMIN_USERS_OPTIONS: AdminUsersOptions = { filter: "all", sort: "createdAt", order: "desc", ownerKey: null };

const pick = <T extends string>(params: URLSearchParams, key: string, allowed: readonly T[], fallback: T): T | null => {
  const v = params.get(key);
  if (v === null) return fallback;
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
};

export function parseAdminUsersOptions(params: URLSearchParams, ownerUsername: string | undefined): { ok: true; options: AdminUsersOptions } | { ok: false; error: string } {
  const filter = pick(params, "filter", ADMIN_USERS_FILTERS, DEFAULT_ADMIN_USERS_OPTIONS.filter);
  const sort = pick(params, "sort", ADMIN_USERS_SORTS, DEFAULT_ADMIN_USERS_OPTIONS.sort);
  const order = pick(params, "order", SORT_ORDERS, DEFAULT_ADMIN_USERS_OPTIONS.order);
  if (!filter || !sort || !order) return { ok: false, error: BAD_USERS_QUERY };
  return { ok: true, options: { filter, sort, order, ownerKey: ownerKey(ownerUsername) } };
}

/** The search text normalised like a username key (NFC, trimmed, single spaces, lower case); accents are kept. */
export const normalizeAdminSearch = (q: string) => nameKey(q);

/** `q` is already normalised; it is matched as a plain substring of the username key. */
export function matchesAdminUser(u: UserRow, q: string, o: AdminUsersOptions): boolean {
  if (!u.usernameKey.includes(q)) return false;
  if (o.filter === "admin") return u.role === "admin";
  if (o.filter === "disabled") return u.disabled;
  if (o.filter === "owner") return o.ownerKey !== null && u.usernameKey === o.ownerKey;
  return true;
}

/** Order by the chosen key; never-logged-in users last in both directions; ties by id ascending. Does not mutate. */
export function compareAdminUsers(a: UserRow & { games: number }, b: UserRow & { games: number }, o: AdminUsersOptions): number {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const dir = o.order === "asc" ? 1 : -1;
  if (o.sort === "lastLoginAt") {
    const x = a.lastLoginAt?.getTime() ?? null;
    const y = b.lastLoginAt?.getTime() ?? null;
    if (x === null || y === null) return x === y ? byId : x === null ? 1 : -1;
    return (x - y) * dir || byId;
  }
  const x = o.sort === "games" ? a.games : a.createdAt.getTime();
  const y = o.sort === "games" ? b.games : b.createdAt.getTime();
  return (x - y) * dir || byId;
}
