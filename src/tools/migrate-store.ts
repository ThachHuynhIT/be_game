// One-off copy of rooms and leaderboards from one Redis to another (e.g. the phone's local Redis → Upstash).
// Leaderboards are ADDED to the destination (run it once); rooms are copied only when the destination lacks them.
// Usage: tsx src/tools/migrate-store.ts --from <redis url> --to <redis url> [--dry-run]
import type { ChainableCommander, Redis } from "ioredis";
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
    const h = k.lbPlayer(key);
    const dstLast = Number((await dst.hget(h, "last")) ?? 0);
    // One transaction per player, so a failure cannot leave a half-added total behind.
    const tx = dst.multi();
    tx.zincrby(k.lbPoints, delta, key);
    tx.hincrby(h, "points", delta);
    tx.hincrby(h, "games", Number(p.games ?? 0));
    tx.hincrby(h, "wins", Number(p.wins ?? 0));
    if (Number(p.last ?? 0) >= dstLast) tx.hset(h, { name: p.name ?? key, last: p.last ?? "0" });
    await execAll(tx);
  }

  const codes = await src.zrange(k.index, 0, -1, "WITHSCORES");
  for (let i = 0; i < codes.length; i += 2) {
    const code = codes[i];
    const score = Number(codes[i + 1]);
    const [state, version] = await src.hmget(k.room(code), "state", "version");
    if (state == null || version == null) continue;
    const ttl = await src.pttl(k.room(code));
    // The room expired between the reads above: nothing to copy and nothing to count.
    if (ttl === -2) continue;
    if (await dst.exists(k.room(code))) {
      result.roomsSkipped++;
      continue;
    }
    result.roomsCopied++;
    if (dryRun) continue;
    const tx = dst.multi();
    tx.hset(k.room(code), { state, version });
    if (ttl > 0) tx.pexpire(k.room(code), ttl);
    tx.zadd(k.index, score, code);
    await execAll(tx);
  }
  return result;
}

export async function migrateAll(src: Redis, dst: Redis, dryRun: boolean): Promise<MigrateResult[]> {
  const out: MigrateResult[] = [];
  for (const game of GAME_KINDS) out.push(await migrateGame(src, dst, game, dryRun));
  return out;
}

/** exec() reports per-command failures in its replies instead of rejecting, so surface them (Redis does not roll back the rest of the transaction). */
async function execAll(tx: ChainableCommander): Promise<void> {
  const replies = await tx.exec();
  const failed = replies?.find(([err]) => err);
  if (failed?.[0]) throw failed[0];
}

/** Parses a store URL without ever echoing it: the message is fixed, so a password in the URL cannot leak. */
function parseStoreUrl(raw: string, flag: "--from" | "--to"): URL | null {
  try {
    return new URL(raw);
  } catch {
    console.error(`invalid ${flag} URL`);
    return null;
  }
}

/** Same host, port (6379 when omitted) and database: migrating a store into itself would double every total. */
function sameStore(a: URL, b: URL): boolean {
  const db = (u: URL) => u.pathname.replace(/^\//, "") || "0";
  return a.hostname === b.hostname && (a.port || "6379") === (b.port || "6379") && db(a) === db(b);
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
    process.exitCode = 1;
    return;
  }
  const fromUrl = parseStoreUrl(from, "--from");
  const toUrl = parseStoreUrl(to, "--to");
  if (!fromUrl || !toUrl) {
    process.exitCode = 1;
    return;
  }
  if (sameStore(fromUrl, toUrl)) {
    console.error("--from and --to are the same store");
    process.exitCode = 1;
    return;
  }
  const { default: IORedis } = await import("ioredis");
  const src = new IORedis(from, { maxRetriesPerRequest: 3 });
  const dst = new IORedis(to, { maxRetriesPerRequest: 3 });
  console.log(`${dryRun ? "[dry run] " : ""}${fromUrl.hostname} → ${toUrl.hostname}`);
  if (!dryRun) console.log("Leaderboards are ADDED to the destination: run this once.");
  let current: GameKind = GAME_KINDS[0];
  try {
    for (const game of GAME_KINDS) {
      current = game;
      const r = await migrateGame(src, dst, game, dryRun);
      console.log(`${r.game}: players ${r.players}, rooms copied ${r.roomsCopied}, rooms already there ${r.roomsSkipped}`);
    }
  } catch (e) {
    if (!dryRun) {
      console.error(
        `stopped during ${current}: games listed above are fully copied; ${current} may be partly applied. Do NOT re-run as-is (leaderboards would be added twice) - check the destination first.`,
      );
    }
    throw e;
  } finally {
    src.disconnect();
    dst.disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/migrate-store.ts")) {
  main(process.argv.slice(2)).catch((e) => {
    console.error((e instanceof Error && e.message) || "migration failed");
    process.exitCode = 1;
  });
}
