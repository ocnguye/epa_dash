-- 001_create_report_participants.sql
-- Create normalized report_participants table and an unmatched tokens table.
-- Run this first (dev/staging) to prepare for backfill.

CREATE TABLE IF NOT EXISTS report_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id VARCHAR(255) NOT NULL,
  user_id INT NULL,
  role ENUM('trainee','attending') NOT NULL,
  source_text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_report_user_role (report_id, user_id, role),
  INDEX idx_report (report_id),
  INDEX idx_user (user_id),
  CONSTRAINT fk_rp_report FOREIGN KEY (report_id) REFERENCES reports(ReportID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
