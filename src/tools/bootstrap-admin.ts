// Grants the admin role to one existing account, by user id, with a new password. This is the only way to make an
// admin besides an admin using /admin: registering or signing in never grants a role (ADMIN_USERNAMES only reserves names).
// The operator first checks who owns the account: the id is `user.id` in that person's `GET /api/auth/me`.
// Usage: tsx src/tools/bootstrap-admin.ts <user-id>                          (shows the account, changes nothing)
//        printf '%s' "$NEW_PASSWORD" | tsx src/tools/bootstrap-admin.ts <user-id> --yes --password-stdin
// The new password (12–72 characters) replaces the old one: the stored hash cannot tell whether the old password meets
// the admin minimum. It is read from stdin, never from the command line (process lists, shell history). Every existing
// session of the account is signed out. Needs DATABASE_URL (the server's database); touches no other account.
import { hashPassword } from "../accounts/password";
import { openAccountStore } from "../accounts/service";
import type { AccountStore } from "../accounts/store";
import { validatePassword } from "../accounts/username";

export type GrantResult =
  | { ok: true; status: "already" | "dry-run" | "granted"; username: string }
  | { ok: false; error: string };

/** Dry run without `apply`; with it, `password` (the admin's new password) is required unless the account is already admin. */
export async function grantAdmin(store: AccountStore, uid: string, apply: boolean, password?: string): Promise<GrantResult> {
  const user = await store.userById(uid);
  if (!user) return { ok: false, error: `no account with id ${uid}` };
  if (user.disabled) return { ok: false, error: `account ${user.username} is disabled; unlock it first` };
  if (user.role === "admin") return { ok: true, status: "already", username: user.username };
  if (!apply) return { ok: true, status: "dry-run", username: user.username };
  if (password === undefined) return { ok: false, error: "a new password is required (--password-stdin): the old one may be shorter than the admin minimum" };
  const problem = validatePassword(password, "admin");
  if (problem) return { ok: false, error: `password refused: ${problem}` };
  const next = await store.updateUser(uid, { role: "admin", passwordHash: await hashPassword(password), bumpSession: true });
  if (!next) return { ok: false, error: `account ${uid} disappeared` };
  return { ok: true, status: "granted", username: next.username };
}

/** All of stdin, without one trailing newline (what `echo` or a heredoc adds). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main(argv: string[]): Promise<void> {
  const uid = argv.find((a) => !a.startsWith("--"));
  if (!uid) throw new Error("usage: tsx src/tools/bootstrap-admin.ts <user-id> [--yes --password-stdin]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set: accounts live in Postgres, a memory store would grant nothing");
  const apply = argv.includes("--yes");
  if (apply && !argv.includes("--password-stdin")) throw new Error("--yes needs --password-stdin: pipe the admin's new password (12–72 characters) in");
  const password = apply ? await readStdin() : undefined;
  const r = await grantAdmin(await openAccountStore(), uid, apply, password);
  if (!r.ok) throw new Error(r.error);
  const who = `${r.username} (${uid})`;
  if (r.status === "already") console.log(`${who} is already admin; nothing changed.`);
  else if (r.status === "dry-run") console.log(`Would grant admin to ${who}. Check this is the right person, then re-run with --yes --password-stdin.`);
  else console.log(`Granted admin to ${who} with the new password; its other sessions are signed out. Running servers see the role within 60 s (session cache).`);
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
