-- proc_concepts_seed.sql
-- Target: the `powerscribe` MySQL database (same RDS instance the app uses).
-- Run in ONE session so the temporary table survives, e.g.:
--     mysql -h $AWS_RDS_HOST -u $AWS_RDS_USER -p powerscribe < proc_concepts_seed.sql
-- Safe to re-run: terms use INSERT IGNORE, attachments keep the highest strength.
--
-- Review note: the STRENGTH values below are clinical judgment calls
-- (1.0 = core match, 0.3-0.5 = adjacent). Have an IR attending skim section 4.

-- ───────────────────────────── 1. Tables ─────────────────────────────

CREATE TABLE IF NOT EXISTS proc_concepts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  concept_key    VARCHAR(60)  NOT NULL,            -- e.g. 'clot-removal'
  term           VARCHAR(100) NOT NULL,            -- single lowercase token or word stem
  match_mode     ENUM('exact','prefix') NOT NULL DEFAULT 'exact',
  source         ENUM('manual','radlex','learned') NOT NULL DEFAULT 'manual',
  source_ref     VARCHAR(40)  NULL,                -- RadLex RID when source = 'radlex'
  source_version VARCHAR(20)  NULL,
  UNIQUE KEY uq_term_concept (term, concept_key),
  KEY idx_concept (concept_key)
);

CREATE TABLE IF NOT EXISTS proc_type_concepts (
  proc_type_id INT         NOT NULL,
  concept_key  VARCHAR(60) NOT NULL,
  strength     DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  source       ENUM('auto','manual','learned') NOT NULL DEFAULT 'manual',
  PRIMARY KEY (proc_type_id, concept_key),
  KEY idx_concept (concept_key)
);

-- ───────────────────── 2. Terms: exact-match words ─────────────────────
-- Tokens must be 3+ characters (the lookup drops shorter ones), lowercase.

INSERT IGNORE INTO proc_concepts (concept_key, term) VALUES
('clot-removal','declot'),('clot-removal','declotting'),('clot-removal','clot'),('clot-removal','clots'),
('clot-removal','embolectomy'),('clot-removal','lysis'),('clot-removal','fibrinolysis'),
('clot-removal','tpa'),('clot-removal','alteplase'),('clot-removal','dvt'),('clot-removal','embolism'),
('clot-removal','occlusion'),('clot-removal','occluded'),('clot-removal','recanalisation'),

('embolization','embolization'),('embolization','embolisation'),('embolization','embolize'),
('embolization','embolotherapy'),('embolization','embo'),('embolization','coil'),
('embolization','coils'),('embolization','coiling'),('embolization','plug'),

('hemorrhage','bleed'),('hemorrhage','bleeding'),('hemorrhage','bled'),('hemorrhage','hemorrhage'),
('hemorrhage','haemorrhage'),('hemorrhage','hemorrhagic'),('hemorrhage','gib'),
('hemorrhage','hemoptysis'),('hemorrhage','hematuria'),('hemorrhage','epistaxis'),

('aneurysm','aneurysm'),('aneurysm','aneurysms'),('aneurysm','pseudoaneurysm'),('aneurysm','endoleak'),
('aneurysm','evar'),('aneurysm','tevar'),('aneurysm','aaa'),('aneurysm','thrombin'),

('diagnostic-angiography','angiogram'),('diagnostic-angiography','angiograms'),
('diagnostic-angiography','angiography'),('diagnostic-angiography','angio'),
('diagnostic-angiography','arteriogram'),('diagnostic-angiography','arteriography'),
('diagnostic-angiography','aortogram'),('diagnostic-angiography','runoff'),

('venography','venogram'),('venography','venograms'),('venography','venography'),
('venography','phlebogram'),('venography','phlebography'),

('dialysis-access','dialysis'),('dialysis-access','hemodialysis'),('dialysis-access','fistula'),
('dialysis-access','fistulogram'),('dialysis-access','fistulagram'),('dialysis-access','fistuloplasty'),
('dialysis-access','graft'),('dialysis-access','avf'),('dialysis-access','avg'),
('dialysis-access','permcath'),('dialysis-access','tesio'),('dialysis-access','declot'),

