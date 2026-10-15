// One-off copy of rooms and leaderboards from one Redis to another (e.g. the phone's local Redis → Upstash).
// Leaderboards are ADDED to the destination (run it once); rooms are copied only when the destination lacks them.
// Usage: tsx src/tools/migrate-store.ts --from <redis url> --to <redis url> [--dry-run]
import type { Redis } from "ioredis";
import { GAME_KINDS, type GameKind, keysFor } from "../server/store";

export interface MigrateResult {
  game: GameKind;
  players: number;
  roomsCopied: number;
  roomsSkipped: number;
}

export async function migrateGame(src: Redis, dst: Redis, game: GameKind, dryRun: boolean): Promise<MigrateResult> {
  const k = keysFor(game);
  const result: MigrateResult = { game, players: 0, roomsCopied: 0, roomsSkipped: 0 };

  const members = await src.zrange(k.lbPoints, 0, -1);
  for (const key of members) {
    const p = await src.hgetall(k.lbPlayer(key));
    result.players++;
    if (dryRun) continue;
    const delta = Number(p.points ?? (await src.zscore(k.lbPoints, key)) ?? 0);
    await dst.zincrby(k.lbPoints, delta, key);
    const h = k.lbPlayer(key);
    await dst.hincrby(h, "points", delta);
    await dst.hincrby(h, "games", Number(p.games ?? 0));
    await dst.hincrby(h, "wins", Number(p.wins ?? 0));
    const dstLast = Number((await dst.hget(h, "last")) ?? 0);
    if (Number(p.last ?? 0) >= dstLast) await dst.hset(h, { name: p.name ?? key, last: p.last ?? "0" });
  }

  const codes = await src.zrange(k.index, 0, -1, "WITHSCORES");
  for (let i = 0; i < codes.length; i += 2) {
    const code = codes[i];
    const score = Number(codes[i + 1]);
    const [state, version] = await src.hmget(k.room(code), "state", "version");
    if (state == null || version == null) continue;
    if (await dst.exists(k.room(code))) {
      result.roomsSkipped++;
      continue;
    }
    result.roomsCopied++;
    if (dryRun) continue;
    const ttl = await src.pttl(k.room(code));
    await dst.hset(k.room(code), { state, version });
    if (ttl > 0) await dst.pexpire(k.room(code), ttl);
    await dst.zadd(k.index, score, code);
  }
  return result;
}

export async function migrateAll(src: Redis, dst: Redis, dryRun: boolean): Promise<MigrateResult[]> {
  const out: MigrateResult[] = [];
  for (const game of GAME_KINDS) out.push(await migrateGame(src, dst, game, dryRun));
  return out;
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = arg("--from");
  const to = arg("--to");
  const dryRun = argv.includes("--dry-run");
  if (!from || !to) {
    console.error("usage: tsx src/tools/migrate-store.ts --from <redis url> --to <redis url> [--dry-run]");
    process.exit(1);
  }
  const { default: IORedis } = await import("ioredis");
  const src = new IORedis(from, { maxRetriesPerRequest: 3 });
  const dst = new IORedis(to, { maxRetriesPerRequest: 3 });
  console.log(`${dryRun ? "[dry run] " : ""}${new URL(from).hostname} → ${new URL(to).hostname}`);
  if (!dryRun) console.log("Leaderboards are ADDED to the destination: run this once.");
  try {
    for (const r of await migrateAll(src, dst, dryRun)) {
      console.log(`${r.game}: players ${r.players}, rooms copied ${r.roomsCopied}, rooms already there ${r.roomsSkipped}`);
    }
  } finally {
    src.disconnect();
    dst.disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/migrate-store.ts")) void main(process.argv.slice(2));
