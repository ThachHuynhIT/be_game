import { nameKey } from "../server/store";
import type { Role } from "./types";

/**
 * The owner (OWNER_USERNAME, backend only): the first admin, whom other admins may not demote, lock or give a new
 * password. Matched by the account's current username with the same normalisation as usernames (`nameKey`). Being
 * the owner grants nothing: admin is still granted by user id with `src/tools/bootstrap-admin.ts`.
 */
export const OWNER_ROLE = "Không thể đổi quyền của chủ sở hữu";
export const OWNER_LOCK = "Không thể khoá chủ sở hữu";
export const OWNER_PASSWORD = "Không thể đặt mật khẩu cho chủ sở hữu";

/** The owner's username key, or null when OWNER_USERNAME is unset or blank (no owner protection). */
export function ownerKey(ownerUsername: string | undefined): string | null {
  const key = nameKey(ownerUsername ?? "");
  return key === "" ? null : key;
}

export function isOwnerUsername(username: string, ownerUsername: string | undefined): boolean {
  const key = ownerKey(ownerUsername);
  return key !== null && nameKey(username) === key;
}

/**
 * Why `actorId` may not apply `patch` to `target`, or null. Only another admin acting on the owner is limited: any role
 * change (even to the same role), locking and setting a password are refused; unlocking is allowed. Role is reported
 * before lock before password so a mixed patch gets one stable message, and is refused as a whole.
 */
export function ownerUpdateProblem(
  actorId: string,
  target: { id: string; username: string },
  patch: { role?: Role; disabled?: boolean; password?: string },
  ownerUsername: string | undefined,
): string | null {
  if (actorId === target.id || !isOwnerUsername(target.username, ownerUsername)) return null;
  if (patch.role !== undefined) return OWNER_ROLE;
  if (patch.disabled === true) return OWNER_LOCK;
  if (patch.password !== undefined) return OWNER_PASSWORD;
  return null;
}

let warned = false;
/** One startup warning per process when no owner is configured; never logs the value. */
export function warnIfOwnerUnconfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (warned || ownerKey(env.OWNER_USERNAME) !== null) return;
  warned = true;
  console.warn("[be_game] OWNER_USERNAME is not set; owner protection is disabled.");
}