('venous-access-line','picc'),('venous-access-line','cvc'),('venous-access-line','port'),
('venous-access-line','portacath'),('venous-access-line','hickman'),('venous-access-line','broviac'),
('venous-access-line','midline'),('venous-access-line','line'),('venous-access-line','lines'),
('venous-access-line','central'),('venous-access-line','permcath'),

('catheter-exchange','exchange'),('catheter-exchange','exchanged'),('catheter-exchange','swap'),
('catheter-exchange','replace'),('catheter-exchange','replacement'),('catheter-exchange','upsize'),
('catheter-exchange','convert'),('catheter-exchange','conversion'),

('removal','remove'),('removal','removal'),('removal','removed'),('removal','explant'),('removal','pull'),

('foreign-body','foreign'),('foreign-body','fragment'),('foreign-body','fragments'),
('foreign-body','snare'),('foreign-body','retrieval'),('foreign-body','retrieve'),
('foreign-body','retained'),

('tube-check','check'),('tube-check','recheck'),('tube-check','tubogram'),('tube-check','sinogram'),

('enteric-tubes','gastrostomy'),('enteric-tubes','jejunostomy'),('enteric-tubes','gastrojejunostomy'),
('enteric-tubes','cecostomy'),('enteric-tubes','feeding'),('enteric-tubes','peg'),
('enteric-tubes','enteral'),('enteric-tubes','enteric'),('enteric-tubes','nasoenteric'),
('enteric-tubes','dobhoff'),('enteric-tubes','gtube'),('enteric-tubes','jtube'),

('gu-urinary','nephrostomy'),('gu-urinary','nephrostogram'),('gu-urinary','nephroureterostomy'),
('gu-urinary','ureter'),('gu-urinary','ureteral'),('gu-urinary','ureterostomy'),
('gu-urinary','urinary'),('gu-urinary','kidney'),('gu-urinary','renal'),
('gu-urinary','hydronephrosis'),('gu-urinary','suprapubic'),('gu-urinary','bladder'),
('gu-urinary','foley'),('gu-urinary','pyelogram'),

('biliary','biliary'),('biliary','bile'),('biliary','cholangiogram'),('biliary','cholangiography'),
('biliary','ptc'),('biliary','pbd'),('biliary','cholecystostomy'),('biliary','gallbladder'),
('biliary','cholecystitis'),('biliary','jaundice'),

('portal-hypertension','tipss'),('portal-hypertension','tips'),('portal-hypertension','brto'),
('portal-hypertension','varices'),('portal-hypertension','varix'),('portal-hypertension','portal'),
('portal-hypertension','hypertension'),('portal-hypertension','encephalopathy'),
('portal-hypertension','shunt'),

('fluid-drainage','ascites'),('fluid-drainage','effusion'),('fluid-drainage','fluid'),
('fluid-drainage','aspirate'),('fluid-drainage','aspiration'),('fluid-drainage','paracentesis'),
('fluid-drainage','thoracentesis'),('fluid-drainage','pleural'),('fluid-drainage','peritoneal'),
('fluid-drainage','pneumothorax'),('fluid-drainage','empyema'),('fluid-drainage','pleurx'),
('fluid-drainage','tap'),

('abscess-drain','abscess'),('abscess-drain','drain'),('abscess-drain','drains'),
('abscess-drain','drainage'),('abscess-drain','collection'),('abscess-drain','hematoma'),
('abscess-drain','seroma'),('abscess-drain','lymphocele'),('abscess-drain','pigtail'),

('lymphatic','lymph'),('lymphatic','lymphatic'),('lymphatic','lymphatics'),
('lymphatic','lymphangiogram'),('lymphatic','chylothorax'),('lymphatic','chyle'),
('lymphatic','chylous'),('lymphatic','lymphocele'),('lymphatic','lymphedema'),

('vascular-malformation','avm'),('vascular-malformation','malformation'),
('vascular-malformation','malformations'),('vascular-malformation','hemangioma'),
('vascular-malformation','anomaly'),('vascular-malformation','vascular'),

