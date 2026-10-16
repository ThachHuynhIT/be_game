import { randomUUID } from "node:crypto";
import type { Role, UserPatch, UserRow } from "./types";

export interface NewUser {
  usernameKey: string;
  username: string;
  passwordHash: string;
  role: Role;
  icon: string;
  color: string;
  /** Only for tests. */
  createdAt?: Date;
}

export interface AccountStore {
  readonly kind: "postgres" | "memory";
  /** null = the username key is taken. */
  createUser(u: NewUser): Promise<UserRow | null>;
  userByKey(usernameKey: string): Promise<UserRow | null>;
  userById(id: string): Promise<UserRow | null>;
  /** `bumpSession` increments sessionVersion (invalidates issued tokens). null = no such user. */
  updateUser(id: string, patch: UserPatch): Promise<UserRow | null>;
  listUsers(q: string, page: number, pageSize: number): Promise<{ rows: (UserRow & { games: number })[]; total: number }>;
}

const copy = (u: UserRow): UserRow => ({ ...u, createdAt: new Date(u.createdAt), lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null });

class MemoryAccountStore implements AccountStore {
  readonly kind = "memory" as const;
  private users = new Map<string, UserRow>();

  async createUser(u: NewUser) {
    for (const r of this.users.values()) if (r.usernameKey === u.usernameKey) return null;
    const row: UserRow = {
      id: randomUUID(),
      usernameKey: u.usernameKey,
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      icon: u.icon,
      color: u.color,
      disabled: false,
      sessionVersion: 0,
      createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
      lastLoginAt: null,
    };
    this.users.set(row.id, row);
    return copy(row);
  }

  async userByKey(usernameKey: string) {
    for (const r of this.users.values()) if (r.usernameKey === usernameKey) return copy(r);
    return null;
  }

  async userById(id: string) {
    const r = this.users.get(id);
    return r ? copy(r) : null;
  }

  async updateUser(id: string, patch: UserPatch) {
    const r = this.users.get(id);
    if (!r) return null;
    const { bumpSession, ...fields } = patch;
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) (r as any)[k] = v;
    if (bumpSession) r.sessionVersion += 1;
    return copy(r);
  }

  async listUsers(q: string, page: number, pageSize: number) {
    const needle = q.toLowerCase();
    const all = [...this.users.values()].filter((r) => r.usernameKey.includes(needle)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (Math.max(1, page) - 1) * pageSize;
    return { rows: all.slice(start, start + pageSize).map((r) => ({ ...copy(r), games: 0 })), total: all.length };
  }
}

export function createMemoryAccountStore(): AccountStore {
  return new MemoryAccountStore();
}
