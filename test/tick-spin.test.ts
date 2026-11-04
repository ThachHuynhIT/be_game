import { describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "../src/server/adapters";
import { type HubSocket, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
import type { GameKind } from "../src/server/store";
import { accountSession } from "./helpers/accounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg?: any) => void;

/** Counts the `state` pushes it receives. */
class Sock implements HubSocket {
  states = 0;
  private listeners: Record<string, Listener[]> = {};
  send(data: string) {
    if (data.startsWith('{"type":"state"')) this.states++;
  }
  close() {
    this.emit("close");
  }
  on(event: string, listener: Listener) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit(event: string, arg?: unknown) {
    this.listeners[event]?.forEach((l) => l(arg));
  }
  say(msg: Record<string, unknown>) {
    this.emit("message", JSON.stringify({ id: 1, ...msg }));
  }
}

const GAMES: GameKind[] = ["tienlen", "meono", "typhu", "splendor", "bang", "cangua", "oanquan", "noichu"];

// Regression: once an offline player was past the 60 s seat grace mid-game, `nextTickAt` kept returning a time
// in the past, so the hub re-ran `tick` every 100 ms and pushed ~10 views a second to everyone still playing.
describe("no tick busy-loop while an opponent stays offline", () => {
  it.each(GAMES)("%s", async (game) => {
    const sessions = await Promise.all([0, 1, 2].map((i) => accountSession(`Pl${i}`)));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const hub = createRoomHub(createMemoryRoomStore(), ADAPTERS[game] as never);
      const code = await hub.createRoom();
      const socks = ["aaaaaaaa", "bbbbbbbb", "cccccccc"].map((t, i) => {
        const s = new Sock();
        attachConnection(s, { hub });
        s.say({ type: "join", code, token: `token-${t}`, session: sessions[i] });
        return s;
      });
      await vi.advanceTimersByTimeAsync(200);
      socks[0].say({ type: "start" });
      await vi.advanceTimersByTimeAsync(200);
      socks[1].close();
      socks[2].close();

      const a = socks[0];
      const perWindow: number[] = [];
      for (let w = 0; w < 12; w++) {
        const before = a.states;
        a.say({ type: "ping" }); // the real client pings every 10 s
        await vi.advanceTimersByTimeAsync(10_000);
        perWindow.push(a.states - before);
      }
      // Two minutes covers presence timeout (25 s) and seat grace (60 s); a busy loop shows ~100 per window.
      expect(Math.max(...perWindow)).toBeLessThan(20);
    } finally {
      vi.useRealTimers();
    }
  });
});
