export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
create table users (
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
create table game_results (
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
create table page_views (
  id serial primary key,
  at timestamptz not null default now(),
  day text not null,
  path text not null,
  device_id text not null,
  user_id uuid
);
create index page_views_day on page_views (day);
create index game_results_day on game_results (day);
create index game_results_game_user on game_results (game, user_id);
`,
  },
];

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Applies missing migrations in order and records their ids. */
export async function migrate(q: Query): Promise<void> {
  await q("create table if not exists schema_migrations (id int primary key)");
  const done = new Set((await q("select id from schema_migrations")).rows.map((r) => Number(r.id)));
  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    // One statement per query: simple for every driver (migrations contain no semicolons inside literals).
    for (const stmt of m.sql.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
    await q("insert into schema_migrations (id) values ($1)", [m.id]);
  }
}
