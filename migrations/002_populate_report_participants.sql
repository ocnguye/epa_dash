-- 002_populate_report_participants.sql
-- Populate report_participants by splitting semicolon-separated lists in reports.attending and reports.trainee.
-- Uses JSON_TABLE (MySQL 8+). It will insert only tokens that are numeric and present in users.
-- Unmatched tokens (non-numeric or missing users) are recorded in report_participants_unmatched.

-- Insert trainees matched to users
INSERT IGNORE INTO report_participants (report_id, user_id, role, source_text)
SELECT
  r.ReportID,
  CAST(j.token AS UNSIGNED) AS user_id,
  'trainee' AS role,
  r.trainee AS source_text
FROM reports r
JOIN JSON_TABLE(
  CONCAT('[', REPLACE(REPLACE(COALESCE(r.trainee, ''), ';', ','), ' ', ''), ']'),
  '$[*]' COLUMNS (token VARCHAR(255) PATH '$')
) AS j
  ON TRIM(COALESCE(r.trainee, '')) <> ''
JOIN users u ON u.user_id = CAST(j.token AS UNSIGNED);

-- Insert attendings matched to users
INSERT IGNORE INTO report_participants (report_id, user_id, role, source_text)
SELECT
  r.ReportID,
  CAST(j.token AS UNSIGNED) AS user_id,
  'attending' AS role,
  r.attending AS source_text
FROM reports r
JOIN JSON_TABLE(
  CONCAT('[', REPLACE(REPLACE(COALESCE(r.attending, ''), ';', ','), ' ', ''), ']'),
  '$[*]' COLUMNS (token VARCHAR(255) PATH '$')
) AS j
  ON TRIM(COALESCE(r.attending, '')) <> ''
JOIN users u ON u.user_id = CAST(j.token AS UNSIGNED);