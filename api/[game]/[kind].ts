// Vercel Function for every non-Tiến Lên game endpoint: /api/{meono,typhu,splendor,bang,oanquan,cangua,noichu}/{ws,rooms,leaderboard}.
// One dynamic file keeps the deployment under the Hobby plan's 12-function limit; src/server/app.ts routes by path.
import { createGameServer } from "../../src/server/app";

export default createGameServer();
