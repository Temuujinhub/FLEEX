-- Fleex database bootstrap. Runs once on first container start.
-- Schema/migrations beyond this file are managed by Prisma in the API service.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
