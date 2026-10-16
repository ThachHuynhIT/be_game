import { getAccountService } from "../../src/accounts/service";

let ipN = 0;
const PASSWORD = "matkhau123";
const sessions = new Map<string, string>();

/** Register (or log in to) an account on the process-wide in-memory account service and return its session token. Cached per username. */
export async function accountSession(username: string, look: { icon?: string; color?: string } = {}): Promise<string> {
  const known = sessions.get(username);
  if (known) return known;
  const svc = await getAccountService();
  const ip = `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;
  const reg = await svc.register({ username, password: PASSWORD, ...look }, ip);
  const res = reg.ok ? reg : await svc.login({ username, password: PASSWORD }, ip);
  if (!res.ok) throw new Error(`test account ${username}: ${res.error}`);
  sessions.set(username, res.session);
  return res.session;
}

/** Forget cached sessions (call after resetAccountServiceForTests). */
export const resetTestSessions = () => sessions.clear();
