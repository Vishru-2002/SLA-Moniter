-- ============================================================================
-- 002: Row Level Security + server-side SLA analytics
--
-- Two changes:
--   1. Lock the tables down. The dashboard reads with the anon key, which ships
--      in the frontend bundle, so the anon role must be read-only. All writes
--      go through the Edge Function, which uses the service-role key and
--      therefore bypasses RLS entirely.
--   2. Move the SLA math out of the browser and into Postgres, so the dashboard
--      fetches a handful of aggregate rows instead of every check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE uploads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read_uploads ON uploads;
DROP POLICY IF EXISTS anon_read_checks  ON monitoring_checks;

-- Read-only for everyone. There is no auth in this app (explicitly out of
-- scope), so "public read" is the intended behaviour -- the point of these
-- policies is that no anonymous client can INSERT, UPDATE or DELETE.
CREATE POLICY anon_read_uploads ON uploads
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY anon_read_checks ON monitoring_checks
    FOR SELECT TO anon, authenticated USING (true);

-- Belt and braces: even if a policy is later widened by accident, the grants
-- keep anonymous clients off the write path.
--
-- Revoke ALL rather than naming INSERT/UPDATE/DELETE: Supabase grants the full
-- set to anon by default, and that set includes TRUNCATE, which is not covered
-- by RLS at all -- an RLS policy cannot stop a TRUNCATE, only the missing grant
-- can. Naming the three obvious verbs leaves the table wipeable.
REVOKE ALL ON uploads           FROM anon, authenticated;
REVOKE ALL ON monitoring_checks FROM anon, authenticated;
GRANT  SELECT ON uploads           TO anon, authenticated;
GRANT  SELECT ON monitoring_checks TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. SLA credit tiers
--
-- The problem statement only fixes the 99.9% threshold. The tiers below it are
-- the conventional cloud-provider shape and are an assumption -- see README.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sla_credit_pct(p_uptime numeric)
RETURNS int
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
    SELECT CASE
        WHEN p_uptime IS NULL  THEN 0
        WHEN p_uptime >= 99.9  THEN 0
        WHEN p_uptime >= 99.0  THEN 10
        WHEN p_uptime >= 95.0  THEN 25
        ELSE 100
    END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. Per-service stats, optionally restricted to a date window
--
-- p_start / p_end are inclusive dates. NULL means "no bound", so the dashboard
-- can ask for the whole upload or for exactly the window the user filtered to.
--
-- The bounds are anchored with AT TIME ZONE 'UTC', not a bare ::timestamptz
-- cast. A bare cast resolves the date against the SERVER's timezone, so on any
-- database not set to UTC the window silently slides by the offset and returns
-- the wrong day's rows. All check_time values are stored in UTC, so the window
-- must be built in UTC too.
--
-- Status 999 is NOT excluded: it is not a valid HTTP code, so it is not a
-- successful check, so it counts against uptime. See README "Assumptions".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION service_stats(
    p_upload_id uuid,
    p_start     date DEFAULT NULL,
    p_end       date DEFAULT NULL
)
RETURNS TABLE (
    service_id            text,
    service_name          text,
    total_checks          bigint,
    healthy_checks        bigint,
    failed_checks         bigint,
    invalid_status_checks bigint,
    uptime_pct            numeric,
    sla_met               boolean,
    credit_pct            int,
    avg_latency_ms        numeric,
    p50_latency_ms        double precision,
    p95_latency_ms        double precision,
    p99_latency_ms        double precision,
    worst_day             date,
    worst_day_failures    bigint
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
    WITH scoped AS (
        SELECT c.*
        FROM monitoring_checks c
        WHERE c.upload_id = p_upload_id
          AND (p_start IS NULL OR c.check_time >= (p_start::timestamp AT TIME ZONE 'UTC'))
          AND (p_end   IS NULL OR c.check_time <  ((p_end + 1)::timestamp AT TIME ZONE 'UTC'))
    ),
    base AS (
        SELECT
            s.service_id,
            MAX(s.service_name)                           AS service_name,
            COUNT(*)                                      AS total_checks,
            COUNT(*) FILTER (WHERE s.is_healthy)          AS healthy_checks,
            COUNT(*) FILTER (WHERE NOT s.is_healthy)      AS failed_checks,
            COUNT(*) FILTER (WHERE NOT s.is_valid_status) AS invalid_status_checks,
            ROUND(100.0 * COUNT(*) FILTER (WHERE s.is_healthy)
                        / NULLIF(COUNT(*), 0), 4)         AS uptime_pct,
            ROUND(AVG(s.latency_ms)::numeric, 2)          AS avg_latency_ms,
            percentile_disc(0.50) WITHIN GROUP (ORDER BY s.latency_ms) AS p50_latency_ms,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY s.latency_ms) AS p95_latency_ms,
            percentile_disc(0.99) WITHIN GROUP (ORDER BY s.latency_ms) AS p99_latency_ms
        FROM scoped s
        GROUP BY s.service_id
    ),
    worst AS (
        SELECT DISTINCT ON (d.service_id)
               d.service_id, d.day, d.failures
        FROM (
            SELECT s.service_id,
                   (s.check_time AT TIME ZONE 'UTC')::date AS day,
                   COUNT(*) AS failures
            FROM scoped s
            WHERE NOT s.is_healthy
            GROUP BY 1, 2
        ) d
        ORDER BY d.service_id, d.failures DESC, d.day
    )
    SELECT
        b.service_id,
        b.service_name,
        b.total_checks,
        b.healthy_checks,
        b.failed_checks,
        b.invalid_status_checks,
        b.uptime_pct,
        b.uptime_pct >= 99.9         AS sla_met,
        sla_credit_pct(b.uptime_pct) AS credit_pct,
        b.avg_latency_ms,
        b.p50_latency_ms,
        b.p95_latency_ms,
        b.p99_latency_ms,
        w.day                        AS worst_day,
        COALESCE(w.failures, 0)      AS worst_day_failures
    FROM base b
    LEFT JOIN worst w ON w.service_id = b.service_id
    ORDER BY b.uptime_pct ASC, b.service_id;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. Monthly SLA + billing credit
