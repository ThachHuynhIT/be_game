import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGameServer } from "../src/server/app";
import { assertOriginConfig, isAllowedOrigin, originConfigError } from "../src/server/hub";

const saved = process.env.ALLOWED_ORIGIN;
const restore = () => (saved === undefined ? delete process.env.ALLOWED_ORIGIN : (process.env.ALLOWED_ORIGIN = saved));

const LIVE = "https://play.fudio101.com, https://zonenop-game.vercel.app, https://zonenop-game-*-thachs-projects-48e5eaf9.vercel.app, http://localhost:3000";
const prod = (ALLOWED_ORIGIN?: string): NodeJS.ProcessEnv => ({ NODE_ENV: "production", ...(ALLOWED_ORIGIN === undefined ? {} : { ALLOWED_ORIGIN }) });

describe("isAllowedOrigin", () => {
  afterEach(restore);

  it("allows everything when ALLOWED_ORIGIN is unset (development only: production refuses to start)", () => {
    delete process.env.ALLOWED_ORIGIN;
    expect(isAllowedOrigin("https://anything.example", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin(undefined, "x")).toBe(true);
  });

  it("matches exact origins and * wildcards", () => {
    process.env.ALLOWED_ORIGIN = "https://my-site.com, https://*.vercel.app";
    expect(isAllowedOrigin("https://my-site.com", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://portfolio-abc123.vercel.app", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://evil.com", "be-game.vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://my-site.com.evil.com", "be-game.vercel.app")).toBe(false);
  });

  it("always allows same-host pages", () => {
    process.env.ALLOWED_ORIGIN = "https://my-site.com";
    expect(isAllowedOrigin("https://be-game.vercel.app", "be-game.vercel.app")).toBe(true);
  });

  it("the live allow-list admits the frontends and its own previews only", () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    const host = "play-api.fudio101.com";
    for (const ok of ["https://play.fudio101.com", "https://zonenop-game.vercel.app", "https://zonenop-game-git-dev-thachs-projects-48e5eaf9.vercel.app", "http://localhost:3000"])
      expect(isAllowedOrigin(ok, host), ok).toBe(true);
    for (const bad of [
      "https://evil.example",
      "http://play.fudio101.com", // scheme is part of the origin
      "https://play.fudio101.com:8443",
      "https://attacker.vercel.app",
      "https://zonenop-game-x-other-team.vercel.app",
      "https://zonenop-game-x-thachs-projects-48e5eaf9.vercel.app.evil.com",
      "null", // sandboxed iframe / file://
      "not a url",
    ])
      expect(isAllowedOrigin(bad, host), bad).toBe(false);
    expect(isAllowedOrigin(undefined, host)).toBe(true); // non-browser client
    expect(isAllowedOrigin("https://play-api.fudio101.com", host)).toBe(true); // same host
  });
});

describe("originConfigError (D2-a: production refuses an unusable allow-list)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace and commas", "  , ,  "],
    ["lone *", "*"],
    ["* inside a list", "https://play.fudio101.com, *"],
    ["every Vercel site", "https://*.vercel.app"],
    ["every Vercel site, upper case", "HTTPS://*.VERCEL.APP"],
    ["a wildcard host", "https://*"],
    ["a wildcard host with a port", "https://*:8443"],
    ["every .app site", "https://*.app"],
    ["a wildcard glued to a public suffix", "https://*vercel.app"],
    ["a wildcard as the last label", "https://example.*"],
    ["trailing slash", "https://play.fudio101.com/"],
    ["a path", "https://play.fudio101.com/play"],
    ["no scheme", "play.fudio101.com"],
    ["another scheme", "ftp://play.fudio101.com"],
  ])("refuses %s", (_label, value) => {
    expect(originConfigError(prod(value))).not.toBeNull();
    expect(() => assertOriginConfig(prod(value))).toThrow(/refusing to start/);
  });

  it("accepts the live list, a port, and a wildcard under an owned domain", () => {
    expect(originConfigError(prod(LIVE))).toBeNull();
    expect(originConfigError(prod("http://localhost:3000"))).toBeNull();
    expect(originConfigError(prod("https://*.fudio101.com"))).toBeNull();
    expect(originConfigError(prod("https://app-*.fudio101.com"))).toBeNull();
  });

  it("treats Vercel as production even without NODE_ENV", () => {
    expect(originConfigError({ VERCEL: "1" })).not.toBeNull();
    expect(originConfigError({ VERCEL: "1", ALLOWED_ORIGIN: LIVE })).toBeNull();
  });

  it("leaves development alone", () => {
    expect(originConfigError({})).toBeNull();
    expect(originConfigError({ NODE_ENV: "test", ALLOWED_ORIGIN: "*" })).toBeNull();
    expect(originConfigError({ NODE_ENV: "development", ALLOWED_ORIGIN: "" })).toBeNull();
  });

  it("names the bad entry but nothing else from the environment", () => {
    const msg = originConfigError({ ...prod("https://ok.example.com, https://bad.example.com/"), SESSION_SECRET: "s3cr3t-value", DATABASE_URL: "postgres://u:pw@h/db" })!;
    expect(msg).toContain("https://bad.example.com/");
    expect(msg).not.toContain("s3cr3t-value");
    expect(msg).not.toContain("pw@h");
  });
});

