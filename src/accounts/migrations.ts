export const MIGRATIONS: { id: number; sql: string }[] = [
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
];

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Applies missing migrations in order and records their ids. */
export async function migrate(q: Query): Promise<void> {
  // Probe first: pg-mem cannot re-run "create table if not exists" with an inline primary key.
  try {
    await q("select id from schema_migrations limit 1");
  } catch {
    try {
      await q("create table schema_migrations (id int primary key)");
    } catch {
      // Lost a creation race to another instance; the read below fails if it really is missing.
    }
  }
  const done = new Set((await q("select id from schema_migrations")).rows.map((r) => Number(r.id)));
  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    // One statement per query: simple for every driver (migrations contain no semicolons inside literals).
    for (const stmt of m.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      // Postgres handles "if not exists" itself; pg-mem rejects it for an existing table with constraints, so probe first.
      const table = /^create table if not exists (\w+)/i.exec(stmt)?.[1];
      if (table && (await q(`select 1 from ${table} limit 1`).then(() => true, () => false))) continue;
      await q(stmt);
    }
    await q("insert into schema_migrations (id) values ($1) on conflict do nothing", [m.id]);
  }
}
