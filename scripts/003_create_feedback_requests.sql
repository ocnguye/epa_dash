-- 003_create_feedback_requests.sql
-- Create feedback_requests table to store per-(report, trainee, attending) feedback status.

CREATE TABLE IF NOT EXISTS feedback_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id VARCHAR(255) NOT NULL,
  trainee_user_id INT NOT NULL,
  attending_user_id INT NOT NULL,
  status ENUM('not_required','feedback_requested','discussed') NOT NULL DEFAULT 'not_required',
  requested_by INT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_report_trainee_attending (report_id, trainee_user_id, attending_user_id),
  INDEX idx_fr_report (report_id),
  INDEX idx_fr_trainee (trainee_user_id),
  INDEX idx_fr_attending (attending_user_id),
  CONSTRAINT fk_fr_report FOREIGN KEY (report_id) REFERENCES reports(ReportID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Note: we omit FKs to users here so you can populate report_participants and reconcile users first.
-- Once users are reconciled, you can add FKs to trainee_user_id and attending_user_id in a follow-up migration.