describe("createGameServer and the allow-list", () => {
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL };
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    restore();
  });

  it("throws in production without a usable list and starts with one", () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOWED_ORIGIN;
    expect(() => createGameServer()).toThrow(/ALLOWED_ORIGIN/);
    process.env.ALLOWED_ORIGIN = "*";
    expect(() => createGameServer()).toThrow(/lone \*/);
    process.env.ALLOWED_ORIGIN = LIVE;
    expect(() => createGameServer()).not.toThrow();
  });
});

describe("HTTP and WebSocket enforcement", () => {
  let server: Server;
  let port = 0;
  const GOOD = "https://play.fudio101.com";
  const EVIL = "https://evil.example";

  beforeAll(async () => {
    server = createGameServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  // ALLOWED_ORIGIN is read per request, so each test sets it.
  afterEach(restore);

  const req = (path: string, opts: { method?: string; origin?: string; json?: unknown } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: opts.method ?? "GET",
      headers: { ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.json !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    });

  const upgrade = (origin?: string) =>
    new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, origin ? { origin } : {});
      ws.on("open", () => {
        ws.close();
        resolve(101);
      });
      ws.on("unexpected-response", (_r, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => resolve(-1));
    });

  it("CORS reflects an allowed origin exactly, with Vary, and sends nothing for a foreign one", async () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    const ok = await req("/api", { origin: GOOD });
    expect(ok.headers.get("access-control-allow-origin")).toBe(GOOD);
    expect(ok.headers.get("vary")?.toLowerCase()).toContain("origin");
    const bad = await req("/api", { origin: EVIL });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    // No CORS header is not a refusal: public reads still answer, the browser just hides the body.
    expect(bad.status).toBe(200);
  });

  it("preflight answers 204, with CORS headers only for an allowed origin", async () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    const ok = await req("/api/auth/login", { method: "OPTIONS", origin: GOOD });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(GOOD);
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    const bad = await req("/api/auth/login", { method: "OPTIONS", origin: EVIL });
    expect(bad.status).toBe(204);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("auth routes refuse a foreign or null origin with 403 and pass an allowed one, none or the same host", async () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    const login = (origin?: string) => req("/api/auth/login", { method: "POST", origin, json: { username: "", password: "" } });
    expect((await login(EVIL)).status).toBe(403);
    expect((await login("null")).status).toBe(403);
    // Past the origin check: no such account, 401.
    expect((await login(GOOD)).status).toBe(401);
    expect((await login()).status).toBe(401);
    expect((await login(`http://127.0.0.1:${port}`)).status).toBe(401);
  });

  it("/api/track is not origin-checked", async () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    const r = await req("/api/track", { method: "POST", origin: EVIL, json: { path: "/", device: "abcdefghijklmnop" } });
    expect(r.status).toBe(204);
  });

  it("WebSocket upgrade: 403 for a foreign or null origin, open for an allowed one or none", async () => {
    process.env.ALLOWED_ORIGIN = LIVE;
    expect(await upgrade(EVIL)).toBe(403);
    expect(await upgrade("null")).toBe(403);
    expect(await upgrade("https://attacker.vercel.app")).toBe(403);
    expect(await upgrade(GOOD)).toBe(101);
    expect(await upgrade()).toBe(101);
  });
});
