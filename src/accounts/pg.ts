import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { migrate } from "./migrations";
import type { AccountStore, NewUser } from "./store";
import type { Role, UserPatch, UserRow } from "./types";

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
