UPDATE reports r
SET
  /* --- FLUOROSCOPY TIME --- */
  fluoroscopy_time_raw = REGEXP_SUBSTR(
    SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
    '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
  ),

  fluoroscopy_time_unit = LOWER(
    TRIM(
      REGEXP_REPLACE(
        REGEXP_SUBSTR(
          SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
          '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
        ),
        '^[0-9]+(?:\\.[0-9]+)?[[:space:]]*',
        ''
      )
    )
  ),

  fluoroscopy_time_minutes = CASE
    WHEN LOWER(TRIM(
           REGEXP_REPLACE(
             REGEXP_SUBSTR(
               SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
               '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
             ),
             '^[0-9]+(?:\\.[0-9]+)?[[:space:]]*',
             ''
           )
         )) IN ('minute','minutes','min','mins') THEN
      CAST(
        TRIM(
          REGEXP_SUBSTR(
            SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
            '[0-9]+(?:\\.[0-9]+)?'
          )
        ) AS DECIMAL(12,3)
      )
    WHEN LOWER(TRIM(
           REGEXP_REPLACE(
             REGEXP_SUBSTR(
               SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
               '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
             ),
             '^[0-9]+(?:\\.[0-9]+)?[[:space:]]*',
             ''
           )
         )) IN ('second','seconds','sec','secs','s') THEN
      CAST(
        TRIM(
          REGEXP_SUBSTR(
            SUBSTRING(r.ContentText, LOCATE('Fluoroscopy time', r.ContentText), 50),
            '[0-9]+(?:\\.[0-9]+)?'
          )
        ) AS DECIMAL(12,3)
      ) / 60
    ELSE NULL
  END,

  /* --- FLUOROSCOPY DOSE --- */
  fluoroscopy_dose_raw = CASE
    WHEN LOCATE('Fluoroscopy dose', r.ContentText) > 0 THEN
      REGEXP_SUBSTR(
        SUBSTRING(r.ContentText, LOCATE('Fluoroscopy dose', r.ContentText), 50),
        '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
      )
    WHEN LOCATE('Reference air kerma', r.ContentText) > 0 THEN
      REGEXP_SUBSTR(
        SUBSTRING(r.ContentText, LOCATE('Reference air kerma', r.ContentText), 50),
        '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
      )
    ELSE NULL
  END,

  fluoroscopy_dose_value = CASE
    WHEN LOCATE('Fluoroscopy dose', r.ContentText) > 0 OR LOCATE('Reference air kerma', r.ContentText) > 0 THEN
      CAST(
        TRIM(
          REGEXP_SUBSTR(
            SUBSTRING(
              r.ContentText,
              GREATEST(
                IFNULL(NULLIF(LOCATE('Fluoroscopy dose', r.ContentText), 0), 0),
                IFNULL(NULLIF(LOCATE('Reference air kerma', r.ContentText), 0), 0)
              ),
              50
            ),
            '[0-9]+(?:\\.[0-9]+)?'
          )
        ) AS DECIMAL(12,3)
      )
    ELSE NULL
  END,

  fluoroscopy_dose_unit = CASE
    WHEN LOCATE('Fluoroscopy dose', r.ContentText) > 0 OR LOCATE('Reference air kerma', r.ContentText) > 0 THEN
      LOWER(
        TRIM(
          REGEXP_REPLACE(
            REGEXP_SUBSTR(
              SUBSTRING(
                r.ContentText,
                GREATEST(
                  IFNULL(NULLIF(LOCATE('Fluoroscopy dose', r.ContentText), 0), 0),
                  IFNULL(NULLIF(LOCATE('Reference air kerma', r.ContentText), 0), 0)
                ),
                50
              ),
              '[0-9]+(?:\\.[0-9]+)?[[:space:]]*[A-Za-zμ%]+'
            ),
            '^[0-9]+(?:\\.[0-9]+)?[[:space:]]*',
            ''
          )
        )
      )
    ELSE NULL
  END

WHERE r.ContentText REGEXP 'Fluoroscopy time'
   OR r.ContentText REGEXP 'Fluoroscopy dose'
   OR r.ContentText REGEXP 'Reference air kerma';

UPDATE reports r
SET
  /* --- CT DLP / mGy dose --- */
  fluoroscopy_dose_raw = 
    CASE
      WHEN r.ContentText REGEXP 'DLP' THEN
        COALESCE(
          -- Pattern 1: "DLP dose: 123.45 mGy"
          REGEXP_SUBSTR(
            r.ContentText,
            'DLP[[:space:]]*(dose)?[: ]+[0-9]+(\.[0-9]+)?[[:space:]]*mGy(-cm)?',
            1, 1, 'i'
          ),
          -- Pattern 2: "DLP for this examination was 123.45 mGy-cm"
          REGEXP_SUBSTR(
            r.ContentText,
            'DLP[[:space:]]+[a-z ]*[[:space:]]+[0-9]+(\.[0-9]+)?[[:space:]]*mGy(-cm)?',
            1, 1, 'i'
          )
        )
      ELSE fluoroscopy_dose_raw
    END,

  fluoroscopy_dose_value = 
    CASE
      WHEN r.ContentText REGEXP 'DLP' THEN
        CAST(
          TRIM(
            COALESCE(
              -- Pattern 1: Extract after "DLP dose:"
              REGEXP_REPLACE(
                REGEXP_SUBSTR(
                  r.ContentText,
                  'DLP[[:space:]]*(dose)?[: ]+[0-9]+(\.[0-9]+)?',
                  1, 1, 'i'
                ),
                'DLP[[:space:]]*(dose)?[: ]+',
                ''
              ),
              -- Pattern 2: Extract the number after "was"
              REGEXP_SUBSTR(
                r.ContentText,
                '[0-9]+\.[0-9]+|[0-9]+',
                LOCATE('DLP', r.ContentText)
              )
            )
          ) AS DECIMAL(12,4)
        )
      ELSE fluoroscopy_dose_value
    END,

  fluoroscopy_dose_unit = 
    CASE
      WHEN r.ContentText REGEXP 'DLP' THEN
        'mgy-cm'
      ELSE fluoroscopy_dose_unit
    END

WHERE r.ContentText REGEXP 'DLP';