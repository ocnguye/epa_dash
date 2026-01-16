-- 002_populate_report_participants.sql
-- Populate report_participants by splitting semicolon-separated lists in reports.attending and reports.trainee.
-- Uses JSON_TABLE (MySQL 8+). It will insert only tokens that are numeric and present in users.
-- Unmatched tokens (non-numeric or missing users) are recorded in report_participants_unmatched.

-- Insert trainees matched to users
INSERT IGNORE INTO report_participants
  (report_id, user_id, role, source_text)
SELECT
  r.ReportID,
  u.user_id,
  'trainee',
  r.trainee
FROM reports r
JOIN JSON_TABLE(
  CONCAT(
    '["',
    REPLACE(
      REPLACE(COALESCE(r.trainee, ''), '"', ''),
      ';',
      '","'
    ),
    '"]'
  ),
  '$[*]' COLUMNS (token VARCHAR(255) PATH '$')
) j
  ON TRIM(j.token) <> ''
JOIN users u
  ON u.user_id = CAST(j.token AS UNSIGNED)  -- OR name match
;

-- Insert attendings matched to users
INSERT IGNORE INTO report_participants
  (report_id, user_id, role, source_text)
SELECT
  r.ReportID,
  u.user_id,
  'attending',
  r.attending
FROM reports r
JOIN JSON_TABLE(
  CONCAT(
    '["',
    REPLACE(
      REPLACE(COALESCE(r.attending, ''), '"', ''),
      ';',
      '","'
    ),
    '"]'
  ),
  '$[*]' COLUMNS (token VARCHAR(255) PATH '$')
) j
  ON TRIM(j.token) <> ''
JOIN users u
  ON u.user_id = CAST(j.token AS UNSIGNED)  -- OR name match
;
