-- Migration 006: Add `complexity` column to reports and populate with dummy values (1-5)
-- NOTE: Some MySQL/MariaDB versions do not support `ADD COLUMN IF NOT EXISTS`.
-- This file intentionally contains the simple ALTER/UPDATE statements without IF NOT EXISTS.
-- Run the "check" command below first; if it reports 0, run this file.

-- 1) Check whether the column already exists:
-- mysql -h <host> -u <user> -p -e "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema='powerscribe' AND table_name='reports' AND column_name='complexity';"

-- If the result is 0, run this file (or run the ALTER/UPDATE commands below manually).

ALTER TABLE reports
    ADD COLUMN complexity TINYINT UNSIGNED NOT NULL DEFAULT 3;

-- Populate existing rows with a random int between 1 and 5.
-- We update rows that currently have the default value (3) to avoid touching rows created after the migration
-- (which will already have the default). Adjust the WHERE clause if you want to force-update all rows.

UPDATE reports
SET complexity = FLOOR(1 + RAND() * 5)
WHERE complexity = 3;

-- Verify: SELECT COUNT(*) FROM reports WHERE complexity NOT BETWEEN 1 AND 5;
