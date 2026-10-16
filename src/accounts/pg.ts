import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { migrate } from "./migrations";
import type { AccountStore, NewUser } from "./store";
import { statDays, vnDay, vnDayStart, type AdminStats, type LeaderRow, type ResultRow, type Role, type UserPatch, type UserRow } from "./types";

const toUser = (r: any): UserRow => ({
  id: r.id,
  usernameKey: r.username_key,
  username: r.username,
  passwordHash: r.password_hash,
  role: r.role as Role,
  icon: r.icon,
  color: r.color,
  disabled: r.disabled,
  sessionVersion: Number(r.session_version),
  createdAt: new Date(r.created_at),
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at) : null,
});

const COLUMNS: Record<string, string> = {
  role: "role",
  disabled: "disabled",
  icon: "icon",
  color: "color",
  passwordHash: "password_hash",
  lastLoginAt: "last_login_at",
};

/** Arbitrary constant key for the migration advisory lock. */
const MIGRATION_LOCK = 724_001;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

class PgAccountStore implements AccountStore {
  readonly kind = "postgres" as const;
  constructor(private pool: Pool) {}

  async createUser(u: NewUser) {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `insert into users (id, username_key, username, password_hash, role, icon, color, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (username_key) do nothing returning *`,
      [id, u.usernameKey, u.username, u.passwordHash, u.role, u.icon, u.color, u.createdAt ?? new Date()],
    );
    // pg-mem returns the existing row on conflict; real Postgres returns none. Either way, a foreign id means "taken".
    return rows[0] && rows[0].id === id ? toUser(rows[0]) : null;
  }

  async userByKey(usernameKey: string) {
    const { rows } = await this.pool.query("select * from users where username_key = $1", [usernameKey]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async userById(id: string) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query("select * from users where id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async updateUser(id: string, patch: UserPatch) {
    if (!isUuid(id)) return null;
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, col] of Object.entries(COLUMNS)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (patch.bumpSession) sets.push("session_version = session_version + 1");
    if (!sets.length) return this.userById(id);
    const { rows } = await this.pool.query(`update users set ${sets.join(", ")} where id = $1 returning *`, params);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async recordResults(game: string, recordId: string, at: Date, rows: ResultRow[]) {
    if (!rows.length) return;
    // One lookup per row (a handful of players): avoids multi-parameter IN lists, which pg-mem mis-binds for text.
    const ids = new Map<string, string>();
    for (const r of rows) {
      const found = await this.pool.query("select id from users where username_key = $1", [r.usernameKey]);
      if (found.rows[0]) ids.set(r.usernameKey, found.rows[0].id);
    }
    const day = vnDay(at);
    for (const r of rows) {
      const uid = ids.get(r.usernameKey);
      if (!uid) continue;
      await this.pool.query(
        `insert into game_results (game, record_id, user_id, points, rank, won, at, day)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
        [game, recordId, uid, r.points, r.rank, r.rank === 1, at, day],
      );
    }
  }

  async leaderboard(game: string, limit: number): Promise<LeaderRow[]> {
    const { rows } = await this.pool.query(
      `select u.username as name, u.icon as icon, u.color as color, count(*) as games, sum(r.points) as points,
              sum(case when r.won then 1 else 0 end) as wins
       from game_results r join users u on u.id = r.user_id
       where r.game = $1 group by u.id, u.username, u.icon, u.color
       order by points desc, wins desc, name limit $2`,
      [game, limit],
    );
    return rows
      .map((r) => ({ name: r.name as string, points: Number(r.points), games: Number(r.games), wins: Number(r.wins), icon: r.icon as string, color: r.color as string }));
  }

  async trackView(v: { path: string; device: string; userId: string | null; at?: Date }) {
    const at = v.at ?? new Date();
    await this.pool.query("insert into page_views (at, day, path, device_id, user_id) values ($1, $2, $3, $4, $5)", [at, vnDay(at), v.path, v.device, v.userId]);
  }

  async stats(days: number, now = new Date()): Promise<AdminStats> {
    const list = statDays(days, now);
    const first = list[0];
    const last = list[list.length - 1];
    const daily = new Map(list.map((day) => [day, { day, views: 0, devices: 0, games: 0, players: 0, newUsers: 0 }]));
    const q = async (sql: string, params: unknown[]) => (await this.pool.query(sql, params)).rows;
    const win = [first, last];
    // Pages only: /play/* rows are WebSocket-join beacons counted separately as playDevices.
    const pageWhere = "day >= $1 and day <= $2 and path not like '/play/%'";

    for (const r of await q(`select day, count(*) as views, count(distinct device_id) as devices from page_views where ${pageWhere} group by day`, win)) {
      const d = daily.get(r.day);
      if (d) Object.assign(d, { views: Number(r.views), devices: Number(r.devices) });
    }
    for (const r of await q("select day, count(distinct game || ':' || record_id) as games, count(distinct user_id) as players from game_results where day >= $1 and day <= $2 group by day", win)) {
      const d = daily.get(r.day);
      if (d) Object.assign(d, { games: Number(r.games), players: Number(r.players) });
    }
    // Day buckets for sign-ups are computed in JS (vnDay), so fetch a slightly wider UTC range and bucket exactly.
    let newUsers = 0;
    for (const r of await q("select created_at from users where created_at >= $1", [vnDayStart(first)])) {
      const d = daily.get(vnDay(new Date(r.created_at)));
      if (d) {
        d.newUsers++;
        newUsers++;
      }
    }
    const [pv] = await q(`select count(*) as views, count(distinct device_id) as devices from page_views where ${pageWhere}`, win);
    const [pd] = await q("select count(distinct device_id) as devices from page_views where day >= $1 and day <= $2 and path like '/play/%'", win);
    const [gr] = await q("select count(distinct game || ':' || record_id) as games, count(distinct user_id) as players from game_results where day >= $1 and day <= $2", win);
    const [us] = await q("select count(*) as n from users", []);
    const byGame = (
      await q("select game, count(distinct record_id) as games, count(distinct user_id) as players from game_results where day >= $1 and day <= $2 group by game", win)
    )
      .map((r) => ({ game: r.game as string, games: Number(r.games), players: Number(r.players) }))
      .sort((a, b) => b.games - a.games || (a.game < b.game ? -1 : 1));
    const topPages = (await q(`select path, count(*) as views from page_views where ${pageWhere} group by path order by views desc, path limit 10`, win)).map((r) => ({ path: r.path as string, views: Number(r.views) }));
    const topPlayers = (
      await q(
        `select u.username as name, count(*) as games, sum(r.points) as points from game_results r join users u on u.id = r.user_id
         where r.day >= $1 and r.day <= $2 group by u.id, u.username order by games desc, points desc, name limit 10`,
        win,
      )
    ).map((r) => ({ name: r.name as string, games: Number(r.games), points: Number(r.points) }));
    return {
      days,
      totals: {
        users: Number(us.n),
        newUsers,
        views: Number(pv.views),
        devices: Number(pv.devices),
        games: Number(gr.games),
        players: Number(gr.players),
        playDevices: Number(pd.devices),
      },
      daily: list.map((d) => daily.get(d)!),
      byGame,
      topPages,
      topPlayers,
    };
  }

  async pruneViews(olderThanDays: number, now = new Date()) {
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
    const r = await this.pool.query("delete from page_views where at < $1", [cutoff]);
    return r.rowCount ?? 0;
  }

  async listUsers(q: string, page: number, pageSize: number) {
    // Escape LIKE wildcards (Postgres default escape is backslash). pg-mem ignores backslash escapes for `_`.
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    const total = await this.pool.query("select count(*) as n from users where username_key like $1", [like]);
    const { rows } = await this.pool.query("select * from users where username_key like $1 order by created_at desc, id limit $2 offset $3", [
      like,
      pageSize,
      (Math.max(1, page) - 1) * pageSize,
    ]);
    // Separate grouped query (rather than a correlated subquery) keeps the SQL simple for pg-mem.
    const games = new Map<string, number>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const marks = ids.map((_, i) => `$${i + 1}`).join(", ");
      const counts = await this.pool.query(`select user_id, count(*) as n from game_results where user_id in (${marks}) group by user_id`, ids);
      for (const c of counts.rows) games.set(c.user_id, Number(c.n));
    }
    return { rows: rows.map((r) => ({ ...toUser(r), games: games.get(r.id) ?? 0 })), total: Number(total.rows[0].n) };
  }
}

export async function createPgAccountStore(pool: Pool): Promise<AccountStore> {
  // One dedicated connection so the session-level advisory lock covers the whole migration.
  const client = await pool.connect();
  let locked = false;
  try {
    try {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
      locked = true;
    } catch {
      // pg-mem has no pg_advisory_lock; migrations are idempotent so continuing unlocked is safe.
    }
    await migrate((sql, params) => client.query(sql, params as any[]));
  } finally {
    if (locked) await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
  return new PgAccountStore(pool);
}
