import { randomUUID } from "node:crypto";
import { isPlayPath, statDays, vnDay, type AdminStats, type LeaderRow, type ResultRow, type Role, type UserPatch, type UserRow } from "./types";

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
  /** Unknown users are skipped; rows already recorded for (game, recordId, user) are ignored. */
  recordResults(game: string, recordId: string, at: Date, rows: ResultRow[]): Promise<void>;
  /** ORDER BY points DESC, wins DESC, name. */
  leaderboard(game: string, limit: number): Promise<LeaderRow[]>;
  trackView(v: { path: string; device: string; userId: string | null; at?: Date }): Promise<void>;
  stats(days: number, now?: Date): Promise<AdminStats>;
  /** Returns the number of deleted rows. */
  pruneViews(olderThanDays: number, now?: Date): Promise<number>;
}

const copy = (u: UserRow): UserRow => ({ ...u, createdAt: new Date(u.createdAt), lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null });

class MemoryAccountStore implements AccountStore {
  readonly kind = "memory" as const;
  private users = new Map<string, UserRow>();
  private results = new Map<string, { game: string; recordId: string; userId: string; points: number; won: boolean; day: string }>();
  private views: { at: Date; day: string; path: string; device: string; userId: string | null }[] = [];

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
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) (r as any)[k] = v instanceof Date ? new Date(v) : v;
    if (bumpSession) r.sessionVersion += 1;
    return copy(r);
  }

  private gamesOf(userId: string) {
    let n = 0;
    for (const r of this.results.values()) if (r.userId === userId) n++;
    return n;
  }

  async recordResults(game: string, recordId: string, at: Date, rows: ResultRow[]) {
    for (const row of rows) {
      const u = await this.userByKey(row.usernameKey);
      if (!u) continue;
      const key = `${game}\u0000${recordId}\u0000${u.id}`;
      if (this.results.has(key)) continue;
      this.results.set(key, { game, recordId, userId: u.id, points: row.points, won: row.rank === 1, day: vnDay(at) });
    }
  }

  async leaderboard(game: string, limit: number) {
    const agg = new Map<string, LeaderRow>();
    for (const r of this.results.values()) {
      if (r.game !== game) continue;
      const u = this.users.get(r.userId);
      if (!u) continue;
      const a = agg.get(u.id) ?? { name: u.username, points: 0, games: 0, wins: 0, icon: u.icon, color: u.color };
      a.points += r.points;
      a.games += 1;
      a.wins += r.won ? 1 : 0;
      agg.set(u.id, a);
    }
    return [...agg.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, limit);
  }

  async trackView(v: { path: string; device: string; userId: string | null; at?: Date }) {
    const at = v.at ?? new Date();
    this.views.push({ at, day: vnDay(at), path: v.path, device: v.device, userId: v.userId });
  }

  async stats(days: number, now = new Date()): Promise<AdminStats> {
    const list = statDays(days, now);
    const idx = new Map(list.map((d, i) => [d, i]));
    const daily = list.map((day) => ({ day, views: 0, devices: 0, games: 0, players: 0, newUsers: 0 }));
    const set = () => new Set<string>();
    const dDev = list.map(set), dGame = list.map(set), dPlayer = list.map(set);
    const tDev = set(), tPlayDev = set(), tGame = set(), tPlayer = set();
    const pages = new Map<string, number>();
    let tViews = 0;
    for (const v of this.views) {
      const i = idx.get(v.day);
      if (i === undefined) continue;
      if (isPlayPath(v.path)) {
        tPlayDev.add(v.device);
        continue;
      }
      daily[i].views++;
      dDev[i].add(v.device);
      tViews++;
      tDev.add(v.device);
      pages.set(v.path, (pages.get(v.path) ?? 0) + 1);
    }
    const perGame = new Map<string, { rec: Set<string>; pl: Set<string> }>();
    const perPlayer = new Map<string, { games: number; points: number }>();
    for (const r of this.results.values()) {
      const i = idx.get(r.day);
      if (i === undefined) continue;
      dGame[i].add(`${r.game}:${r.recordId}`);
      dPlayer[i].add(r.userId);
      tGame.add(`${r.game}:${r.recordId}`);
      tPlayer.add(r.userId);
      const g = perGame.get(r.game) ?? { rec: set(), pl: set() };
      g.rec.add(r.recordId);
      g.pl.add(r.userId);
      perGame.set(r.game, g);
      const p = perPlayer.get(r.userId) ?? { games: 0, points: 0 };
      p.games++;
      p.points += r.points;
      perPlayer.set(r.userId, p);
    }
    let newUsers = 0;
    for (const u of this.users.values()) {
      const i = idx.get(vnDay(u.createdAt));
      if (i === undefined) continue;
      daily[i].newUsers++;
      newUsers++;
    }
    daily.forEach((d, i) => {
      d.devices = dDev[i].size;
      d.games = dGame[i].size;
      d.players = dPlayer[i].size;
    });
    return {
      days,
      totals: { users: this.users.size, newUsers, views: tViews, devices: tDev.size, games: tGame.size, players: tPlayer.size, playDevices: tPlayDev.size },
      daily,
      byGame: [...perGame].map(([game, g]) => ({ game, games: g.rec.size, players: g.pl.size })).sort((a, b) => b.games - a.games || (a.game < b.game ? -1 : 1)),
      topPages: [...pages].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views || (a.path < b.path ? -1 : 1)).slice(0, 10),
      topPlayers: [...perPlayer]
        .map(([id, p]) => ({ name: this.users.get(id)?.username ?? "", games: p.games, points: p.points }))
        .sort((a, b) => b.games - a.games || b.points - a.points || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, 10),
    };
  }

  async pruneViews(olderThanDays: number, now = new Date()) {
    const cutoff = now.getTime() - olderThanDays * 86_400_000;
    const before = this.views.length;
    this.views = this.views.filter((v) => v.at.getTime() >= cutoff);
    return before - this.views.length;
  }

  async listUsers(q: string, page: number, pageSize: number) {
    const needle = q.toLowerCase();
    const all = [...this.users.values()].filter((r) => r.usernameKey.includes(needle)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    const start = (Math.max(1, page) - 1) * pageSize;
    return { rows: all.slice(start, start + pageSize).map((r) => ({ ...copy(r), games: this.gamesOf(r.id) })), total: all.length };
  }
}

export function createMemoryAccountStore(): AccountStore {
  return new MemoryAccountStore();
}
