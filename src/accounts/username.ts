import { nameKey } from "../server/store";

const USERNAME_RE = /^[\p{L}\p{N}_.]+( [\p{L}\p{N}_.]+)*$/u;

export function normalizeUsername(raw: string): { ok: true; username: string; key: string } | { ok: false; error: string } {
  const username = String(raw ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  const len = [...username].length;
  if (len < 3 || len > 20) return { ok: false, error: "Tên đăng nhập dài 3–20 ký tự" };
  if (!USERNAME_RE.test(username)) return { ok: false, error: "Tên đăng nhập chỉ gồm chữ, số, dấu cách, _ và ." };
  return { ok: true, username, key: nameKey(username) };
}

export function validatePassword(pw: string): string | null {
  const len = typeof pw === "string" ? [...pw.normalize("NFC")].length : 0;
  if (len < 8) return "Mật khẩu tối thiểu 8 ký tự";
  if (len > 72) return "Mật khẩu tối đa 72 ký tự";
  return null;
}
