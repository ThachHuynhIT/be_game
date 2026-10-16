export type Role = "user" | "admin";

export interface UserRow {
  id: string;
  usernameKey: string;
  username: string;
  passwordHash: string;
  role: Role;
  icon: string;
  color: string;
  disabled: boolean;
  sessionVersion: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export type UserPatch = Partial<Pick<UserRow, "role" | "disabled" | "icon" | "color" | "passwordHash" | "lastLoginAt">> & { bumpSession?: boolean };

/** Calendar day (YYYY-MM-DD) in Vietnam time (UTC+7); computed in JS so Postgres and pg-mem agree. */
export function vnDay(date: Date): string {
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export type LeaderRow = { name: string; points: number; games: number; wins: number; icon: string; color: string };

export type AdminStats = {
  days: number;
  totals: { users: number; newUsers: number; views: number; devices: number; games: number; players: number; playDevices: number };
  daily: { day: string; views: number; devices: number; games: number; players: number; newUsers: number }[];
  byGame: { game: string; games: number; players: number }[];
  topPages: { path: string; views: number }[];
  topPlayers: { name: string; games: number; points: number }[];
};

export interface ResultRow {
  usernameKey: string;
  points: number;
  rank: number;
}

/** The `days` Vietnam calendar days ending at `now`, oldest first. */
export function statDays(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(vnDay(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

/** First instant (UTC) of the Vietnam day `day`. */
export const vnDayStart = (day: string) => new Date(`${day}T00:00:00+07:00`);

export const isPlayPath = (p: string) => p.startsWith("/play/");
