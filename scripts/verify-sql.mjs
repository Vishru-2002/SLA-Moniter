/**
 * Executes the migrations against a real Postgres (PGlite, compiled to WASM)
 * and asserts the two things that are easy to get quietly wrong:
 *
 *   1. the anon role really is read-only after migration 002;
 *   2. the analytics functions return the right numbers, including the date
 *      filter -- which is checked on a session deliberately NOT set to UTC,
 *      because a bare ::timestamptz cast resolves against the server timezone
 *      and slides the window without failing.
 *
 * The rows loaded here are produced by the pipeline's own cleaning code
 * (supabase/functions/upload-csv/clean.ts), not a reimplementation of it.
 *
 * Usage:  npm run verify:sql [-- path/to/file.csv]
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, cleanRows } from '../supabase/functions/upload-csv/clean.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvPath =
  process.argv[2] ??
  path.join(ROOT, 'problem_statement', 'monitoring_checks_14d_seed202.csv');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.log(`  ✗ ${m}`);
  failures++;
};
const check = (cond, m) => (cond ? pass(m) : fail(m));

console.log(`\nVerifying SQL against ${path.basename(csvPath)}\n`);

const db = await PGlite.create();

// ---------------------------------------------------------------------------
// Reproduce the Supabase role setup: anon/authenticated exist and, by default,
// hold the full privilege set on public tables. Migration 002 has to take that
// away -- if we started from zero privileges the test would prove nothing.
// ---------------------------------------------------------------------------
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
`);

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const sql = (f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');

// Read the directory rather than naming files: a migration added later must be
// covered by this test automatically, or the test quietly drifts behind the
// schema it claims to verify. (003 and 004 both redefine service_outages, so
// running short of the end would score a detector that is no longer deployed.)
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const [first, ...rest] = files;

console.log('Migrations');
await db.exec(sql(first));
pass(`${first} applied`);

// Supabase grants anon the full privilege set on new public tables. Reproduce
// that here, between the schema and the lockdown, so the RLS assertions below
// prove 002 takes privileges away rather than starting from none.
await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
const privsBefore = (
  await db.query(`SELECT privilege_type FROM information_schema.role_table_grants
                  WHERE grantee='anon' AND table_name='monitoring_checks' ORDER BY 1`)
).rows.map((r) => r.privilege_type);

for (const f of rest) {
  await db.exec(sql(f));
  pass(`${f} applied`);
}

const tz = (await db.query('SHOW TimeZone')).rows[0].TimeZone;
console.log(`\nSession timezone: ${tz}${tz === 'UTC' ? '' : '  (non-UTC — good)'}`);

// ---------------------------------------------------------------------------
console.log('\nRow Level Security');
// ---------------------------------------------------------------------------
console.log(`  anon privileges before 002: ${privsBefore.join(', ')}`);
const privsAfter = (
  await db.query(`SELECT privilege_type FROM information_schema.role_table_grants
                  WHERE grantee='anon' AND table_name='monitoring_checks' ORDER BY 1`)
).rows.map((r) => r.privilege_type);
console.log(`  anon privileges after 002:  ${privsAfter.join(', ') || '(none)'}`);

check(
  privsAfter.length > 0 && privsAfter.every((p) => p === 'SELECT'),
  'anon holds SELECT and nothing else'
);

const rls = (
  await db.query(`SELECT relname, relrowsecurity FROM pg_class
                  WHERE relname IN ('uploads','monitoring_checks') ORDER BY 1`)
).rows;
check(rls.length === 2 && rls.every((r) => r.relrowsecurity), 'RLS enabled on both tables');

// ---------------------------------------------------------------------------
// Load real data through the real cleaning code
// ---------------------------------------------------------------------------
const { cleaned, issues } = cleanRows(parseCSV(fs.readFileSync(csvPath, 'utf8')));

const upload = await db.query(
  `INSERT INTO uploads (filename, total_rows, cleaned_rows, duplicates_removed, issues)
   VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [path.basename(csvPath), cleaned.length, cleaned.length, issues.duplicates_removed, issues]
);
const uploadId = upload.rows[0].id;

for (let i = 0; i < cleaned.length; i += 500) {
  const chunk = cleaned.slice(i, i + 500);
  const params = [];
  const tuples = chunk.map((r, j) => {
    const b = j * 10;
    params.push(uploadId, r.service_id, r.service_name, r.check_time, r.status_code,
                r.latency_ms, r.original_latency, r.original_unit, r.is_healthy, r.is_valid_status);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
  });
  await db.query(
    `INSERT INTO monitoring_checks (upload_id, service_id, service_name, check_time,
       status_code, latency_ms, original_latency, original_unit, is_healthy, is_valid_status)
     VALUES ${tuples.join(',')}`,
    params
  );
}
await db.query(
  `UPDATE uploads SET date_range_start = (SELECT MIN(check_time)::date FROM monitoring_checks),
                      date_range_end   = (SELECT MAX(check_time)::date FROM monitoring_checks)
   WHERE id = $1`, [uploadId]
);
console.log(`\n  loaded ${cleaned.length.toLocaleString()} cleaned rows ` +
            `(${issues.duplicates_removed} duplicates removed, ` +
            `${issues.duplicate_status_conflicts} agent status conflicts)`);

// ---------------------------------------------------------------------------
console.log('\nAnonymous access');
// ---------------------------------------------------------------------------
await db.exec('SET ROLE anon;');

const readable = (await db.query('SELECT COUNT(*)::int n FROM monitoring_checks')).rows[0].n;
check(readable === cleaned.length, `anon can read all ${readable.toLocaleString()} rows`);

const writes = [
  ['INSERT', `INSERT INTO monitoring_checks (upload_id, service_id, service_name, check_time, status_code)
              VALUES ('${uploadId}','x','x',now(),200)`],
  ['UPDATE', `UPDATE monitoring_checks SET status_code = 500`],
  ['DELETE', `DELETE FROM monitoring_checks`],
  // TRUNCATE is the one RLS cannot protect: no policy applies to it, only the
  // absence of the grant. Revoking INSERT/UPDATE/DELETE by name leaves it open.
  ['TRUNCATE', `TRUNCATE monitoring_checks CASCADE`],
  ['TRUNCATE uploads', `TRUNCATE uploads CASCADE`],
  ['DELETE uploads', `DELETE FROM uploads`],
];
for (const [label, stmt] of writes) {
  try {
    await db.query(stmt);
    fail(`anon ${label} SUCCEEDED — the table is writable`);
  } catch {
    pass(`anon ${label} blocked`);
  }
}

const rpcRows = (await db.query(`SELECT COUNT(*)::int n FROM service_stats('${uploadId}')`)).rows[0].n;
check(rpcRows > 0, `anon can call service_stats() (${rpcRows} services)`);
await db.exec('RESET ROLE;');

// ---------------------------------------------------------------------------
console.log('\nDate filtering');
// ---------------------------------------------------------------------------
const day = (await db.query(
  `SELECT to_char(MIN(check_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') d FROM monitoring_checks`
)).rows[0].d;

// ground truth, computed without going through the function under test
const truthDay = (await db.query(
  `SELECT COUNT(*)::int n FROM monitoring_checks
   WHERE (check_time AT TIME ZONE 'UTC')::date = $1::date`, [day]
)).rows[0].n;
const fnDay = (await db.query(
  `SELECT COALESCE(SUM(total_checks),0)::int n FROM service_stats($1, $2::date, $2::date)`,
  [uploadId, day]
)).rows[0].n;
check(fnDay === truthDay, `single date ${day}: ${fnDay} checks (expected ${truthDay})`);

const day2 = (await db.query(
  `SELECT to_char(MIN(check_time AT TIME ZONE 'UTC') + interval '2 days', 'YYYY-MM-DD') d
   FROM monitoring_checks`
)).rows[0].d;
const truthRange = (await db.query(
  `SELECT COUNT(*)::int n FROM monitoring_checks
   WHERE (check_time AT TIME ZONE 'UTC')::date BETWEEN $1::date AND $2::date`, [day, day2]
)).rows[0].n;
const fnRange = (await db.query(
  `SELECT COALESCE(SUM(total_checks),0)::int n FROM service_stats($1, $2::date, $3::date)`,
  [uploadId, day, day2]
)).rows[0].n;
check(fnRange === truthRange, `range ${day}..${day2}: ${fnRange} checks (expected ${truthRange})`);

const unfiltered = (await db.query(
  `SELECT COALESCE(SUM(total_checks),0)::int n FROM service_stats($1)`, [uploadId]
)).rows[0].n;
check(unfiltered === cleaned.length, `unfiltered covers every row (${unfiltered.toLocaleString()})`);

// ---------------------------------------------------------------------------
console.log('\nAnalytics');
// ---------------------------------------------------------------------------
const stats = (await db.query(
  `SELECT service_id, total_checks, healthy_checks, failed_checks, uptime_pct, credit_pct
   FROM service_stats($1)`, [uploadId])).rows;
check(
  stats.every((s) => Number(s.healthy_checks) + Number(s.failed_checks) === Number(s.total_checks)),
  'healthy + failed = total for every service'
);
check(
  stats.every((s) => {
    const expected = (Number(s.healthy_checks) / Number(s.total_checks)) * 100;
    return Math.abs(Number(s.uptime_pct) - expected) < 0.001;
  }),
  'uptime_pct matches healthy/total'
);

const monthly = (await db.query(
  `SELECT service_id, month, total_checks, uptime_pct, credit_pct, days_covered,
          days_in_month, is_partial_month FROM monthly_sla($1)`, [uploadId])).rows;
const monthTotal = monthly.reduce((n, r) => n + Number(r.total_checks), 0);
check(monthTotal === cleaned.length,
  `monthly buckets account for every check (${monthTotal.toLocaleString()})`);
check(monthly.every((r) => Number(r.days_covered) <= Number(r.days_in_month)),
  'days_covered never exceeds days_in_month');
check(
  monthly.every((r) =>
    r.is_partial_month === (Number(r.days_covered) < Number(r.days_in_month))),
  'partial-month flag agrees with coverage'
);
// r.month arrives as a Date; format it rather than stringifying the object
const monthLabels = [...new Set(
  monthly.map((r) => new Date(r.month).toISOString().slice(0, 7))
)].sort();
console.log(`  months detected: ${monthLabels.join(', ')}`);

const outages = (await db.query(
  `SELECT service_id, started_at, ended_at, duration_minutes, checks_in_window,
          failed_checks, failure_rate FROM service_outages($1)`, [uploadId])).rows;
check(outages.every((o) => Number(o.failure_rate) > 50),
  `every detected incident exceeds the 50% threshold (${outages.length} found)`);
check(outages.every((o) => new Date(o.started_at) <= new Date(o.ended_at)),
  'incident windows are well-formed');
check(outages.every((o) => Number(o.failed_checks) <= Number(o.checks_in_window)),
  'failed checks never exceed checks in window');
for (const o of outages) {
  console.log(`  incident: ${o.service_id} ${new Date(o.started_at).toISOString().slice(0, 16)}Z ` +
              `→ ${new Date(o.ended_at).toISOString().slice(11, 16)}Z  ` +
              `${o.duration_minutes}m  ${o.failed_checks}/${o.checks_in_window} failed`);
}

const summaries = (await db.query(`SELECT * FROM upload_summaries`)).rows;
check(summaries.length === 1 && Number(summaries[0].service_count) === stats.length,
  `upload_summaries reports ${summaries[0]?.service_count} services`);

await db.close();

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
