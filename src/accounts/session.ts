import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SEC = 30 * 86_400;

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** Token: <b64url(JSON {uid, ver, exp})>.<b64url(HMAC-SHA256)>; exp is epoch seconds. */
export function signSession(p: { uid: string; ver: number }, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ uid: p.uid, ver: p.ver, exp: Math.floor(now / 1000) + TTL_SEC })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token: string, secret: string, now = Date.now()): { uid: string; ver: number } | null {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const want = Buffer.from(sign(body, secret));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const d = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid?: unknown; ver?: unknown; exp?: unknown };
    if (typeof d.uid !== "string" || !Number.isInteger(d.ver) || (d.ver as number) < 0 || typeof d.exp !== "number" || !Number.isFinite(d.exp)) return null;
    if (d.exp <= Math.floor(now / 1000)) return null;
    return { uid: d.uid, ver: d.ver as number };
  } catch {
    return null;
  }
}
