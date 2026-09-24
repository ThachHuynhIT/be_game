// Vercel Function: WebSocket endpoint for Tiến Lên (wss://<deployment>/api/ws).
// Exporting a Node http.Server is the pattern Vercel documents for WebSockets
// in plain Node functions (Fluid compute required).
import { createGameServer } from "../src/server/app";

export default createGameServer();
