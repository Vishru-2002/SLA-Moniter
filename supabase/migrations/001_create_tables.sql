-- Track each upload session
CREATE TABLE IF NOT EXISTS uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    total_rows INT DEFAULT 0,
    cleaned_rows INT DEFAULT 0,
    duplicates_removed INT DEFAULT 0,
    issues JSONB DEFAULT '{}',
    date_range_start DATE,
    date_range_end DATE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    partial_failure BOOLEAN DEFAULT false,
    failed_rows INT DEFAULT 0
);

-- Cleaned monitoring check records
CREATE TABLE IF NOT EXISTS monitoring_checks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    upload_id UUID REFERENCES uploads(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    check_time TIMESTAMPTZ NOT NULL,
    status_code INT NOT NULL,
    latency_ms DOUBLE PRECISION,
    original_latency TEXT,
    original_unit TEXT,
    agent TEXT,
    region TEXT,
    is_healthy BOOLEAN NOT NULL DEFAULT true,
    is_valid_status BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(upload_id, service_id, check_time)
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_checks_upload ON monitoring_checks(upload_id);
CREATE INDEX IF NOT EXISTS idx_checks_service_time ON monitoring_checks(service_id, check_time);
CREATE INDEX IF NOT EXISTS idx_checks_time ON monitoring_checks(check_time);
CREATE INDEX IF NOT EXISTS idx_checks_healthy ON monitoring_checks(is_healthy) WHERE NOT is_healthy;
