// Local / self-hosted server: same handler as the Vercel functions, listening on PORT.
//   npm run dev        → http://localhost:4000  (ws://localhost:4000/api/ws)
import { createGameServer } from "./server/app";
import { getRoomStore } from "./server/store";

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";

const server = createGameServer();
server.listen(port, host, async () => {
  const store = await getRoomStore();
  console.log(`[be_game] listening on http://localhost:${port} — ws path /api/ws, rooms: ${store.kind}`);
});