('sclerotherapy','sclerotherapy'),('sclerotherapy','sclerosant'),('sclerotherapy','ethanol'),
('sclerotherapy','cyst'),('sclerotherapy','seroma'),

('biopsy','biopsy'),('biopsy','biopsies'),('biopsy','bx'),('biopsy','core'),('biopsy','fna'),
('biopsy','mass'),('biopsy','lesion'),('biopsy','nodule'),

('tumor-therapy','ablation'),('tumor-therapy','ablate'),('tumor-therapy','ablative'),
('tumor-therapy','cryoablation'),('tumor-therapy','cryo'),('tumor-therapy','microwave'),
('tumor-therapy','mwa'),('tumor-therapy','rfa'),('tumor-therapy','radiofrequency'),
('tumor-therapy','tumor'),('tumor-therapy','tumour'),('tumor-therapy','cancer'),
('tumor-therapy','oncology'),('tumor-therapy','metastasis'),('tumor-therapy','metastases'),
('tumor-therapy','hcc'),

('liver-directed','y90'),('liver-directed','sirt'),('liver-directed','tace'),
('liver-directed','therasphere'),('liver-directed','theraspheres'),('liver-directed','sirsphere'),
('liver-directed','sirspheres'),('liver-directed','radioembolization'),
('liver-directed','chemoembolization'),('liver-directed','bland'),('liver-directed','shunt'),
('liver-directed','mapping'),

('nerve-block','nerve'),('nerve-block','nerves'),('nerve-block','block'),('nerve-block','blocks'),
('nerve-block','neurolysis'),('nerve-block','cryoneurolysis'),('nerve-block','denervation'),
('nerve-block','genicular'),('nerve-block','pudendal'),('nerve-block','sciatic'),
('nerve-block','celiac'),('nerve-block','splanchnic'),('nerve-block','intercostal'),
('nerve-block','trigeminal'),('nerve-block','plexus'),('nerve-block','pain'),
('nerve-block','cryo'),('nerve-block','rfa'),

('spine-injection','epidural'),('spine-injection','esi'),('spine-injection','spine'),
('spine-injection','spinal'),('spine-injection','lumbar'),('spine-injection','puncture'),
('spine-injection','intrathecal'),('spine-injection','pump'),('spine-injection','myelogram'),
('spine-injection','steroid'),

('joint-injection','joint'),('joint-injection','joints'),('joint-injection','arthrocentesis'),
('joint-injection','arthrogram'),('joint-injection','aspiration'),('joint-injection','injection'),
('joint-injection','hip'),('joint-injection','knee'),('joint-injection','shoulder'),
('joint-injection','wrist'),('joint-injection','elbow'),('joint-injection','finger'),
('joint-injection','hand'),('joint-injection','msk'),

('vertebral-augmentation','vertebroplasty'),('vertebral-augmentation','kyphoplasty'),
('vertebral-augmentation','sacroplasty'),('vertebral-augmentation','cementoplasty'),
('vertebral-augmentation','augmentation'),('vertebral-augmentation','cement'),
('vertebral-augmentation','vertebral'),('vertebral-augmentation','compression'),
('vertebral-augmentation','fracture'),('vertebral-augmentation','osteoplasty'),

('vena-cava-filter','ivc'),('vena-cava-filter','filter'),('vena-cava-filter','cava'),
('vena-cava-filter','vena'),('vena-cava-filter','caval'),

('pelvic-gyn-gu','fibroid'),('pelvic-gyn-gu','fibroids'),('pelvic-gyn-gu','uae'),
('pelvic-gyn-gu','ufe'),('pelvic-gyn-gu','pae'),('pelvic-gyn-gu','bph'),
('pelvic-gyn-gu','prostate'),('pelvic-gyn-gu','uterine'),('pelvic-gyn-gu','pelvic'),
('pelvic-gyn-gu','congestion'),('pelvic-gyn-gu','pots'),('pelvic-gyn-gu','varicocele'),
('pelvic-gyn-gu','fallopian'),('pelvic-gyn-gu','tubal'),('pelvic-gyn-gu','ovarian'),

