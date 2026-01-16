-- trainee
UPDATE reports r
JOIN (
    SELECT
        r2.ReportID,
        GROUP_CONCAT(u.user_id ORDER BY u.user_id SEPARATOR ';') AS mapped_ids
    FROM reports r2
    JOIN JSON_TABLE(
        CONCAT(
            '["',
            REPLACE(REPLACE(COALESCE(r2.trainee, ''), '"', ''), ';', '","'),
            '"]'
        ),
        '$[*]' COLUMNS (name_token VARCHAR(255) PATH '$')
    ) j
    JOIN users u
        ON LOWER(TRIM(j.name_token)) = LOWER(CONCAT(TRIM(u.first_name), ' ', TRIM(u.last_name)))
    WHERE TRIM(j.name_token) <> ''
    GROUP BY r2.ReportID
) m
    ON r.ReportID = m.ReportID
SET r.trainee = m.mapped_ids;

-- attending
UPDATE reports r
JOIN (
    SELECT
        r2.ReportID,
        GROUP_CONCAT(u.user_id ORDER BY u.user_id SEPARATOR ';') AS mapped_ids
    FROM reports r2
    JOIN JSON_TABLE(
        CONCAT(
            '["',
            REPLACE(REPLACE(COALESCE(r2.attending, ''), '"', ''), ';', '","'),
            '"]'
        ),
        '$[*]' COLUMNS (name_token VARCHAR(255) PATH '$')
    ) j
    JOIN users u
        ON LOWER(TRIM(j.name_token)) = LOWER(CONCAT(TRIM(u.first_name), ' ', TRIM(u.last_name)))
    WHERE TRIM(j.name_token) <> ''
    GROUP BY r2.ReportID
) m
    ON r.ReportID = m.ReportID
SET r.attending = m.mapped_ids;
