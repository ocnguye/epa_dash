-- Extract RPR number from FinalReport text into two columns:
--  - rpr_number_raw  : the raw matching token (e.g. 'RPR# 12345' or 'RPR No. 12345')
--  - rpr_number_value: numeric-only cleaned value (e.g. 12345)
--
-- This follows the style of scripts/007_parse_fluoroscopy_metrics.sql:
--  - uses REGEXP_SUBSTR to grab the raw token (case-insensitive)
--  - uses REGEXP_REPLACE to strip non-digits and CAST to numeric
--  - only updates rows where FinalReport contains an RPR-like token

UPDATE rpr_reports r
SET
  /* rpr_number_raw: either a short code like 'RPR4' or a longer numeric token like 'RPR # 12345' */
  rpr_number_raw = COALESCE(
    -- prefer short explicit code if present
    REGEXP_SUBSTR(r.FinalReport, 'RPR[1-4]\\b', 1, 1, 'i'),
    -- fallback: find 'RPR' followed by optional tokens then digits
    REGEXP_SUBSTR(
      SUBSTRING(r.FinalReport, LOCATE('RPR', r.FinalReport), 150),
      'RPR[[:space:]]*(#|No\\.?|Number|Num)?[[:space:]]*[:#-]?[[:space:]]*[0-9]++',
      1, 1, 'i'
    ),
    -- last resort: any 'RPR#123' style anywhere in the text
    REGEXP_SUBSTR(r.FinalReport, 'RPR#?[[:space:]]*[0-9]+', 1, 1, 'i')
  ),

  /* rpr_number_value: cleaned numeric value extracted from the matched token */
  rpr_number_value = CASE
    WHEN COALESCE(
      REGEXP_SUBSTR(
        SUBSTRING(r.FinalReport, LOCATE('RPR', r.FinalReport), 150),
        '[0-9]+'
      ),
      REGEXP_SUBSTR(r.FinalReport, '[0-9]+', 1, 1)
    ) IS NOT NULL THEN
      CAST(
        REGEXP_REPLACE(
          COALESCE(
            REGEXP_SUBSTR(
              SUBSTRING(r.FinalReport, LOCATE('RPR', r.FinalReport), 150),
              '[0-9]+'
            ),
            REGEXP_SUBSTR(r.FinalReport, '[0-9]+', 1, 1)
          ),
          '[^0-9]',
          ''
        ) AS UNSIGNED
      )
    ELSE NULL
  END

WHERE r.FinalReport REGEXP 'RPR([1-4]\\b|#| No| Number|No\\.|RPR#)';

-- Notes / next steps:
-- - Ensure the `rpr_number_raw` (VARCHAR/TEXT) and `rpr_number_value` (INT/UNSIGNED)
--   columns exist on `rpr_reports` before running this script. If they don't exist, add them first, e.g.:
--     ALTER TABLE rpr_reports
--       ADD COLUMN rpr_number_raw VARCHAR(255) NULL,
--       ADD COLUMN rpr_number_value INT UNSIGNED NULL;
-- - This script is intentionally conservative: it extracts the first plausible numeric token near
--   the first occurrence of 'RPR' or an explicit short code (RPR1..RPR4). If your data uses
--   different labels, multiple occurrences per report, or codes outside 1-4, we can refine
--   the patterns (e.g., allow RPR[0-9]+ or capture multiple occurrences per row).