('venous-sampling','avs'),('venous-sampling','sampling'),('venous-sampling','aldosteronism'),
('venous-sampling','aldosterone'),('venous-sampling','adrenal'),('venous-sampling','cushing'),

('angioplasty-stenting','angioplasty'),('angioplasty-stenting','stenosis'),
('angioplasty-stenting','stent'),('angioplasty-stenting','stenting'),
('angioplasty-stenting','balloon'),('angioplasty-stenting','pta'),
('angioplasty-stenting','revascularization'),('angioplasty-stenting','claudication'),
('angioplasty-stenting','ischemia'),('angioplasty-stenting','ischemic'),
('angioplasty-stenting','pad'),('angioplasty-stenting','limb');

-- ───────────── 2b. Terms: prefix roots (word-part matching) ─────────────
-- A query word that STARTS WITH one of these matches the concept:
-- 'thromb' catches thrombectomy / thrombolysis / thrombosis / thrombotic / thrombin.

INSERT IGNORE INTO proc_concepts (concept_key, term, match_mode) VALUES
('clot-removal','thromb','prefix'),
('clot-removal','recanaliz','prefix'),
('gu-urinary','nephr','prefix'),
('biliary','cholang','prefix'),
('biliary','cholecyst','prefix');

-- ──────────────── 3. Staging table for attachments ────────────────
-- Each row: attach every proc_type whose proc_desc matches desc_like
-- (SQL LIKE, so exact descriptions work too) AND whose category matches.
-- At least one of desc_like / cat_eq / core_like must be non-NULL.

DROP TEMPORARY TABLE IF EXISTS tmp_attach;
CREATE TEMPORARY TABLE tmp_attach (
  concept_key VARCHAR(60)   NOT NULL,
  str_val     DECIMAL(3,2)  NOT NULL,
  desc_like   VARCHAR(255)  NULL,
  cat_eq      VARCHAR(100)  NULL,
  core_like   VARCHAR(100)  NULL
);

-- ───────────────── 4. Attachments (review these) ─────────────────

INSERT INTO tmp_attach (concept_key, str_val, desc_like, cat_eq, core_like) VALUES
-- clot removal / thrombectomy / thrombolysis / declot
('clot-removal',1.00,'%LYSIS%',NULL,NULL),
('clot-removal',0.80,'%RECANALIZATION%',NULL,NULL),
('clot-removal',0.50,'IR AV GRAFT',NULL,NULL),
('clot-removal',0.50,'IR AV FISTULOGRAM',NULL,NULL),
('clot-removal',0.40,'IR PULMONARY ARTERY ANGIOGRAM',NULL,NULL),
('clot-removal',0.30,'IR VASCULAR FOREIGN BODY REMOVAL',NULL,NULL),

-- embolization
('embolization',1.00,'%EMBOLIZATION%',NULL,NULL),
('embolization',0.60,'%BRTO%',NULL,NULL),
('embolization',0.50,'IR PERCUTANEOUS PSEUDOANEURYSM INTERVENTION',NULL,NULL),
('embolization',0.40,'IR GASTROINTESTINAL HEMORRHAGE ANGIOGRAM',NULL,NULL),
('embolization',0.40,'IR AORTIC ANEURYSM ENDOLEAK',NULL,NULL),

-- bleeding
('hemorrhage',1.00,'IR GASTROINTESTINAL HEMORRHAGE ANGIOGRAM',NULL,NULL),
('hemorrhage',0.80,'IR BRONCHIAL ARTERY ANGIOGRAM',NULL,NULL),
('hemorrhage',0.60,'IR PERCUTANEOUS PSEUDOANEURYSM INTERVENTION',NULL,NULL),
('hemorrhage',0.50,'IR INFERIOR EPIGASTRIC ANGIOGRAM',NULL,NULL),
('hemorrhage',0.40,'%EMBOLIZATION%',NULL,NULL),
('hemorrhage',0.30,'IR VISCERAL ARTERY ANGIOGRAM',NULL,NULL),

