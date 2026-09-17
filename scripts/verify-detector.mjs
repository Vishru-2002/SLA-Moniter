/**
 * Scores the outage detector against the ground truth shipped with the
 * assignment (problem_statement/dataset_incident_log.json), which lists the
 * incidents deliberately injected into each sample file.
 *
 * This runs the *real* SQL function -- migrations applied to PGlite, rows
 * produced by the pipeline's own cleaning code -- so the numbers it prints are
 * the numbers the deployed dashboard produces, not a reimplementation's.
 *
 * Usage:  npm run verify:detector [-- <window> <threshold>]
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, cleanRows } from '../supabase/functions/upload-csv/clean.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'problem_statement');

const WINDOW = Number(process.argv[2] ?? 5);
const THRESHOLD = Number(process.argv[3] ?? 0.5);

const truthFile = path.join(DATA, 'dataset_incident_log.json');
if (!fs.existsSync(truthFile)) {
  console.error(`Missing ${path.relative(ROOT, truthFile)} — nothing to score against.`);
  process.exit(1);
}
const GROUND_TRUTH = JSON.parse(fs.readFileSync(truthFile, 'utf8'));

const MINUTES = 15; // sample cadence; check-point N is N*15 minutes into the day

/** "svc-search day 8" + "check-points 49-54" -> absolute UTC window */
function parseTruth(fileMeta) {
  const dayZero = new Date(`${fileMeta.start}T00:00:00Z`);
  return Object.entries(fileMeta.incidents).map(([label, span]) => {
    const [service, dayStr] = label.split(' day ');
    const [, lo, hi] = span.match(/check-points (\d+)-(\d+)/);
    const base = dayZero.getTime() + Number(dayStr) * 86400_000;
    return {
      service,
      start: new Date(base + Number(lo) * MINUTES * 60_000),
      end: new Date(base + Number(hi) * MINUTES * 60_000),
    };
  });
}

const db = await PGlite.create();
await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
               GRANT USAGE ON SCHEMA public TO anon, authenticated;`);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).sort()) {
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8'));
}

console.log(`\nOutage detector vs. ground truth  (window=${WINDOW}, threshold=${THRESHOLD * 100}%)\n`);

let detected = 0, missed = 0, unlisted = 0, totalTruth = 0;

for (const [filename, meta] of Object.entries(GROUND_TRUTH)) {
  const csvPath = path.join(DATA, filename);
  if (!fs.existsSync(csvPath)) {
    console.log(`${filename}\n  (file not present, skipped)\n`);
    continue;
  }

  const { cleaned } = cleanRows(parseCSV(fs.readFileSync(csvPath, 'utf8')));
  const { rows: [{ id: uploadId }] } = await db.query(
    `INSERT INTO uploads (filename) VALUES ($1) RETURNING id`, [filename]
  );

  for (let i = 0; i < cleaned.length; i += 500) {
    const chunk = cleaned.slice(i, i + 500);
    const params = [];
    const tuples = chunk.map((r, j) => {
      const b = j * 6;
      params.push(uploadId, r.service_id, r.service_name, r.check_time, r.status_code, r.is_healthy);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    await db.query(
      `INSERT INTO monitoring_checks (upload_id, service_id, service_name, check_time, status_code, is_healthy)
       VALUES ${tuples.join(',')}`, params
    );
  }

  const { rows: found } = await db.query(
    `SELECT service_id, started_at, ended_at, duration_minutes, checks_in_window, failed_checks
     FROM service_outages($1, $2, $3)`, [uploadId, WINDOW, THRESHOLD]
  );

  console.log(filename);
  const matched = new Set();

  for (const t of parseTruth(meta)) {
    totalTruth++;
    const idx = found.findIndex((f) =>
      f.service_id === t.service &&
      new Date(f.started_at) <= t.end &&
      t.start <= new Date(f.ended_at)
    );
    const win = `${t.start.toISOString().slice(0, 16).replace('T', ' ')}–${t.end.toISOString().slice(11, 16)}`;

    if (idx === -1) {
      missed++;
      console.log(`  MISS   ${t.service.padEnd(13)} ${win}`);
    } else {
      matched.add(idx);
      detected++;
      const f = found[idx];
      const driftStart = (new Date(f.started_at) - t.start) / 60000;
      const driftEnd = (new Date(f.ended_at) - t.end) / 60000;
      console.log(
        `  FOUND  ${t.service.padEnd(13)} ${win}` +
        `  → detected ${new Date(f.started_at).toISOString().slice(11, 16)}–${new Date(f.ended_at).toISOString().slice(11, 16)}` +
        `  (edges ${driftStart >= 0 ? '+' : ''}${driftStart}m / ${driftEnd >= 0 ? '+' : ''}${driftEnd}m)` +
        `  ${f.failed_checks}/${f.checks_in_window} failed`
      );
    }
  }

  found.forEach((f, i) => {
    if (matched.has(i)) return;
    unlisted++;
    console.log(
      `  EXTRA  ${f.service_id.padEnd(13)} ` +
      `${new Date(f.started_at).toISOString().slice(0, 16).replace('T', ' ')}–` +
      `${new Date(f.ended_at).toISOString().slice(11, 16)}` +
      `  ${f.failed_checks}/${f.checks_in_window} failed — not in the injected list`
    );
  });
  console.log();
}

await db.close();

console.log(`Recall: ${detected}/${totalTruth} injected incidents detected` +
            `${missed ? ` (${missed} missed)` : ''}.`);
console.log(`${unlisted} detection(s) outside the injected list.`);
console.log(
  '\nNote: an EXTRA is not automatically wrong. The ground truth lists only the\n' +
  'incidents that were deliberately injected; background failures can cluster\n' +
  'into genuine short outages too. Each one is judged on its own pattern.\n'
);

process.exit(missed === 0 ? 0 : 1);
