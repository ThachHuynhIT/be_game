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
