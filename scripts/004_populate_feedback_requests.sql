-- 004_populate_feedback_requests.sql
-- Populate feedback_requests for all trainee × attending combinations per report using report_participants.
-- This will create one triad row per trainee-attending pair per report with default status 'not_required'.

INSERT IGNORE INTO feedback_requests (report_id, trainee_user_id, attending_user_id, status)
SELECT
  rp_t.report_id,
  rp_t.user_id AS trainee_user_id,
  rp_a.user_id AS attending_user_id,
  'not_required' AS status
FROM report_participants rp_t
JOIN report_participants rp_a ON rp_t.report_id = rp_a.report_id
WHERE rp_t.role = 'trainee' AND rp_a.role = 'attending'
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  updated_at = NOW();

-- If you'd rather initialize triads only for certain reports or only primary participants, modify the WHERE clause accordingly.