-- aneurysm
('aneurysm',1.00,'IR AORTIC ANEURYSM ENDOLEAK',NULL,NULL),
('aneurysm',1.00,'IR PERCUTANEOUS PSEUDOANEURYSM INTERVENTION',NULL,NULL),
('aneurysm',0.40,'IR AORTIC ANGIOGRAM',NULL,NULL),

-- diagnostic angiography (leading space keeps LYMPHANGIOGRAM out)
('diagnostic-angiography',1.00,'% ANGIOGRAM%',NULL,NULL),
('diagnostic-angiography',0.80,'CT ANGIO%',NULL,NULL),

-- venography
('venography',1.00,'%VENOGRAM%',NULL,NULL),
('venography',1.00,'%VENOGRAPHY%',NULL,NULL),
('venography',0.50,'IR AV FISTULOGRAM',NULL,NULL),
('venography',0.30,'IR CENTRAL VENOUS RECANALIZATION',NULL,NULL),

-- dialysis access
('dialysis-access',1.00,'IR AV GRAFT',NULL,NULL),
('dialysis-access',1.00,'IR AV FISTULOGRAM',NULL,NULL),
('dialysis-access',0.60,'IR CENTRAL VENOUS RECANALIZATION',NULL,NULL),
('dialysis-access',0.50,'IR TUNNELED LARGE BORE CVC PLACEMENT',NULL,NULL),
('dialysis-access',0.40,'IR TUNNELED LARGE BORE CVC EXCHANGE',NULL,NULL),
('dialysis-access',0.40,'IR UPPER EXTREMITY VENOGRAM',NULL,NULL),
('dialysis-access',0.30,'IR TUNNELED LARGE BORE CVC REMOVAL',NULL,NULL),

-- lines / ports / PICCs
('venous-access-line',1.00,NULL,'Venous Access',NULL),

-- exchange / replacement / conversion
('catheter-exchange',1.00,'%EXCHANGE%',NULL,NULL),
('catheter-exchange',1.00,NULL,NULL,'Exchange catheter over a wire'),
('catheter-exchange',0.80,'IR CENTRAL PORT REPLACEMENT THROUGH SAME VENOUS ACCESS',NULL,NULL),
('catheter-exchange',0.70,'%CONVERSION%',NULL,NULL),

-- removal / foreign body / checks
('removal',0.90,'%REMOV%',NULL,NULL),
('foreign-body',1.00,'IR VASCULAR FOREIGN BODY REMOVAL',NULL,NULL),
('foreign-body',0.70,'IR IVC FILTER REMOVAL',NULL,NULL),
('foreign-body',0.40,'IR REMOVAL NONBIODEGRADABLE DRUG IMPLANT',NULL,NULL),
('tube-check',1.00,'%CHECK%',NULL,NULL),

-- feeding tubes / enteric
('enteric-tubes',0.60,NULL,'Enteric Intervention',NULL),
('enteric-tubes',1.00,'%GASTROSTOMY%',NULL,NULL),
('enteric-tubes',1.00,'%JEJUNOSTOMY%',NULL,NULL),
('enteric-tubes',1.00,'%CECOSTOMY%',NULL,NULL),
('enteric-tubes',1.00,'%GJ-TUBE%',NULL,NULL),
('enteric-tubes',1.00,'IR NASO-ENTERIC TUBE',NULL,NULL),

-- GU
('gu-urinary',1.00,NULL,'GU Intervention',NULL),
('gu-urinary',0.30,'IR RENAL ARTERY ANGIOGRAM',NULL,NULL),
('gu-urinary',0.30,'CT RENAL ABLATION',NULL,NULL),
('gu-urinary',0.30,'%KIDNEY BIOPSY%',NULL,NULL),

-- biliary
('biliary',1.00,'%BILIARY%',NULL,NULL),
('biliary',1.00,NULL,'Hepatobiliary Intervention',NULL),
('biliary',0.80,'%CHOLECYSTOSTOMY%',NULL,NULL),

-- portal hypertension
('portal-hypertension',1.00,'%TIPSS%',NULL,NULL),
('portal-hypertension',1.00,'%BRTO%',NULL,NULL),
('portal-hypertension',0.70,'IR PORTAL VENOGRAPHY',NULL,NULL),
('portal-hypertension',0.50,'IR HEPATIC VENOGRAPHY',NULL,NULL),
('portal-hypertension',0.30,'IR TRANSJUGULAR LIVER BIOPSY',NULL,NULL),

