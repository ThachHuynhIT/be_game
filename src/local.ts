// Local / self-hosted server: same handler as the Vercel functions, listening on PORT.
//   npm run dev        → http://localhost:4000  (ws://localhost:4000/api/ws)
import { createGameServer, shutdownGameServer } from "./server/app";
import { getRoomStore } from "./server/store";

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";
/** Max time to wait for clients to close their sockets after SIGTERM/SIGINT. */
const SHUTDOWN_GRACE_MS = 10_000;

const server = createGameServer();
server.listen(port, host, async () => {
  const store = await getRoomStore();
  console.log(`[be_game] listening on http://localhost:${port} — ws path /api/ws, rooms: ${store.kind}`);
});

let stopping = false;
function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[be_game] ${signal} received, closing connections…`);
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  void shutdownGameServer(server).then(() => process.exit(0));
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
