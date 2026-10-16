import type { ClientMessage, RoomView, ServerMessage } from "../../src/game/protocol";
import type { HubSocket } from "../../src/server/hub";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg?: any) => void;

/** In-process stand-in for a WebSocket, with a tiny client API for tests. */
export class FakeSocket implements HubSocket {
  inbox: ServerMessage[] = [];
  private listeners: Record<string, Listener[]> = {};
  private nextId = 1;
  private waiters: (() => void)[] = [];

  send(data: string) {
    this.inbox.push(JSON.parse(data));
    this.waiters.splice(0).forEach((w) => w());
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

  /** Fire a message without waiting for the ack. */
  say(msg: Record<string, unknown>) {
    this.emit("message", JSON.stringify({ id: this.nextId++, ...msg }));
  }

  /** Send a message and resolve with its ack. */
  request(msg: Record<string, unknown>) {
    const id = this.nextId++;
    this.emit("message", JSON.stringify({ ...msg, id } as ClientMessage));
    return this.waitFor((m) => m.type === "ack" && m.id === id) as Promise<Extract<ServerMessage, { type: "ack" }>>;
  }

  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.inbox.find(pred);
      if (hit) return hit;
      if (Date.now() > until) throw new Error("timed out waiting for message");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 20);
      });
    }
  }

  /** Latest state view that satisfies `pred`. */
  async view(pred: (v: RoomView) => boolean = () => true): Promise<RoomView> {
    const until = Date.now() + 2000;
    for (;;) {
      const views = this.inbox.filter((m): m is Extract<ServerMessage, { type: "state" }> => m.type === "state");
      const last = views[views.length - 1]?.view;
      if (last && pred(last)) return last;
      if (Date.now() > until) throw new Error("timed out waiting for view");
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