-- paracentesis / thoracentesis / effusions (spaces keep RETROPERITONEAL out)
('fluid-drainage',1.00,'%PARACENTESIS%',NULL,NULL),
('fluid-drainage',1.00,'%THORACENTESIS%',NULL,NULL),
('fluid-drainage',0.90,'%PLEURAL%',NULL,NULL),
('fluid-drainage',0.90,'% PERITONEAL %',NULL,NULL),
('fluid-drainage',0.90,'%CHEST DRAIN%',NULL,NULL),
('fluid-drainage',0.90,'%CHEST TUBE%',NULL,NULL),
('fluid-drainage',0.80,'%FLUID ASPIRATION%',NULL,NULL),

-- abscess / collection drains
('abscess-drain',1.00,NULL,NULL,'Image guided abscess drain%'),
('abscess-drain',0.80,'%DRAIN PLACEMENT%',NULL,NULL),
('abscess-drain',0.50,'%DRAIN EXCHANGE%',NULL,NULL),
('abscess-drain',0.40,'%DRAIN CHECK%',NULL,NULL),

-- lymphatic
('lymphatic',1.00,'%LYMPHANGIOGRAM%',NULL,NULL),
('lymphatic',1.00,'%LYMPHATIC%',NULL,NULL),
('lymphatic',0.60,'%LYMPH/CYST%',NULL,NULL),
('lymphatic',0.40,'%LYMPH NODE%',NULL,NULL),

-- malformations / sclerotherapy
('vascular-malformation',1.00,'%MALFORMATION%',NULL,NULL),
('vascular-malformation',1.00,'%AVM%',NULL,NULL),
('vascular-malformation',0.70,'%SCLEROTHERAPY%',NULL,NULL),
('sclerotherapy',1.00,'%SCLEROTHERAPY%',NULL,NULL),

-- biopsy
('biopsy',1.00,'%BIOPSY%',NULL,NULL),
('biopsy',1.00,NULL,NULL,'Image-guided core biopsies'),

-- ablation / tumor-directed
('tumor-therapy',0.50,'%ABLATION%',NULL,NULL),
('tumor-therapy',1.00,'%ABLATION%','Ablation',NULL),
('tumor-therapy',1.00,'%ABLATION%','IO',NULL),
('tumor-therapy',0.90,NULL,'IO',NULL),
('liver-directed',1.00,'IR ONCOLOGY%',NULL,NULL),
('liver-directed',0.40,'IR HEPATIC ARTERY ANGIOGRAM',NULL,NULL),

-- pain / spine / joints
('nerve-block',1.00,'%NERVE%',NULL,NULL),
('nerve-block',0.90,'%PLEXUS%',NULL,NULL),
('nerve-block',0.50,'IR NEUROSTIMULATOR',NULL,NULL),
('nerve-block',0.30,NULL,'MSK Pain',NULL),
('spine-injection',1.00,'IR SPINE EPIDURAL INJECTION',NULL,NULL),
('spine-injection',1.00,'CT INJECTION EPIDURAL SPINE',NULL,NULL),
('spine-injection',0.90,'IR SPINE PUNCTURE',NULL,NULL),
('spine-injection',0.90,NULL,NULL,'Lumbar Puncture'),
('spine-injection',0.80,'FL SPINE CONTRAST INJECTION FOR CT',NULL,NULL),
('spine-injection',0.60,'%INTRATHECAL%',NULL,NULL),
('joint-injection',1.00,NULL,NULL,'Arthrogram/Joint Aspiration/Injection'),
('joint-injection',1.00,'US ASPIRATION%MSK',NULL,NULL),
('joint-injection',1.00,'US INJECTION%MSK',NULL,NULL),
('joint-injection',0.90,'%JOINT INTERVENTION%',NULL,NULL),
('vertebral-augmentation',1.00,'%AUGMENTATION%',NULL,NULL),
('vertebral-augmentation',1.00,'%SACROPLASTY%',NULL,NULL),

