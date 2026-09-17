-- ============================================================================
-- 003: Retune the outage detector against the provided ground truth
--
-- The assignment ships problem_statement/dataset_incident_log.json, listing the
-- incidents deliberately injected into each sample file. I first validated that
-- file against the CSVs rather than trusting it: start dates and day counts
-- match, check-point N maps to N*15 minutes as claimed, and every listed window
-- runs at a 50-84% failure rate against a 0.42-2.61% baseline for the same
-- service elsewhere. It is a sound validation set.
--
-- (Its window *edges* are approximate -- the strings say "~" -- and real
-- flapping bleeds past them by a check or two in both directions. So it is used
-- to score whether an incident was found, not to grade boundaries.)
--
-- Scoring the detector against it (npm run verify:detector) showed the original
-- defaults, a 6-check window at >50%, missed one of the eight:
--
--     svc-search, 2025-04-18 12:15-13:30, pattern . X . . X X
--
-- Three failures in six checks is exactly 50%, and a strictly-greater-than test
-- rejects it by a single check. It is the flappiest incident in the set, which
-- is precisely the case a sliding window exists to catch.
--
-- Sweeping (window, threshold) across all five files:
--
--     window  threshold   injected found   detections outside the list
--        4       >50%          7/8                    3
--        5       >50%          8/8                    1
--        6       >50%          7/8                    0   <- previous default
--        8       >50%          7/8                    0
--       10       >50%          7/8                    0
--
-- A 5-check window at >50% -- three or more failures in any five consecutive
-- checks -- is the only setting that finds all eight. Its one detection outside
-- the injected list is:
--
--     svc-search, 2025-05-16 10:15-10:45 -- three CONSECUTIVE failures
--     (500, 502, 503)
--
-- That is not a false positive. It is 45 minutes of a service returning 5xx,
-- which is exactly what an on-call engineer wants surfaced; it simply was not
-- one of the injected incidents. The ground truth enumerates what was planted,
-- not everything that qualifies as an outage.
--
-- Recall is the right thing to favour here regardless: this list is the on-call
-- view. Billing credits are driven by the uptime percentage, which these
-- parameters do not affect at all, so an extra incident row cannot move
-- anybody's money.
--
-- Only the two default values change. The body is identical to 002.
-- ============================================================================
CREATE OR REPLACE FUNCTION service_outages(
    p_upload_id uuid,
    p_window    int     DEFAULT 5,
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

GRANT EXECUTE ON FUNCTION service_outages(uuid, int, numeric) TO anon, authenticated;
