import { describe, expect, it, vi } from "vitest";
import { isSharedStoreHost } from "../src/server/app";
import { GAME_KINDS, countCommands, keysFor } from "../src/server/store";

describe("shared store helpers", () => {
  it("lists every game", () => {
    expect([...GAME_KINDS].sort()).toEqual(["bang", "cangua", "meono", "oanquan", "splendor", "tienlen", "typhu"]);
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
    vi.useRealTimers();
  });
});
