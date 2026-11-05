// `npm run audit:check`: runs `npm audit` and fails on any advisory (moderate or worse) that is not listed in
// audit-exceptions.json, or whose exception has expired. Every exception names an owner, a reason and an
// expiry date (YYYY-MM-DD, UTC); when it expires, fix the dependency or renew the entry on purpose.
// A clean run means "no unexcepted advisory known to the npm registry today", nothing more.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const FAIL_AT = SEVERITIES.indexOf("moderate");
const today = new Date().toISOString().slice(0, 10);

// One fixed command string (no arguments to escape); a shell finds npm / npm.cmd on every platform.
const run = spawnSync("npm audit --json", { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("npm audit did not return JSON:", (run.stderr || run.stdout || "").slice(0, 500));
  process.exit(2);
}
if (report.error) {
  console.error("npm audit failed:", report.error.summary ?? JSON.stringify(report.error));
  process.exit(2);
}

/** Advisory id (GHSA-…) → { package, severity, title }. */
const found = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    if (!found.has(id)) found.set(id, { package: via.name, severity: via.severity, title: via.title });
  }
}

const exceptions = JSON.parse(readFileSync(new URL("../audit-exceptions.json", import.meta.url), "utf8"));
const byId = new Map(exceptions.map((e) => [e.id, e]));
for (const e of exceptions) {
  for (const field of ["id", "package", "owner", "reason", "expires"])
    if (!e[field]) {
      console.error(`audit-exceptions.json: an entry has no "${field}"`);
      process.exit(2);
    }
  // Compared as a string below, so it must be exactly YYYY-MM-DD and a real date ("2026-12-5" would sort late).
  const day = new Date(e.expires + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== e.expires) {
    console.error(`audit-exceptions.json: ${e.id} has expires ${JSON.stringify(e.expires)}, expected a real date as YYYY-MM-DD`);
    process.exit(2);
  }
}

const problems = [];
for (const [id, a] of found) {
  // An unknown or missing severity is treated as failing, never skipped silently.
  const rank = SEVERITIES.indexOf(a.severity);
  if (rank >= 0 && rank < FAIL_AT) continue;
  const e = byId.get(id);
  if (!e) problems.push(`${a.severity} ${id} in ${a.package}: ${a.title} (not in audit-exceptions.json)`);
  else if (e.expires < today) problems.push(`${a.severity} ${id} in ${a.package}: exception expired on ${e.expires} (owner ${e.owner})`);
  else console.log(`excepted until ${e.expires}: ${a.severity} ${id} in ${a.package} (owner ${e.owner})`);
}
for (const e of exceptions) if (!found.has(e.id)) console.log(`stale exception, remove it: ${e.id} (${e.package}) no longer reported`);

if (problems.length) {
  console.error(`npm audit: ${problems.length} advisory(ies) need a fix or a reviewed exception:`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`npm audit: ${found.size} advisory(ies) reported, none unexcepted at moderate or above.`);
