-- ============================================
-- 1️⃣ Reset trainee_id and attending_id before matching
-- ============================================
UPDATE rpr_reports
SET trainee_id = NULL,
    attending_id = NULL;

-- ============================================
-- 2️⃣ Update trainee_id based on FIRST_RESIDENT with collation fix
-- ============================================
UPDATE rpr_reports r
JOIN users u
  ON TRIM(SUBSTRING_INDEX(r.FIRST_RESIDENT, ',', -1)) COLLATE utf8mb4_0900_ai_ci = u.first_name COLLATE utf8mb4_0900_ai_ci
 AND TRIM(SUBSTRING_INDEX(r.FIRST_RESIDENT, ',', 1)) COLLATE utf8mb4_0900_ai_ci = u.last_name COLLATE utf8mb4_0900_ai_ci
SET r.trainee_id = u.user_id;

-- ============================================
-- 3️⃣ Update attending_id based on SIGNING_MD with collation fix
-- ============================================
UPDATE rpr_reports r
JOIN users u
  ON TRIM(SUBSTRING_INDEX(r.SIGNING_MD, ',', -1)) COLLATE utf8mb4_0900_ai_ci = u.first_name COLLATE utf8mb4_0900_ai_ci
 AND TRIM(SUBSTRING_INDEX(r.SIGNING_MD, ',', 1)) COLLATE utf8mb4_0900_ai_ci = u.last_name COLLATE utf8mb4_0900_ai_ci
SET r.attending_id = u.user_id;

-- ============================================
-- 4️⃣ Optional: Verify matches
-- ============================================
SELECT r.FIRST_RESIDENT, r.trainee_id, r.SIGNING_MD, r.attending_id,
       u.first_name, u.last_name
FROM rpr_reports r
LEFT JOIN users u
  ON (TRIM(SUBSTRING_INDEX(r.FIRST_RESIDENT, ',', -1)) COLLATE utf8mb4_0900_ai_ci = u.first_name COLLATE utf8mb4_0900_ai_ci
  AND TRIM(SUBSTRING_INDEX(r.FIRST_RESIDENT, ',', 1)) COLLATE utf8mb4_0900_ai_ci = u.last_name COLLATE utf8mb4_0900_ai_ci)
  OR
     (TRIM(SUBSTRING_INDEX(r.SIGNING_MD, ',', -1)) COLLATE utf8mb4_0900_ai_ci = u.first_name COLLATE utf8mb4_0900_ai_ci
  AND TRIM(SUBSTRING_INDEX(r.SIGNING_MD, ',', 1)) COLLATE utf8mb4_0900_ai_ci = u.last_name COLLATE utf8mb4_0900_ai_ci)
WHERE r.trainee_id IS NOT NULL OR r.attending_id IS NOT NULL;
