// Grants the admin role to one existing account, by user id. This is the only way to make an admin besides an admin
// using /admin: registering or signing in never grants a role (ADMIN_USERNAMES only reserves names).
// The operator first checks who owns the account: the id is `user.id` in that person's `GET /api/auth/me`.
// Usage: tsx src/tools/bootstrap-admin.ts <user-id>          (shows the account, changes nothing)
//        tsx src/tools/bootstrap-admin.ts <user-id> --yes    (grants admin)
// Needs DATABASE_URL (the server's database). Changes only that account's role: no password, session or other account.
import { openAccountStore } from "../accounts/service";
import type { AccountStore } from "../accounts/store";

export type GrantResult =
  | { ok: true; status: "already" | "dry-run" | "granted"; username: string }
  | { ok: false; error: string };

export async function grantAdmin(store: AccountStore, uid: string, apply: boolean): Promise<GrantResult> {
  const user = await store.userById(uid);
  if (!user) return { ok: false, error: `no account with id ${uid}` };
  if (user.disabled) return { ok: false, error: `account ${user.username} is disabled; unlock it first` };
  if (user.role === "admin") return { ok: true, status: "already", username: user.username };
  if (!apply) return { ok: true, status: "dry-run", username: user.username };
  const next = await store.updateUser(uid, { role: "admin" });
  if (!next) return { ok: false, error: `account ${uid} disappeared` };
  return { ok: true, status: "granted", username: next.username };
}

async function main(argv: string[]): Promise<void> {
  const uid = argv.find((a) => !a.startsWith("--"));
  if (!uid) throw new Error("usage: tsx src/tools/bootstrap-admin.ts <user-id> [--yes]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set: accounts live in Postgres, a memory store would grant nothing");
  const r = await grantAdmin(await openAccountStore(), uid, argv.includes("--yes"));
  if (!r.ok) throw new Error(r.error);
  const who = `${r.username} (${uid})`;
  if (r.status === "already") console.log(`${who} is already admin; nothing changed.`);
  else if (r.status === "dry-run") console.log(`Would grant admin to ${who}. Check this is the right person, then re-run with --yes.`);
  else console.log(`Granted admin to ${who}. Running servers see it within 60 s (session cache).`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tools/bootstrap-admin.ts")) {
  main(process.argv.slice(2)).then(
    // The pg pool keeps the process alive; this is a one-shot tool.
    () => process.exit(0),
    (e) => {
      console.error((e instanceof Error && e.message) || "bootstrap-admin failed");
      process.exit(1);
    },
  );
}
