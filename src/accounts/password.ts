import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

const derive = (pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const opts: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
    scrypt(pw, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** Stored form: scrypt$N$r$p$<salt b64>$<hash b64>. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** False for any malformed stored value; never throws. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await derive(pw, salt, n, r, p);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
