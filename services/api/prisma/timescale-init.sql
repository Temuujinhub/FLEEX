-- Fleex – TimescaleDB initialisation. Runs every API boot (idempotent).
-- Creates the positions hypertable, compression + retention policies, and the
-- daily continuous aggregate. Anything Prisma cannot model declaratively
-- lives here.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- positions: GPS telemetry stream. ~8.6M rows/day for 1k devices at 10s.
CREATE TABLE IF NOT EXISTS positions (
    time         TIMESTAMPTZ      NOT NULL,
    device_id    UUID             NOT NULL,
    company_id   UUID             NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    speed        REAL,
    course       REAL,
    altitude     REAL,
    satellites   SMALLINT,
    hdop         REAL,
    ignition     BOOLEAN,
    odometer_km  DOUBLE PRECISION,
    engine_hours DOUBLE PRECISION,
    battery_volt REAL,
    fuel_pct     REAL,
    rfid         TEXT,
    valid        BOOLEAN NOT NULL DEFAULT TRUE,
    attributes   JSONB,
    received_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    PRIMARY KEY (device_id, time)
);

SELECT create_hypertable(
    'positions',
    'time',
    chunk_time_interval => INTERVAL '1 month',
    if_not_exists       => TRUE
);

CREATE INDEX IF NOT EXISTS positions_device_time_desc
    ON positions (device_id, time DESC);
CREATE INDEX IF NOT EXISTS positions_company_time_desc
    ON positions (company_id, time DESC);
CREATE INDEX IF NOT EXISTS positions_attributes_gin
    ON positions USING GIN (attributes jsonb_path_ops);

-- Compression: idempotent guard so re-running doesn't double-apply.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'positions' AND compression_enabled = TRUE
    ) THEN
        ALTER TABLE positions SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'device_id',
            timescaledb.compress_orderby   = 'time DESC'
        );
    END IF;
END $$;

SELECT add_compression_policy('positions', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy  ('positions', INTERVAL '395 days', if_not_exists => TRUE);

-- Daily per-device summary for reports & charts.
CREATE MATERIALIZED VIEW IF NOT EXISTS positions_daily
WITH (timescaledb.continuous) AS
SELECT
    device_id,
    company_id,
    time_bucket('1 day', time) AS day,
    COUNT(*)                   AS samples,
    MAX(speed)                 AS max_speed,
    AVG(speed)                 AS avg_speed,
    MAX(odometer_km) - MIN(odometer_km) AS distance_km,
    MAX(engine_hours) - MIN(engine_hours) AS engine_hours
FROM positions
GROUP BY device_id, company_id, day
WITH NO DATA;

SELECT add_continuous_aggregate_policy('positions_daily',
    start_offset      => INTERVAL '14 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists     => TRUE);
