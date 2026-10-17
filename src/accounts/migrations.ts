export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    sql: `
create table if not exists users (
  id uuid primary key,
  username_key text unique not null,
  username text not null,
  password_hash text not null,
  role text not null default 'user',
  icon text not null default '',
  color text not null default '#fbbf24',
  disabled boolean not null default false,
  session_version int not null default 0,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists game_results (
  game text,
  record_id text,
  user_id uuid,
  points int not null,
  rank int not null,
  won boolean not null,
  at timestamptz not null,
  day text not null,
  primary key (game, record_id, user_id)
);
create table if not exists page_views (
  id serial primary key,
  at timestamptz not null default now(),
  day text not null,
  path text not null,
  device_id text not null,
  user_id uuid
);
create index if not exists page_views_day on page_views (day);
create index if not exists game_results_day on game_results (day);
create index if not exists game_results_game_user on game_results (game, user_id);
`,
  },
  {
    // Integrity: only known roles, and results always point at a real user. Guarded so a re-run is harmless.
    id: 2,
    run: async (q) => {
      if (!(await constraintExists(q, "users_role_check"))) {
        await q("update users set role = 'user' where role not in ('user', 'admin')");
        await addConstraint(q, "alter table users add constraint users_role_check check (role in ('user', 'admin'))");
      }
      if (!(await constraintExists(q, "game_results_user_fk"))) {
        // Orphans never showed anywhere (every read joins users); they would only block the constraint.
        await q("delete from game_results where user_id not in (select id from users)");
        await addConstraint(q, "alter table game_results add constraint game_results_user_fk foreign key (user_id) references users (id)");
      }
    },
  },
];

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
export type Migration = { id: number; sql?: string; run?: (q: Query) => Promise<void> };

const constraintExists = async (q: Query, name: string) =>
  (await q("select 1 as x from information_schema.table_constraints where table_schema = current_schema() and constraint_name = $1 limit 1", [name])).rows.length > 0;

/** Postgres answers the guard above; pg-mem lists no constraints there, so its "already exists" is tolerated. */
async function addConstraint(q: Query, sql: string) {
  try {
    await q(sql);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (!(err?.code === "42P07" || err?.code === "42710" || /already exists/i.test(err?.message ?? ""))) throw e;
  }
}

/** Information-schema probes never raise, so they are safe inside a Postgres transaction (a failed statement would abort it). */
export const tableExists = async (q: Query, table: string) =>
  (await q("select 1 as x from information_schema.tables where table_schema = current_schema() and table_name = $1 limit 1", [table])).rows.length > 0;

/** Ids recorded in schema_migrations; empty when the table does not exist yet. */
export async function appliedMigrations(q: Query): Promise<Set<number>> {
  if (!(await tableExists(q, "schema_migrations"))) return new Set();
  return new Set((await q("select id from schema_migrations")).rows.map((r) => Number(r.id)));
}

export const allApplied = (done: Set<number>) => MIGRATIONS.every((m) => done.has(m.id));

/**
 * Applies missing migrations in order and records their ids. Run it inside the caller's transaction
 * (createPgAccountStore holds pg_advisory_xact_lock for the whole transaction).
 */
export async function migrate(q: Query): Promise<void> {
  if (!(await tableExists(q, "schema_migrations"))) await q("create table schema_migrations (id int primary key)");
  const done = await appliedMigrations(q);
  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    if (m.run) await m.run(q);
    // One statement per query: simple for every driver (migrations contain no semicolons inside literals).
    for (const stmt of (m.sql ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
      // Postgres handles "if not exists" itself; pg-mem rejects it for an existing table with constraints, so probe first.
      const table = /^create table if not exists (\w+)/i.exec(stmt)?.[1];
      if (table && (await tableExists(q, table))) continue;
      await q(stmt);
    }
    await q("insert into schema_migrations (id) values ($1) on conflict do nothing", [m.id]);
  }
}
