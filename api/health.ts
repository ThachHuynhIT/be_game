// Vercel Function: GET /api/health — store diagnostics (Redis or memory, pub/sub round trip).
import { createGameServer } from "../src/server/app";

export default createGameServer();
