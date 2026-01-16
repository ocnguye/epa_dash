INSERT INTO epa_scores (report_participant_id, epa_score, created_at)
SELECT
    rp.id AS report_participant_id,
    r.epa AS epa_score,
    NOW() AS created_at
FROM report_participants rp
JOIN reports r
    ON rp.report_id = r.ReportID
WHERE r.epa IS NOT NULL
  AND r.epa BETWEEN 1 AND 5;  -- adjust to match your CHECK constraint
