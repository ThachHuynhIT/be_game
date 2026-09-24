import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { getDeadline } from "@vercel/functions";
import { WebSocketServer } from "ws";
import { WS_PATH } from "../game/protocol";
import { newRoom, randomCode } from "../game/room";
import { MAX_MESSAGE_BYTES, attachConnection, isAllowedOrigin } from "./hub";
import { getRoomStore, redisUrl } from "./store";

/**
 * The whole backend as a plain Node `http.Server`:
 *   GET  /api/ws      (Upgrade: websocket) → game connection
 *   GET  /api/health  → store diagnostics
 * On Vercel, `api/ws.ts` and `api/health.ts` export it as the function's server;
 * locally, `src/local.ts` calls `listen()` on it.
 */
export function createGameServer(): Server {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const server = createServer((req, res) => {
    const path = pathOf(req);
    cors(req, res);
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (path === "/api/health") return void health(res);
    if (path === WS_PATH) return json(res, 426, { ok: false, error: "Expected a WebSocket connection" });
    if (path === "/" || path === "/api") return json(res, 200, { ok: true, service: "be_game", ws: WS_PATH, health: "/api/health" });
    json(res, 404, { ok: false, error: "Not found" });
  });

  server.on("upgrade", (req, socket, head) => {
    if (pathOf(req) !== WS_PATH) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    // On Vercel the connection dies with the invocation; read its deadline while the request context is current.
    let deadline: Date | undefined;
    try {
      deadline = getDeadline();
    } catch {
      deadline = undefined;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachConnection(ws, { deadline }));
  });

  return server;
}

const pathOf = (req: IncomingMessage) => new URL(req.url ?? "/", "http://localhost").pathname;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);

/** create → load → subscribe → save → pub/sub round trip, with timings. Never returns secrets. */
async function health(res: ServerResponse) {
  const stepsMs: Record<string, number> = {};
  let start = Date.now();
  const mark = (name: string) => {
    stepsMs[name] = Date.now() - start;
    start = Date.now();
  };
  const url = redisUrl();
  const info = {
    region: process.env.VERCEL_REGION ?? "local",
    redisConfigured: !!url,
    redisHost: url ? new URL(url).hostname : null,
  };
  try {
    const store = await withTimeout(getRoomStore(), 5000, "connect");
    mark("init");
    const code = "HC" + randomCode(6);
    await withTimeout(store.create(newRoom(code)), 5000, "create");
    mark("create");
    const loaded = await withTimeout(store.load(code), 5000, "load");
    mark("load");
    if (!loaded) throw new Error("load returned nothing right after create");
    let notified = false;
    const got = new Promise<void>((resolve) => {
      void store
        .subscribe(code, () => {
          notified = true;
          resolve();
        })
        .then((unsub) => setTimeout(unsub, 3000));
    });
    await new Promise((r) => setTimeout(r, 300));
    mark("subscribe");
    const saved = await withTimeout(store.save(loaded.state, loaded.version), 5000, "save");
    mark("save");
    await withTimeout(got, 3000, "pubsub").catch(() => {});
    mark("pubsub");
    json(res, 200, { ok: saved && notified, store: store.kind, saved, notified, stepsMs, ...info });
  } catch (err) {
    json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err), stepsMs, ...info });
  }
}
