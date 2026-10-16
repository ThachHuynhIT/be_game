import { describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "../src/server/adapters";
import { type HubSocket, attachConnection, createRoomHub } from "../src/server/hub";
import { createMemoryRoomStore } from "../src/server/store";
import { accountSession } from "./helpers/accounts";
import type { TPRoom } from "../src/typhu/room";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg?: any) => void;

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

describe("Cờ Tỷ Phú: auto-play for an offline opponent (through the hub)", () => {
  it.each([
    ["drops right after the start", 0],
    ["drops 40 s into the game", 40],
  ])("keeps the game moving while the other player is offline (%s)", async (_label, dropAt) => {
    const sessions = [await accountSession("Anh"), await accountSession("Binh")];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const store = createMemoryRoomStore<TPRoom>();
      const hub = createRoomHub(store, ADAPTERS.typhu as never);
      const a = new Sock();
      const b = new Sock();
      attachConnection(a, { hub });
      attachConnection(b, { hub });
      const code = await hub.createRoom();
      a.say({ type: "join", code, token: "token-aaaaaaaa", session: sessions[0] });
      b.say({ type: "join", code, token: "token-bbbbbbbb", session: sessions[1] });
      await vi.advanceTimersByTimeAsync(200);
      a.say({ type: "start" });
      await vi.advanceTimersByTimeAsync(200);
      if (dropAt === 0) b.close();

      const state = async () => (await store.load(code))!.state;
      const s0 = await state();
      const aId = s0.seats.find((p) => p?.token === "token-aaaaaaaa")!.id;
      const bId = s0.seats.find((p) => p?.token === "token-bbbbbbbb")!.id;
      expect(s0.current?.status).toBe("playing");

      // Seconds the offline player's turn sat without a new step. Measured per step, not per turn:
      // a turn's length depends on the dice (doubles add steps), the pace between steps does not.
      let stall = 0;
      let maxStall = 0;
      let bSteps = 0;
      let lastPhaseAt = 0;
      for (let t = 0; t < 240; t++) {
        await vi.advanceTimersByTimeAsync(1000);
        if (t % 10 === 0) {
          a.say({ type: "ping" });
          if (t < dropAt) b.say({ type: "ping" });
        }
        const g = (await state()).current;
        if (!g || g.status !== "playing") break;
        if (g.turn === aId) {
          stall = 0;
          for (const type of ["roll", "skip", "end"]) a.say({ type });
        } else if (g.turn === bId && t >= dropAt + 30) {
          if (g.phaseAt !== lastPhaseAt) {
            bSteps++;
            stall = 0;
          } else maxStall = Math.max(maxStall, ++stall);
          lastPhaseAt = g.phaseAt;
        }
      }
      expect(bSteps).toBeGreaterThan(0);
      // One automatic step every ABSENT_MS (2.5 s), sampled once a second.
      expect(maxStall).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
