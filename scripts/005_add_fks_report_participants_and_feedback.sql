-- 005_add_fks_report_participants_and_feedback.sql
-- Adds foreign keys from report_participants.user_id to users.user_id and
-- from feedback_requests trainee/attending user ids to users.user_id.
-- Run this AFTER you have reconciled tokens listed in report_participants_unmatched
-- and confirmed that all user_id values exist in users.

-- Safety checks (run these and inspect results before applying ALTER statements):
-- Find report_participants rows with NULL or missing users
SELECT COUNT(*) AS missing_users_in_participants
FROM report_participants rp
LEFT JOIN users u ON rp.user_id = u.user_id
WHERE rp.user_id IS NULL OR u.user_id IS NULL;

SELECT COUNT(*) AS missing_users_in_feedback
FROM feedback_requests fr
LEFT JOIN users u1 ON fr.trainee_user_id = u1.user_id
LEFT JOIN users u2 ON fr.attending_user_id = u2.user_id
WHERE u1.user_id IS NULL OR u2.user_id IS NULL;

-- If the above counts are zero, you can safely add the FK constraints below.
-- Add indexes if not present then add FKs.
ALTER TABLE report_participants
  ADD INDEX IF NOT EXISTS idx_rp_user_id (user_id);

ALTER TABLE report_participants
  ADD CONSTRAINT fk_rp_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

ALTER TABLE feedback_requests
  ADD INDEX IF NOT EXISTS idx_fr_trainee_uid (trainee_user_id),
  ADD INDEX IF NOT EXISTS idx_fr_attending_uid (attending_user_id);

ALTER TABLE feedback_requests
  ADD CONSTRAINT fk_fr_trainee_user FOREIGN KEY (trainee_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_fr_attending_user FOREIGN KEY (attending_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- After adding FKs, run a quick integrity check by attempting joins and by sampling rows.
