-- ============================================================================
-- 004: Make service_outages() scale — replace the range self-join with a
--      window frame
--
-- Symptom: on the 30-day file (14,400 cleaned rows) the dashboard showed
--
--     canceling statement due to statement timeout   (SQLSTATE 57014)
--
-- while service_stats() and monthly_sla() returned in well under a second.
-- Supabase caps the anon role at a 3s statement timeout; service_outages()
-- took ~3.5s.
--
-- Cause: the `windows` CTE counted each sliding window with a range self-join.
--
--     FROM ordered a
--     JOIN ordered b ON b.service_id = a.service_id
--                   AND b.rn BETWEEN a.rn - (p_window - 1) AND a.rn
--     GROUP BY a.service_id, a.rn
--
-- `ordered` is a CTE carrying a window function, so it is materialised and
-- carries no indexes. Joining it to itself on a range predicate degrades to
-- scanning the partition per row, so cost grows with the square of the checks
-- per service rather than linearly. It stayed under the timeout at 4,320 and
-- 6,720 rows and crossed it at 14,400 — which means the detector got slower
-- exactly as the uploads got more interesting.
--
-- Fix: a sliding count over N preceding rows is what a window FRAME does
-- natively, in a single ordered pass. The aggregates are unchanged, so the
-- results are identical:
--
--   * COUNT(*) OVER w             — window size, as before. Partial windows at
--                                   the start of a partition still count short,
--                                   so the `win_n = p_window` guard in `flagged`
--                                   keeps excluding them exactly as it did.
--   * COUNT(*) FILTER (...) OVER w — failures within the frame.
--
-- Everything from `flagged` onward is untouched. This is a performance change
-- only: the 5-check window at >50% tuned in migration 003 still finds the same
-- incidents, verified against the same uploads before and after.
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
    -- One ordered pass instead of a range self-join. See header.
    windows AS (
        SELECT o.service_id,
               o.rn                                     AS end_rn,
               COUNT(*)                          OVER w AS win_n,
               COUNT(*) FILTER (WHERE NOT o.is_healthy) OVER w AS win_fails
        FROM ordered o
        WINDOW w AS (
            PARTITION BY o.service_id
            ORDER BY o.rn
            ROWS BETWEEN (p_window - 1) PRECEDING AND CURRENT ROW
        )
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
