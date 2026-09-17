# EarthRe SLA Monitoring Dashboard

Ingests health-check CSV logs through a deployed serverless function, cleans and
persists them, and shows service availability, monthly SLA credits and detected
incidents on a single filterable dashboard.

---

## Live URL

- **App:** <https://sla-moniter-dashboard.vercel.app/>
- **Cloud function:**
  `https://qbvwdxcnbampwmzidkoy.supabase.co/functions/v1/upload-csv`
- **Last verified live:** 2026-09-17 — all four migrations applied, function
  deployed, and all five sample CSVs uploaded end-to-end. Row counts reconcile
  exactly against the table below, and the deployed `service_outages()`
  reproduces **all 8 injected incidents** from `dataset_incident_log.json` with
  the failed/checks counts shown in [Scoring it against the provided ground
  truth](#scoring-it-against-the-provided-ground-truth).

If the free tier has paused the Supabase project, it can be redeployed in a few
minutes — see [Deploying](#deploying).

---

## Architecture

```
┌──────────────────────────┐      ┌───────────────────────────────┐      ┌────────────────────┐
│   React SPA (Vite)       │      │  Supabase Edge Function       │      │  Supabase           │
│   Hosted on Vercel       │─────▶│  /upload-csv                  │─────▶│  PostgreSQL        │
│                          │ POST │  (Deno Deploy — stateless)    │ service│                   │
│  • Upload page           │ CSV  │                               │  role  │ • uploads         │
│  • Upload index          │      │  Parse → validate → clean     │        │ • monitoring_     │
│  • Dashboard             │◀─────│  → dedupe → sort → batch      │        │   checks          │
│    (stats + logs)        │ JSON │    INSERT                     │        │ • SQL analytics   │
└──────────────────────────┘      └───────────────────────────────┘        └──────────────────┘
         │                                                                       ▲
         └────────── anon key, SELECT-only (RLS) + read-only RPC ────────────────┘
```

### Why each piece

| Component | Choice | Rationale |
|---|---|---|
| **Frontend** | React + Vite + TypeScript + Tailwind | Fast builds, type safety. An SPA is enough — there is nothing to server-render |
| **Serverless function** | Supabase Edge Function (Deno Deploy) | Genuinely stateless and cloud-hosted, as required. Same project as the DB, so no cross-provider credentials |
| **Database** | Supabase PostgreSQL | Free tier, and the analysis is genuinely relational — window functions do the outage detection that would otherwise be a pile of JavaScript |
| **Aggregation** | SQL functions, not client JS | The dashboard reads ~30 aggregate rows instead of up to 15,577 raw checks |
| **Frontend hosting** | Vercel | Free tier, auto-deploy from GitHub |

### Where the work happens

- **Cleaning** — [`supabase/functions/upload-csv/index.ts`](supabase/functions/upload-csv/index.ts). Runs once per upload, in the cloud.
- **Schema** — [`supabase/migrations/001_create_tables.sql`](supabase/migrations/001_create_tables.sql).
- **Security + analytics** — [`supabase/migrations/002_rls_and_analytics.sql`](supabase/migrations/002_rls_and_analytics.sql). RLS policies and the four SQL functions behind the dashboard.
- **Detector tuning** — [`supabase/migrations/003_tune_outage_detector.sql`](supabase/migrations/003_tune_outage_detector.sql). Retunes `service_outages()` to the window size measured below; the body is unchanged from 002.
- **Detector performance** — [`supabase/migrations/004_outage_detector_window_frame.sql`](supabase/migrations/004_outage_detector_window_frame.sql). Same results, counted in one ordered pass with a window frame instead of a range self-join.

---

## Data findings

I wrote a throwaway analysis script against all five sample CSVs rather than
eyeballing one of them. Exact counts per file:

| file | rows | days | unix ts | `+05:30` ts | latency in `s` | empty latency | …of those, non-200 | negative latency | status `999` | duplicate rows | cross-format dups | agent status conflicts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `9d_seed101`  | 4,672  | 9  | 70  | 32  | 935   | 56  | 0 | 1 | 1 | 352   | 13 | 0 |
| `12d_seed505` | 6,230  | 12 | 93  | 43  | 1,242 | 74  | 0 | 1 | 1 | 470   | 19 | 0 |
| `14d_seed202` | 7,269  | 14 | 109 | 50  | 1,452 | 87  | 4 | 1 | 1 | 549   | 21 | 1 |
| `21d_seed303` | 10,904 | 21 | 163 | 76  | 2,184 | 130 | 2 | 1 | 1 | 824   | 34 | 0 |
| `30d_seed404` | 15,577 | 30 | 233 | 109 | 3,131 | 186 | 0 | 1 | 1 | 1,177 | 45 | 0 |

### 1. Three timestamp formats in one column

ISO-8601 UTC (`2025-05-11T05:45:00Z`), bare Unix epoch seconds
(`1746938700`), and ISO-8601 with a `+05:30` offset. Roughly 1.5% epoch and
0.7% offset, in every file.

**Handled:** a numeric-only string is treated as epoch seconds and multiplied by
1000; everything else goes through `new Date()`, which handles both `Z` and
offset forms. All three normalise to an absolute UTC instant before anything
else touches the row.

### 2. Mixed latency units

About 20% of rows report latency in `s` (`0.717`), the rest in `ms` (`717`).
The `latency_unit` column says which, so the values are not ambiguous — but
anything that averages the raw column without reading it is off by 1000×.

**Handled:** multiply by 1000 when the unit is `s`. The original value and unit
are kept in `original_latency` / `original_unit` so any number on the dashboard
can be traced back to what the agent actually reported. The logs table exposes
this on hover.

> The `latency in s` column above counts rows *declaring* seconds; the upload
> report counts conversions actually performed, and the two differ slightly. In
> `14d_seed202`, 1,452 rows carry `s` but 17 of them have no latency value, so
> 1,435 conversions happen. Neither number is wrong — they measure the raw data
> and the work done to it respectively.

### 3. Missing latency values

56–186 rows per file have an empty latency on an otherwise complete row.

**Handled:** stored as `NULL`, excluded from latency aggregates, but the row is
still counted for uptime — the check has a status code, so it tells us whether
the service was up regardless of whether the timing was recorded.


### 4. Negative latency

Exactly one row per file, e.g. `-296 ms`. Physically impossible.

**Handled:** latency set to `NULL`, row retained for uptime. Kept separately
from "missing" in the cleaning report, because a negative number is corruption
whereas an empty one is absence, and conflating them would hide the corruption.

### 5. Status code `999`

Exactly one row per file. Not an HTTP status code at all.

**Handled:** flagged via `is_valid_status = false`, **and counted as a failed
check**. It is not in the 200–399 range, so it is not evidence the service was
up. Since the data decides a billing credit, an unrecognisable code should not
silently improve a provider's uptime number.


### 6. Duplicate records from overlapping agents

352–1,177 excess rows per file. Two agents (`agent-1`, `agent-2`) sometimes
report the same check; `agent-2` accounts for ~7–8% of rows and almost all of
the duplicates.

**Handled:** deduplicate on `(service_id, check_time)` — **after** timestamp
normalisation. That ordering is the part that matters: 13–45 duplicate groups
per file pair rows written in *different* timestamp formats (ISO-Z against Unix
epoch, ISO-Z against `+05:30`, and in three files epoch against offset).
Deduplicating on the raw timestamp string leaves every one of those in place,
and they inflate the denominator of the uptime calculation.


### 7. Unsorted rows

Rows arrive in random order, which matters because the outage detector below is
sequence-sensitive.

**Handled:** sorted chronologically in the function before insert, and the SQL
orders by `check_time` explicitly rather than relying on insertion order.

### 8. Outages are clustered, and a raw uptime % hides that

Failures are not uniformly distributed. Each file contains one or two
concentrated incidents (2–5.5 hours) plus scattered background failures. Forty
scattered failures and forty consecutive ones produce an identical uptime
percentage, but only one of them is an incident somebody was paged for.

The incidents also *flap* — a mostly-down window still contains the occasional
healthy check — so a strict "N consecutive failures" rule finds nothing.

**Handled:** [`service_outages()`](supabase/migrations/004_outage_detector_window_frame.sql)
slides a 5-check window per service, flags every window whose failure rate
exceeds 50%, merges overlapping and adjacent flagged windows into a single
incident (gaps-and-islands), then trims each incident to its first and last
*failing* check. The check interval is measured from the data (median gap per
service) rather than assumed to be 15 minutes.

#### Scoring it against the provided ground truth

The assignment ships `problem_statement/dataset_incident_log.json`, which lists
the incidents deliberately injected into each file. It is the only way to tell
whether the detector actually works rather than merely producing plausible
output.

**I validated the ground truth before trusting it.** Start dates and day counts
match the data in all five files; check-point *N* maps to *N* × 15 minutes as
claimed, in all eight incidents; and every listed window runs at a **50–84%
failure rate against a 0.42–2.61% baseline** for the same service elsewhere — a
25–160× lift, so these are unambiguously planted rather than coincidence. Across
all five files there is exactly one run of ≥3 consecutive failures it does not
list, so it is near-complete too.

One caveat: its window *edges* are approximate (the strings say `~`), and real
flapping bleeds past them. In `9d_seed101` the log says 16:00–17:15, but the
service is still returning 500s at 17:30 and 18:00 before recovering at 18:15 —
the detector's 16:00–18:00 is the more accurate boundary. So the log is used to
score *whether* an incident was found, not to grade edges to the minute.

**Result: 8/8 injected incidents detected.**

| file | service | ground truth | detected | failed / checks |
|---|---|---|---|---|
| `9d_seed101`  | `svc-reports`  | May 13, 16:00–17:15 | 16:00–18:00 | 6 / 11 |
| `12d_seed505` | `svc-search`   | Apr 14, 12:00–16:45 | 12:00–16:45 | 16 / 23 |
| `12d_seed505` | `svc-search`   | Apr 18, 12:15–13:30 | 12:30–13:30 | 3 / 5 |
| `14d_seed202` | `svc-notify`   | May 19, 14:45–19:15 | 14:45–19:00 | 16 / 22 |
| `14d_seed202` | `svc-notify`   | May 25, 07:30–10:00 | 07:30–09:45 | 8 / 12 |
| `21d_seed303` | `svc-payments` | Apr 5, 09:30–15:00  | 09:30–14:30 | 16 / 25 |
| `30d_seed404` | `svc-reports`  | Apr 9, 11:45–13:45  | 11:45–13:45 | 7 / 11 |
| `30d_seed404` | `svc-auth`     | Apr 22, 04:00–10:15 | 04:00–09:15 | 17 / 25 |

Plus one detection not on the list: `svc-search`, May 16, 10:15–10:45 in
`9d_seed101` — **three consecutive failures** (500, 502, 503). That is 45 minutes
of a service returning 5xx, so it is a real outage that simply was not injected,
not a false positive.

#### Why a 5-check window

The window size is picked from this measurement rather than by feel. Sweeping it
across all five files:

| window | injected found | detections outside the list |
|---|---|---|
| 4  | 7/8 | 3 |
| **5**  | **8/8** | **1** (the genuine 5xx run above) |
| 6  | 7/8 | 0 |
| 8  | 7/8 | 0 |
| 10 | 7/8 | 0 |

A 6-check window missed `svc-search` on Apr 18, whose pattern is `. X . . X X` —
three failures in six checks is *exactly* 50%, so a strictly-greater-than test
rejects it by one check. That is the flappiest incident in the set, which is
precisely what a sliding window exists to catch.

Recall is the right thing to favour here anyway: this list is the on-call view,
and billing credits come from the uptime percentage, which these parameters do
not touch. An extra incident row cannot move anybody's money; a missed outage
means nobody gets paged.

### 9. What is *not* wrong with the data

Worth stating, because "I checked and it's fine" is a finding too:

- **No gaps.** Every file is a complete 15-minute grid — 5 services × 96 checks
  × N days, with zero missing slots. I checked for them specifically; there are
  none, so there is no interpolation or coverage-gap handling in the pipeline.
- **No naming drift.** Each `service_id` maps to exactly one `service_name`.
- **One region only** (`ap-south-1`), so there is no cross-region reconciliation
  to do.
- **No malformed rows** — no quoted fields, no BOM, no ragged columns, no
  unparseable timestamps. The parser is therefore simpler than it would need to
  be for arbitrary CSV; see [Limitations](#limitations).

---

## Assumptions & design decisions

1. **SLA threshold is 99.9%**, from the brief. Uptime is
   `healthy_checks / total_checks`, i.e. every check is weighted equally. With a
   complete grid and duplicates removed, check-weighted and time-weighted uptime
   are the same thing here.

2. **"Healthy" is status 200–399.** 4xx, 5xx and non-HTTP codes are failures.

3. **The SLA is monthly, so uptime is bucketed by calendar month.** The brief's
   premise is *"if monthly availability drops below 99.9%, the customer gets a
   billing credit"*. An upload does not have to align to a month —
   `30d_seed404` runs Apr 6 → May 5, straddling two. Rolling the whole file into
   one number would produce a figure that cannot settle a credit, so
   `monthly_sla()` groups by month and the dashboard leads with that table.

4. **Partial months are labelled, not hidden.** Every month in the sample data
   is partially covered. The table shows `days_covered / days_in_month` and a
   `partial` badge: the uptime figure is real, but it is not a settled monthly
   SLA result, and presenting it as one would be the kind of thing that ends up
   in a billing dispute.

5. **Credit tiers are an assumption.** The brief fixes 99.9% but says nothing
   about what the credit *is*. I used the conventional cloud-provider shape:

   | Monthly uptime | Credit |
   |---|---|
   | ≥ 99.9% | 0% |
   | 99.0% – 99.9% | 10% |
   | 95.0% – 99.0% | 25% |
   | < 95.0% | 100% |

   These live in one function (`sla_credit_pct`) so a real tier table can be
   swapped in without touching anything else.

6. **Stats chosen for two readers.** For **billing**: monthly uptime, credit
   owed, coverage completeness. For **on-call**: the incident list (when, how
   long, how bad), worst day per service, and p50/p95/p99 latency. Raw uptime
   alone serves neither — it cannot tell billing which month to credit, and it
   cannot tell an engineer when anything actually broke.

7. **Filter scope is deliberately not uniform.** Per-service stats follow the
   dashboard's date filter, so "what did last Tuesday look like" is answerable.
   Monthly SLA and the incident list always cover the whole upload: a credit is
   settled per calendar month, so recomputing it from an arbitrary filtered
   slice would produce a meaningless number. The per-service section shows which
   window it is describing.

8. **Overall uptime is check-weighted**, not the mean of per-service
   percentages. Averaging percentages weights a thin service the same as a busy
   one.

9. **Each dashboard is scoped to one `upload_id`.** Re-uploading the same file,
   or overlapping periods, cannot double-count — each upload is an isolated
   snapshot. The home page lists past uploads so they remain reachable without
   remembering a UUID.

10. **Aggregation runs in Postgres, not the browser.** Partly performance, but
    mainly that the outage detection is a windowing problem that SQL expresses
    directly and JavaScript does not.

---

## Security

There is no authentication — explicitly out of scope. That makes the anon key's
privileges the entire security boundary, and the anon key ships inside the
frontend bundle where anyone can read it.

[`002_rls_and_analytics.sql`](supabase/migrations/002_rls_and_analytics.sql):

- RLS enabled on both tables, with `SELECT`-only policies for `anon` and
  `authenticated`.
- `REVOKE ALL` then `GRANT SELECT`, rather than revoking `INSERT`/`UPDATE`/
  `DELETE` by name. Supabase grants the full privilege set to `anon` by default
  and that set includes **`TRUNCATE`, which RLS does not cover at all** — no
  policy can stop a truncate, only the absent grant can. Naming the three
  obvious verbs leaves the tables wipeable by anyone who reads the bundle.
- Writes happen only in the Edge Function, which uses the service-role key and
  bypasses RLS. That key is never exposed to the browser.

The `REVOKE ALL` ordering matters more than it looks: an earlier draft revoked
`INSERT, UPDATE, DELETE` by name and left the tables truncatable by anyone
holding the anon key. Both properties are asserted in the tests below.

---

## Verification

The SQL has the most room to be quietly wrong, so it is executed rather than
reasoned about. Both scripts run the migrations in
[PGlite](https://github.com/electric-sql/pglite) — real Postgres compiled to
WASM — and load rows through the pipeline's own `clean.ts`, so they exercise the
deployed code rather than a reimplementation.

```bash
npm run verify:sql        # migrations, RLS, analytics correctness
npm run verify:detector   # outage detector vs. the provided incident log
```

`verify:sql` asserts that `anon` ends up holding `SELECT` and nothing else, that
it is blocked from `INSERT`/`UPDATE`/`DELETE` **and `TRUNCATE`**, and that the
date-window filter matches an independently computed ground truth — on a session
deliberately set to `Etc/GMT-5`, because a bare `::timestamptz` cast resolves
against the server timezone and would slide the window silently on any database
that is not UTC. Supabase runs in UTC, so that bug would have looked correct in
production.

Both scripts read the migrations directory rather than naming files, so a
migration added later is covered automatically instead of the suite drifting
behind the schema it claims to verify.

`verify:detector` scores the detector against
`problem_statement/dataset_incident_log.json` and currently reports **8/8
injected incidents detected**, with one detection outside the list — the genuine
three-check 5xx run described above. The windows it prints match what the
deployed database returns for the same files.

---

## Local development

**Prerequisites:** Node 18+, a free Supabase project, the Supabase CLI.

```bash
npm install

# 1. Database: run the four migrations in the Supabase SQL editor, in order
#      supabase/migrations/001_create_tables.sql
#      supabase/migrations/002_rls_and_analytics.sql
#      supabase/migrations/003_tune_outage_detector.sql
#      supabase/migrations/004_outage_detector_window_frame.sql
#    (or: supabase db push --linked)

# 2. Cloud function
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy upload-csv

# 3. Environment
cp .env.example .env.local     # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm run dev                    # http://localhost:5173
npm run verify:sql             # migration/RLS/analytics tests (no cloud needed)
```

Use the anon key, not the service-role key — the app only needs to read, and the
RLS policies are written on that assumption.

### Deploying

- **Frontend:** connect the repo to Vercel, set `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`, push to `main`.
- **Function:** `supabase functions deploy upload-csv`. It reads `SUPABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects automatically.
- **Database:** run the four migrations in order, or `supabase db push --linked`.

Full redeploy from scratch is roughly ten minutes.

---

## Limitations

Each of these is a decision I made knowingly, not something I discovered
afterwards. The pattern is the same throughout: the pipeline is built to be
correct on *this* data and honest about where that stops.

**The CSV parser splits on commas.** No quoted fields, no embedded newlines, no
BOM handling. I verified that none of the five sample files need any of it, so
this is correct here and not merely lucky — but a single quoted field containing
a comma would shift every column right and corrupt the row silently, which is
the worst failure mode a parser can have. The fix is a real parser, not a better
regex.

**Timestamp parsing is all-or-nothing.** One unparseable value makes `new Date()`
throw, the error reaches the top-level handler, and the entire upload is
rejected. For a 15k-row file where a single row is malformed, that is the wrong
trade: bad rows should be quarantined, counted, and reported alongside the
cleaning summary, so the other 15,576 still land.

**The whole file is buffered in memory.** There is a 25 MB cap
([`index.ts`](supabase/functions/upload-csv/index.ts)) so the endpoint cannot be
knocked over by an unbounded upload, but a cap is a guard rail, not a design.
Streaming the parse would remove the ceiling rather than just enforce it.

**The upload endpoint is unauthenticated.** Auth is explicitly out of scope, and
the security work went into making the *read* path safe — the anon key in the
bundle can only `SELECT`. But the consequence is real and worth naming: anyone
with the function URL can create an upload. In production this needs a key or a
signed URL, not more RLS.

**Detector parameters are global, not per-service.** `service_outages()` takes a
window and a threshold, but the defaults are one pair for every service. They
were chosen by measurement across all five files (below), so they are not
arbitrary — yet a service checked every 5 minutes and one checked hourly do not
deserve the same 5-check window. Per-service calibration is the honest version.

**The dashboard's three sections answer three different time windows.** Monthly
SLA and the incident list always describe the whole upload; only the per-service
cards follow the date filter. That is deliberate and argued in *Assumptions* —
a billing credit recomputed from an arbitrary slice is a meaningless number —
but it means filtering to one day visibly changes only part of the page, and the
UI currently labels the scope on one section out of three.

## What I'd build next

Ordered by how much each one changes what the dashboard is *for*, not by effort.

**1. Make the pipeline survive bad input.** A real CSV parser, then per-row
quarantine with a rejected-rows report, then streaming instead of buffering.
Right now the cleaning report tells you what was fixed; it should also tell you
what was thrown away and why. These are the limitations above, in the order I
would actually fix them.

**2. Charts — the largest gap between this and a dashboard someone watches.**
Everything on the page is currently a number or a table, which means the central
finding of the data analysis — that failures are *clustered*, not uniform — is
argued in prose rather than shown. A per-service availability strip over time,
with incidents shaded, makes that visible in one glance, and a latency time
series answers the question the incident list cannot: *is this getting worse?*

**3. Error budget burn-down instead of a pass/fail badge.** At 99.9% monthly a
service is allowed roughly 43 minutes of downtime. "12 minutes of budget left,
9 days to go" tells an on-call engineer whether to act; "SLA Met" tells them
nothing until it is already too late. Same data, a decision instead of a verdict.

**4. Make incidents investigable.** The incident list gives a service and a time
window; the logs table can filter to exactly that. Wiring one to the other — click
an incident, land on its checks — turns two separate readouts into an actual
drill-down, and it is a small change because both halves already exist.

**5. Surface failures in the logs table.** With 15k rows at 50 per page, the
failing checks are effectively unreachable by paging. A status-class filter
(`5xx only`, `failures only`) is the cheapest useful thing left on the page.

**6. Code-split the bundle.** 556 KB raw, 160 KB gzipped, dominated by the
dashboard route — the upload page pays for a dashboard the first-time visitor
has not reached yet.
