import { nameKey } from "../server/store";

const USERNAME_RE = /^[\p{L}\p{N}_.]+( [\p{L}\p{N}_.]+)*$/u;

export function normalizeUsername(raw: string): { ok: true; username: string; key: string } | { ok: false; error: string } {
  const username = String(raw ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  const len = [...username].length;
  if (len < 3 || len > 20) return { ok: false, error: "Tên đăng nhập dài 3–20 ký tự" };
  if (!USERNAME_RE.test(username)) return { ok: false, error: "Tên đăng nhập chỉ gồm chữ, số, dấu cách, _ và ." };
  return { ok: true, username, key: nameKey(username) };
}

/** Minimum length (code points, NFC) for a newly set password; logging in with an older, shorter one still works. */
export const MIN_PASSWORD = 8;
/** Admins setting a new password need a longer one. */
export const MIN_ADMIN_PASSWORD = 12;
export const MAX_PASSWORD = 72;

/** Checks a password being set (register, change, admin reset) for an account with `role`; never applied at login. */
export function validatePassword(pw: string, role: "user" | "admin" = "user"): string | null {
  const len = typeof pw === "string" ? [...pw.normalize("NFC")].length : 0;
  if (len === 0) return "Mật khẩu không được để trống";
  if (role === "admin" && len < MIN_ADMIN_PASSWORD) return `Mật khẩu admin cần ít nhất ${MIN_ADMIN_PASSWORD} ký tự`;
  if (len < MIN_PASSWORD) return `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự`;
  if (len > MAX_PASSWORD) return `Mật khẩu tối đa ${MAX_PASSWORD} ký tự`;
  return null;
}