--
-- The SLA in the problem statement is a MONTHLY availability guarantee, and an
-- upload can straddle a month boundary (the 30-day sample runs Apr 6 -> May 5).
-- Rolling a whole file into one uptime number is therefore not a monthly
-- verdict, so bucket by calendar month.
--
-- days_covered / days_in_month let the UI mark partial months: a month the data
-- only partly covers cannot settle a real billing credit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monthly_sla(p_upload_id uuid)
RETURNS TABLE (
    service_id       text,
    service_name     text,
    month            date,
    total_checks     bigint,
    healthy_checks   bigint,
    failed_checks    bigint,
    uptime_pct       numeric,
    sla_met          boolean,
    credit_pct       int,
    days_covered     bigint,
    days_in_month    int,
    is_partial_month boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
    WITH m AS (
        SELECT
            c.service_id,
            MAX(c.service_name) AS service_name,
            date_trunc('month', c.check_time AT TIME ZONE 'UTC')::date AS month,
            COUNT(*)                                 AS total_checks,
            COUNT(*) FILTER (WHERE c.is_healthy)     AS healthy_checks,
            COUNT(*) FILTER (WHERE NOT c.is_healthy) AS failed_checks,
            ROUND(100.0 * COUNT(*) FILTER (WHERE c.is_healthy)
                        / NULLIF(COUNT(*), 0), 4)    AS uptime_pct,
            COUNT(DISTINCT (c.check_time AT TIME ZONE 'UTC')::date) AS days_covered
        FROM monitoring_checks c
        WHERE c.upload_id = p_upload_id
        GROUP BY c.service_id, 3
    )
    SELECT
        m.service_id,
        m.service_name,
        m.month,
        m.total_checks,
        m.healthy_checks,
        m.failed_checks,
        m.uptime_pct,
        m.uptime_pct >= 99.9         AS sla_met,
        sla_credit_pct(m.uptime_pct) AS credit_pct,
        m.days_covered,
        EXTRACT(DAY FROM (m.month + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month,
        m.days_covered < EXTRACT(DAY FROM (m.month + INTERVAL '1 month' - INTERVAL '1 day'))::int
                                     AS is_partial_month
    FROM m
    ORDER BY m.month, m.uptime_pct ASC, m.service_id;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. Outage / flapping detection
--
-- A strict "N consecutive failures" rule misses flapping incidents, where a
-- service is mostly-down but the odd check still succeeds. Instead: slide a
-- window of p_window consecutive checks per service, flag every window whose
-- failure rate exceeds p_threshold, then merge overlapping and adjacent flagged
-- windows into one incident (classic gaps-and-islands).
--
-- Incident boundaries are trimmed to the first and last FAILING check inside
-- the merged island, so a window's healthy lead-in does not inflate it.
--
-- duration_minutes adds the trailing check's own interval, since a failed check
-- represents roughly one check interval of unavailability. That interval is
-- measured from the data (median gap per service), not assumed to be 15 min.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION service_outages(
    p_upload_id uuid,
    p_window    int     DEFAULT 6,
    p_threshold numeric DEFAULT 0.5
)
RETURNS TABLE (
    service_id       text,
    service_name     text,
    started_at       timestamptz,
    ended_at         timestamptz,
    duration_minutes numeric,
    checks_in_window bigint,
    failed_checks    bigint,
    failure_rate     numeric
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
    WITH ordered AS (
        SELECT c.service_id, c.service_name, c.check_time, c.is_healthy,
               ROW_NUMBER() OVER (PARTITION BY c.service_id ORDER BY c.check_time) AS rn
        FROM monitoring_checks c
        WHERE c.upload_id = p_upload_id
    ),
    gaps AS (
        SELECT o.service_id,
               EXTRACT(EPOCH FROM (o.check_time
                   - LAG(o.check_time) OVER (PARTITION BY o.service_id ORDER BY o.rn))) / 60 AS gap_min
        FROM ordered o
    ),
    interval_est AS (
        SELECT g.service_id,
               COALESCE(percentile_disc(0.5) WITHIN GROUP (ORDER BY g.gap_min), 0) AS gap_min
        FROM gaps g
        WHERE g.gap_min IS NOT NULL
        GROUP BY g.service_id
    ),
    windows AS (
        SELECT a.service_id,
               a.rn                                    AS end_rn,
               COUNT(*)                                AS win_n,
               COUNT(*) FILTER (WHERE NOT b.is_healthy) AS win_fails
        FROM ordered a
        JOIN ordered b
          ON b.service_id = a.service_id
         AND b.rn BETWEEN a.rn - (p_window - 1) AND a.rn
        GROUP BY a.service_id, a.rn
    ),
    flagged AS (
        SELECT w.service_id, w.end_rn
        FROM windows w
        WHERE w.win_n = p_window
          AND w.win_fails::numeric / w.win_n > p_threshold
    ),
    covered AS (
        SELECT DISTINCT f.service_id, g.rn
        FROM flagged f
        CROSS JOIN LATERAL generate_series(f.end_rn - (p_window - 1), f.end_rn) AS g(rn)
    ),
    islands AS (
        SELECT c.service_id,
               c.rn,
               c.rn - ROW_NUMBER() OVER (PARTITION BY c.service_id ORDER BY c.rn) AS grp
        FROM covered c
    ),
    joined AS (
        SELECT i.service_id, i.grp, o.service_name, o.check_time, o.is_healthy
        FROM islands i
        JOIN ordered o ON o.service_id = i.service_id AND o.rn = i.rn
    ),
    incidents AS (
        SELECT
            j.service_id,
            j.grp,
            MAX(j.service_name)                               AS service_name,
            MIN(j.check_time) FILTER (WHERE NOT j.is_healthy) AS started_at,
            MAX(j.check_time) FILTER (WHERE NOT j.is_healthy) AS ended_at,
            COUNT(*)                                          AS checks_in_window,
            COUNT(*) FILTER (WHERE NOT j.is_healthy)          AS failed_checks
        FROM joined j
        GROUP BY j.service_id, j.grp
    )
    SELECT
        i.service_id,
        i.service_name,
        i.started_at,
        i.ended_at,
        ROUND((EXTRACT(EPOCH FROM (i.ended_at - i.started_at)) / 60)::numeric
              + COALESCE(e.gap_min, 0)::numeric, 1)                  AS duration_minutes,
        i.checks_in_window,
        i.failed_checks,
        ROUND(100.0 * i.failed_checks / NULLIF(i.checks_in_window, 0), 1) AS failure_rate
    FROM incidents i
    LEFT JOIN interval_est e ON e.service_id = i.service_id
    WHERE i.failed_checks > 0
    ORDER BY i.started_at;
$fn$;

-- ----------------------------------------------------------------------------
-- 6. Upload index
--
-- Without this, an upload is only reachable by remembering its UUID. The home
-- page lists uploads from this view.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW upload_summaries
WITH (security_invoker = true) AS
SELECT
    u.id,
    u.filename,
    u.total_rows,
    u.cleaned_rows,
    u.duplicates_removed,
    u.issues,
    u.date_range_start,
    u.date_range_end,
    u.uploaded_at,
    u.partial_failure,
    u.failed_rows,
    COALESCE(agg.service_count, 0)   AS service_count,
    agg.worst_uptime_pct,
    COALESCE(agg.breaching_count, 0) AS breaching_count
FROM uploads u
LEFT JOIN LATERAL (
    SELECT COUNT(*)                                    AS service_count,
           MIN(s.uptime_pct)                           AS worst_uptime_pct,
           COUNT(*) FILTER (WHERE s.uptime_pct < 99.9) AS breaching_count
    FROM (
        SELECT c.service_id,
               ROUND(100.0 * COUNT(*) FILTER (WHERE c.is_healthy)
                           / NULLIF(COUNT(*), 0), 4) AS uptime_pct
        FROM monitoring_checks c
        WHERE c.upload_id = u.id
        GROUP BY c.service_id
    ) s
) agg ON true;

GRANT SELECT ON upload_summaries TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sla_credit_pct(numeric)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION service_stats(uuid, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION monthly_sla(uuid)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION service_outages(uuid, int, numeric) TO anon, authenticated;
