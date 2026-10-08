import { describe, expect, it, vi } from "vitest";
import type { RoomState } from "../src/game/room";
import { type HubSocket, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg?: any) => void;

/** Socket stand-in that only records nothing: these tests read the store directly. */
class Sock implements HubSocket {
  private listeners: Record<string, Listener[]> = {};
  send() {}
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

describe("auto-play for an offline opponent (Tiến Lên, through the hub)", () => {
  it("plays the offline player's turn right away once they are offline, not at the turn deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const store = createMemoryRoomStore<RoomState>();
      const hub = createRoomHub(store);
      const a = new Sock();
      const b = new Sock();
      attachConnection(a, { hub });
      attachConnection(b, { hub });
      const code = await hub.createRoom();
      a.say({ type: "join", code, name: "An", token: "token-aaaaaaaa" });
      b.say({ type: "join", code, name: "Bình", token: "token-bbbbbbbb" });
      await vi.advanceTimersByTimeAsync(200);
      a.say({ type: "start" });
      await vi.advanceTimersByTimeAsync(200);
      b.close(); // B drops: no more heartbeats; A keeps pinging every 10 s like the real client

      const state = async () => (await store.load(code))!.state;
      const idOf = (s: RoomState, token: string) => s.seats.find((p) => p?.token === token)!.id;
      const aId = idOf(await state(), "token-aaaaaaaa");
      const bId = idOf(await state(), "token-bbbbbbbb");

      let heldByB = 0;
      let maxHeldByB = 0;
      let endedAt = -1;
      for (let t = 0; t < 120; t++) {
        await vi.advanceTimersByTimeAsync(1000);
        if (t % 10 === 0) a.say({ type: "ping" });
        const g = (await state()).game;
        if (!g || g.status !== "playing") {
          endedAt = t;
          break;
        }
        if (g.turn === aId) {
          heldByB = 0;
          const card = g.lastPlay ? null : (g.mustInclude ?? Math.min(...g.hands[aId]));
          a.say(card === null ? { type: "pass" } : { type: "play", cards: [card] });
        } else if (g.turn === bId && t >= 30) {
          // B has been silent for > 25 s (PRESENCE_TIMEOUT_MS): their turns must not wait for the 30 s deadline.
          maxHeldByB = Math.max(maxHeldByB, ++heldByB);
        }
      }
      expect(endedAt).toBeGreaterThan(0); // the game finishes instead of stalling on B
      expect(maxHeldByB).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