-- IVC filters / pelvis / sampling / angioplasty
('vena-cava-filter',1.00,'%IVC FILTER%',NULL,NULL),
('vena-cava-filter',0.60,'%VENA CAVA%',NULL,NULL),
('pelvic-gyn-gu',1.00,'%UTERINE%',NULL,NULL),
('pelvic-gyn-gu',1.00,'%PROSTATE%',NULL,NULL),
('pelvic-gyn-gu',1.00,'%PELVIC%',NULL,NULL),
('pelvic-gyn-gu',1.00,'%FALLOPIAN%',NULL,NULL),
('venous-sampling',1.00,'%VEIN SAMPLING%',NULL,NULL),
('venous-sampling',0.40,'CT ADRENAL BIOPSY/INTERVENTION',NULL,NULL),
('angioplasty-stenting',1.00,'IR CENTRAL VENOUS RECANALIZATION',NULL,NULL),
('angioplasty-stenting',0.60,'IR AV FISTULOGRAM',NULL,NULL),
('angioplasty-stenting',0.60,'IR AV GRAFT',NULL,NULL),
('angioplasty-stenting',0.60,'%BILIARY STENT%',NULL,NULL),
('angioplasty-stenting',0.60,'IR LOWER EXTREMITY ANGIOGRAM',NULL,NULL),
('angioplasty-stenting',0.50,'IR TIPSS REVISION',NULL,NULL),
('angioplasty-stenting',0.50,'IR URETEROSTOMY DRAIN (STENT)',NULL,NULL),
('angioplasty-stenting',0.40,'IR UPPER EXTREMITY ANGIOGRAM',NULL,NULL),
('angioplasty-stenting',0.40,'IR RENAL ARTERY ANGIOGRAM',NULL,NULL);

-- ─────────────── 5. Expand patterns into proc_type_concepts ───────────────
-- If this errors with "Illegal mix of collations", add
-- COLLATE utf8mb4_general_ci (or your table's collation) to the LIKE / = below.

INSERT INTO proc_type_concepts (proc_type_id, concept_key, strength, source)
SELECT pt.id, a.concept_key, a.str_val, 'manual'
FROM tmp_attach a
JOIN proc_types pt
  ON pt.proc_desc LIKE COALESCE(a.desc_like, '%')
 AND (a.cat_eq IS NULL OR pt.proc_cat = a.cat_eq)
 AND (a.core_like IS NULL OR pt.core_category LIKE a.core_like)
ON DUPLICATE KEY UPDATE strength = GREATEST(strength, VALUES(strength));

DROP TEMPORARY TABLE IF EXISTS tmp_attach;

-- ───────────────────────── 6. Verification ─────────────────────────

-- (a) How many procedure types each concept reaches.
SELECT concept_key, COUNT(*) AS proc_types
FROM proc_type_concepts GROUP BY concept_key ORDER BY proc_types DESC;

-- (b) Concepts with terms but ZERO procedures attached (a pattern missed).
SELECT DISTINCT c.concept_key
FROM proc_concepts c
LEFT JOIN proc_type_concepts p ON p.concept_key = c.concept_key
WHERE p.concept_key IS NULL;

-- (c) Procedure types with NO concept at all (the gaps to fill by hand).
SELECT pt.id, pt.proc_desc, pt.proc_cat
FROM proc_types pt
LEFT JOIN proc_type_concepts p ON p.proc_type_id = pt.id
WHERE p.proc_type_id IS NULL
ORDER BY pt.proc_cat, pt.proc_desc;

-- (d) What a query for "thrombectomy" would reach via its prefix root.
SELECT pt.proc_desc, ptc.concept_key, ptc.strength
FROM proc_concepts c
JOIN proc_type_concepts ptc ON ptc.concept_key = c.concept_key
JOIN proc_types pt ON pt.id = ptc.proc_type_id
WHERE c.match_mode = 'prefix' AND 'thrombectomy' LIKE CONCAT(c.term, '%')
ORDER BY ptc.strength DESC, pt.proc_desc;
