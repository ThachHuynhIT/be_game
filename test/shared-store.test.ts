import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameServer, deployedCommit, isSharedStoreHost, redisIdOf, resetHealthCache } from "../src/server/app";
import { GAME_KINDS, countCommands, createMemoryRoomStore, getRoomStore, keysFor } from "../src/server/store";

describe("shared store helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("lists every game", () => {
    expect([...GAME_KINDS].sort()).toEqual(["bang", "cangua", "meono", "noichu", "oanquan", "splendor", "tienlen", "typhu"]);
  });
  it("exposes the key layout", () => {
    expect(keysFor("typhu").room("ABCDE")).toBe("typhu:room:ABCDE");
    expect(keysFor("tienlen").lbPlayer("lan")).toBe("tienlen:lb:p:lan");
    expect(keysFor("meono").index).toBe("meono:rooms");
  });
  it("tells a shared (remote) Redis from the local compose one", () => {
    expect(isSharedStoreHost("happy-osprey-296234.upstash.io")).toBe(true);
    for (const h of ["redis", "localhost", "127.0.0.1", "[::1]", "", null]) expect(isSharedStoreHost(h)).toBe(false);
  });
  // Fake timers are used only because countCommands runs on a real setInterval; faking it is the only
  // deterministic way to test the per-interval counts. The repo's no-fake-timers rule is for game-rule tests.
  it("counts commands per interval and stops cleanly", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const redis = { sendCommand: (cmd: string) => sent.push(cmd) };
    const ticks: number[] = [];
    const stop = countCommands(redis, (n) => ticks.push(n), 1000);
    redis.sendCommand("GET");
    redis.sendCommand("SET");
    vi.advanceTimersByTime(1000);
    redis.sendCommand("GET");
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(ticks).toEqual([2, 1]);
    expect(sent).toEqual(["GET", "SET", "GET"]);
  });
});

describe("deployedCommit", () => {
  it("prefers the self-hosted BUILD_COMMIT, then Vercel's, else null", () => {
    expect(deployedCommit({ BUILD_COMMIT: "abc", VERCEL_GIT_COMMIT_SHA: "def" })).toBe("abc");
    expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "def" })).toBe("def");
    expect(deployedCommit({ BUILD_COMMIT: "" })).toBeNull();
    expect(deployedCommit({})).toBeNull();
  });
});

describe("GET /api/health", () => {
  it("reports the server clock (epoch ms) so two backends can be compared", async () => {
    const server = createGameServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const before = Date.now();
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
      const body = (await res.json()) as { now: unknown; commit: unknown };
      expect(body).toHaveProperty("commit");
      expect(typeof body.now).toBe("number");
      expect(body.now as number).toBeGreaterThanOrEqual(before);
      expect(Math.abs((body.now as number) - Date.now())).toBeLessThan(10_000);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20_000);
});

describe("GET /api/health on a public endpoint", () => {
  it("shares one store probe between calls, hides the Redis host and leaves no room behind", async () => {
    resetHealthCache();
    const store = await getRoomStore("tienlen");
    const create = vi.spyOn(store, "create");
    const server = createGameServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
      const bodies = (await Promise.all([1, 2, 3].map(() => fetch(url).then((r) => r.json())))) as Record<string, unknown>[];
      expect(create).toHaveBeenCalledTimes(1);
      for (const b of bodies) {
        expect(b.ok).toBe(true);
        expect(b).not.toHaveProperty("redisHost");
        expect(b).toHaveProperty("redisId");
        expect(b).toHaveProperty("commit");
      }
      expect((await store.recentRooms(60)).some((r) => r.code.startsWith("HC"))).toBe(false);
    } finally {
      create.mockRestore();
      resetHealthCache();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20_000);

  it("gives a Redis host a short stable id instead of its name", () => {
    expect(redisIdOf("happy-osprey-296234.upstash.io")).toMatch(/^[0-9a-f]{12}$/);
    expect(redisIdOf("happy-osprey-296234.upstash.io")).toBe(redisIdOf("happy-osprey-296234.upstash.io"));
    expect(redisIdOf("redis")).not.toBe(redisIdOf("happy-osprey-296234.upstash.io"));
    expect(redisIdOf(null)).toBeNull();
  });
});

describe("new rooms (memory store)", () => {
  it("stay out of the lobby until their first save, and remove deletes them", async () => {
    const store = createMemoryRoomStore<{ code: string; by?: string }>();
    expect(await store.create({ code: "NEW01" })).toBe(true);
    expect(await store.recentRooms(10)).toEqual([]);
    expect(await store.save({ code: "NEW01", by: "joined" }, 1)).toBe(true);
    expect((await store.recentRooms(10)).map((r) => r.code)).toEqual(["NEW01"]);
    await store.remove("NEW01");
    expect(await store.load("NEW01")).toBeNull();
    expect(await store.recentRooms(10)).toEqual([]);
  });
});
