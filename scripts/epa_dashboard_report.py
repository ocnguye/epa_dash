#!/usr/bin/env python3
"""
epa_dashboard_report.py

Read-only reporting script for the RadInsights EPA dashboard MySQL database.

Pulls case-level EPA/procedure data, computes summary statistics, and exports
a multi-sheet Excel workbook. This script NEVER writes to the database — it
opens a read-only session and only ever issues SELECT statements.

USAGE
-----
    export AWS_RDS_HOST=...
    export AWS_RDS_PORT=3306
    export AWS_RDS_USER=readonly_user
    export AWS_RDS_PWD=...
    export AWS_RDS_DB=radinsights

    python epa_dashboard_report.py --start-date 2025-07-01 --end-date 2026-06-30 \
        --output epa_report.xlsx

If --start-date/--end-date are omitted, all reports are pulled.

REQUIREMENTS
------------
    pip install pymysql pandas openpyxl

TEXT-DERIVED FIELDS — HOW THEY WORK
------------------------------------------------------------------------
reports.ContentText follows a template with labeled, double-space-delimited
fields. This script parses that structure rather than doing blind keyword
search:

  - "Location: <site>    <room code>    Date of exam:" -> clinical site
  - "Contrast: <N> mL <agent>"                          -> contrast volume/agent
  - "<Anesthesia Type>: <value>" (e.g. "Conscious Sedation:")
                                                          -> anesthesia type/used
  - "Procedural Personnel ... Resident(s) PGY6/7: <name> Trainee EPA: <N> ...
     Complications:"                                     -> trainee's PGY group
                                                             AT THE TIME of the
                                                             procedure, plus the
                                                             source-dictated EPA
                                                             score for reconciling
                                                             against epa_scores

All of the above are validated against exactly ONE example report. The label
set (PERSONNEL_BLOCK_LABELS, ANESTHESIA_LABELS) is very likely incomplete —
extend it as you see more templates. Every text-derived column is suffixed
"_from_text" and there's a "Data Quality Flags" sheet for anything that
couldn't be parsed cleanly (trainee not found in the personnel block, more
than one plausible name match, etc.) so nothing is silently guessed.

Other known gaps (see "Data Availability" sheet in the output for full detail):
  - Trainee program (Integrated IR / ESIR / DR): no signal anywhere in the DB
    or in this example report. Fill in TRAINEE_PROGRAM_MAP manually if needed.
  - Procedure duration and report turnaround time: no supporting timestamp
    columns exist (only reports.CreateDate), and no signal for either in the
    example report. Left NULL rather than fabricated.
"""

import argparse
import os
import re
import sys

import pandas as pd
import pymysql
import pymysql.cursors

from dotenv import load_dotenv
load_dotenv()

# --------------------------------------------------------------------------
# CONFIGURABLE MAPPINGS
# --------------------------------------------------------------------------

# Trainee program/track is not stored anywhere (DB or report text). Fill in
# as needed: {user_id: "Integrated IR" | "ESIR" | "DR"}
TRAINEE_PROGRAM_MAP = {
    # 12: "Integrated IR",
    # 47: "ESIR",
}

# --------------------------------------------------------------------------
# TEXT PARSING PATTERNS — validated against one example report; extend as
# you encounter other templates.
# --------------------------------------------------------------------------

LOCATION_BLOCK_PATTERN = re.compile(
    r"Location:\s*(.+?)\s*Date of exam:", re.IGNORECASE | re.DOTALL
)

CONTRAST_PATTERN = re.compile(
    r"Contrast:\s*(\d+(?:\.\d+)?)\s*mL\s*([A-Za-z][A-Za-z0-9\-]*)?", re.IGNORECASE
)

# Extend this list as you see other anesthesia-type labels in your templates.
ANESTHESIA_LABELS = [
    "General Anesthesia",
    "Monitored Anesthesia Care",
    "MAC Anesthesia",
    "Conscious Sedation",
    "Local Anesthesia",
]
ANESTHESIA_LABEL_PATTERN = re.compile(
    r"(" + "|".join(re.escape(l) for l in ANESTHESIA_LABELS) + r")\s*:", re.IGNORECASE
)
ANESTHESIA_VALUE_END_PATTERN = re.compile(
    r"\s{2,}(?:Medications|Antibiotics|Blood loss|Checklist)\s*:", re.IGNORECASE
)

# Extend this list as you see other role labels in the "Procedural Personnel"
# block (e.g. "Fellow(s):", different PGY groupings than PGY6/7 / PGY1-5).
PERSONNEL_BLOCK_LABELS = [
    "Attending(s)",
    "Resident(s) PGY6/7",
    "Resident(s) PGY1-5",
    "Advanced practice provider(s)",
]
PERSONNEL_BLOCK_START_PATTERN = re.compile(r"Procedural Personnel", re.IGNORECASE)
PERSONNEL_BLOCK_END_PATTERN = re.compile(r"\bComplications\s*:", re.IGNORECASE)
TRAINEE_EPA_PATTERN = re.compile(r"Trainee EPA\s*:\s*(\d+|None)", re.IGNORECASE)
RESIDENT_LABEL_PREFIX = "Resident(s)"


# --------------------------------------------------------------------------
# DB CONNECTION (read-only)
# --------------------------------------------------------------------------

def get_connection():
    conn = pymysql.connect(
        host=os.environ.get("AWS_RDS_HOST", "localhost"),
        port=int(os.environ.get("AWS_RDS_PORT", 3306)),
        user=os.environ["AWS_RDS_USER"],
        password=os.environ["AWS_RDS_PWD"],
        database=os.environ["AWS_RDS_DB"],
        cursorclass=pymysql.cursors.DictCursor,
        charset="utf8mb4",
    )
    with conn.cursor() as cur:
        # Belt-and-suspenders: refuse writes for the rest of this session
        # even if a query below were ever changed by mistake.
        cur.execute("SET SESSION TRANSACTION READ ONLY;")
    return conn


def run_query(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        rows = cur.fetchall()
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# EXTRACTION QUERIES
# --------------------------------------------------------------------------

def fetch_proc_types(conn):
    return run_query(
        conn,
        """
        SELECT id AS proc_type_id, proc_code, proc_desc, proc_cat,
               core_category, complexity
        FROM proc_types
        """,
    )


def fetch_epa_scores(conn):
    """One row per report_participant, aggregated. A participant with more
    than one distinct epa_score is a data-quality flag (schema technically
    allows it via the unique key on (report_participant_id, epa_score))."""
    return run_query(
        conn,
        """
        SELECT
            report_participant_id,
            COUNT(*)                              AS epa_row_count,
            COUNT(DISTINCT epa_score)              AS distinct_epa_score_count,
            GROUP_CONCAT(DISTINCT epa_score ORDER BY epa_score) AS epa_scores_list,
            MAX(epa_score)                         AS epa_score_max,
            MAX(created_at)                        AS epa_last_created_at
        FROM epa_scores
        GROUP BY report_participant_id
        """,
    )


def fetch_case_level(conn, start_date=None, end_date=None):
    """One row per (report, trainee). Attending is left-joined since a report
    could theoretically be missing an attending participant row."""
    where_clauses = []
    params = {}
    if start_date:
        where_clauses.append("r.CreateDate >= %(start_date)s")
        params["start_date"] = start_date
    if end_date:
        where_clauses.append("r.CreateDate <= %(end_date)s")
        params["end_date"] = end_date
    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    sql = f"""
        SELECT
            r.ReportID,
            r.Accession,
            r.CreateDate                AS report_date,
            r.ProcedureCodeList,
            r.ProcedureDescList,
            r.ReasonForStudy,
            r.scan_type,
            r.fluoroscopy_time_minutes,
            r.fluoroscopy_time_unit,
            r.fluoroscopy_dose_value,
            r.fluoroscopy_dose_unit,
            r.ContentText,

            trainee_rp.id               AS trainee_report_participant_id,
            trainee_u.user_id           AS trainee_user_id,
            trainee_u.first_name        AS trainee_first_name,
            trainee_u.last_name         AS trainee_last_name,
            trainee_u.preferred_name    AS trainee_preferred_name,
            trainee_u.pgy               AS trainee_pgy_current,
            trainee_u.pgy_note          AS trainee_pgy_note,

            attending_rp.id             AS attending_report_participant_id,
            attending_u.user_id         AS attending_user_id,
            attending_u.first_name      AS attending_first_name,
            attending_u.last_name       AS attending_last_name

        FROM reports r
        JOIN report_participants trainee_rp
            ON trainee_rp.report_id = r.ReportID AND trainee_rp.role = 'trainee'
        JOIN users trainee_u
            ON trainee_u.user_id = trainee_rp.user_id
        LEFT JOIN report_participants attending_rp
            ON attending_rp.report_id = r.ReportID AND attending_rp.role = 'attending'
        LEFT JOIN users attending_u
            ON attending_u.user_id = attending_rp.user_id
        {where_sql}
    """
    return run_query(conn, sql, params)


# --------------------------------------------------------------------------
# TEXT PARSING HELPERS
# --------------------------------------------------------------------------

def extract_site(content_text):
    if not content_text:
        return None
    m = LOCATION_BLOCK_PATTERN.search(content_text)
    if not m:
        return None
    raw = m.group(1)
    parts = [p.strip() for p in re.split(r"\s{2,}", raw) if p.strip()]
    if not parts:
        return None
    # Drop trailing tokens that look like room/suite codes (all caps/digits/dots,
    # e.g. "ESRC.IR.1") and keep the human-readable site name.
    site_parts = [p for p in parts if not re.match(r"^[A-Z0-9.\-]+$", p)]
    return site_parts[0] if site_parts else parts[0]


def extract_contrast(content_text):
    if not content_text:
        return None, None
    m = CONTRAST_PATTERN.search(content_text)
    if not m:
        return None, None
    return float(m.group(1)), (m.group(2) or None)


def extract_anesthesia(content_text):
    if not content_text:
        return None, None
    label_m = ANESTHESIA_LABEL_PATTERN.search(content_text)
    if not label_m:
        return None, None
    label = label_m.group(1)
    rest = content_text[label_m.end():]
    end_m = ANESTHESIA_VALUE_END_PATTERN.search(rest)
    value = rest[: end_m.start()] if end_m else rest[:200]
    value = value.strip()
    used = not bool(re.match(r"^none\b", value, re.IGNORECASE))
    return label, used


def extract_personnel_block(content_text):
    if not content_text:
        return None
    start_m = PERSONNEL_BLOCK_START_PATTERN.search(content_text)
    if not start_m:
        return None
    end_m = PERSONNEL_BLOCK_END_PATTERN.search(content_text, start_m.end())
    end = end_m.start() if end_m else len(content_text)
    return content_text[start_m.end():end]


def parse_personnel_segments(block_text):
    """Splits the personnel block into {label: value_text} using the known
    label list. Best-effort — see PERSONNEL_BLOCK_LABELS caveat in the
    module docstring."""
    if not block_text:
        return {}
    label_pattern = "|".join(re.escape(l) for l in PERSONNEL_BLOCK_LABELS)
    anchors = list(re.finditer(rf"(?:{label_pattern})\s*:", block_text))
    segments = {}
    for i, m in enumerate(anchors):
        label = block_text[m.start():m.end() - 1].strip()
        value_start = m.end()
        value_end = anchors[i + 1].start() if i + 1 < len(anchors) else len(block_text)
        segments[label] = block_text[value_start:value_end].strip()
    return segments


def extract_trainee_epa_from_segment(segment_text):
    """Pulls 'Trainee EPA: N' out of a resident-group segment, if present."""
    if not segment_text:
        return segment_text, None
    m = TRAINEE_EPA_PATTERN.search(segment_text)
    if not m:
        return segment_text.strip(), None
    name_text = segment_text[: m.start()].strip()
    val = m.group(1)
    epa_value = None if val.lower() == "none" else int(val)
    return name_text, epa_value


def extract_trainee_context_from_personnel(content_text, trainee_last_name, trainee_first_name):
    """Returns the trainee's PGY group and source-dictated EPA score from the
    Procedural Personnel block, matched to the DB trainee by last name (falls
    back to first name). trainee_match_confidence tells you how much to trust
    the result:
        "matched"                  - exactly one resident-group name matched
        "not_found_in_text"        - no resident-group name matched
        "ambiguous_multiple_matches" - more than one matched; unresolved
    """
    result = {
        "personnel_block_found": False,
        "attending_name_from_text": None,
        "trainee_pgy_group_from_text": None,
        "source_epa_score_from_text": None,
        "source_epa_documented_from_text": None,
        "trainee_match_confidence": None,
    }
    block = extract_personnel_block(content_text)
    if not block:
        return result
    result["personnel_block_found"] = True
    segments = parse_personnel_segments(block)
    result["attending_name_from_text"] = segments.get("Attending(s)")

    resident_segments = {
        label: value for label, value in segments.items() if label.startswith(RESIDENT_LABEL_PREFIX)
    }

    matches = []
    for label, value in resident_segments.items():
        name_text, epa_value = extract_trainee_epa_from_segment(value)
        if not name_text or name_text.lower() == "none":
            continue
        name_lower = name_text.lower()
        if (trainee_last_name and trainee_last_name.lower() in name_lower) or (
            trainee_first_name and trainee_first_name.lower() in name_lower
        ):
            matches.append((label, name_text, epa_value))

    if len(matches) == 1:
        label, _name_text, epa_value = matches[0]
        result["trainee_pgy_group_from_text"] = label.replace(RESIDENT_LABEL_PREFIX, "").strip() or None
        result["source_epa_score_from_text"] = epa_value
        result["source_epa_documented_from_text"] = epa_value is not None
        result["trainee_match_confidence"] = "matched"
    elif len(matches) == 0:
        result["trainee_match_confidence"] = "not_found_in_text"
    else:
        result["trainee_match_confidence"] = "ambiguous_multiple_matches"

    return result


def names_roughly_match(name_text, first_name, last_name):
    if not name_text or (not first_name and not last_name):
        return None
    name_lower = name_text.lower()
    if last_name and last_name.lower() in name_lower:
        return True
    if first_name and first_name.lower() in name_lower:
        return True
    return False


def match_proc_code(procedure_code_list, proc_types_df):
    """Best-effort match: reports.ProcedureCodeList may contain a single code
    or a comma-separated list; proc_types.proc_code is a single code. Tries
    an exact match first, then the first code in a comma-separated list.

    Returns a plain dict (empty dict on no match) rather than a pandas Series
    or None — a Series/None mix fed into a later .apply() makes pandas try
    to auto-expand the results into a DataFrame and crash with
    "TypeError: object of type 'NoneType' has no len()" the moment any row
    has no match. A dict sidesteps that entirely."""
    if not procedure_code_list or proc_types_df.empty:
        return {}
    code_str = str(procedure_code_list).strip()
    exact = proc_types_df[proc_types_df["proc_code"] == code_str]
    if not exact.empty:
        return exact.iloc[0].to_dict()
    first_code = code_str.split(",")[0].strip()
    if first_code and first_code != code_str:
        partial = proc_types_df[proc_types_df["proc_code"] == first_code]
        if not partial.empty:
            return partial.iloc[0].to_dict()
    return {}


# --------------------------------------------------------------------------
# BUILD ENRICHED CASE-LEVEL TABLE
# --------------------------------------------------------------------------

def build_case_level_table(conn, start_date=None, end_date=None):
    cases = fetch_case_level(conn, start_date, end_date)
    if cases.empty:
        return cases

    proc_types = fetch_proc_types(conn)
    epa_agg = fetch_epa_scores(conn)

    cases["trainee_name"] = cases["trainee_preferred_name"].fillna(
        cases["trainee_first_name"] + " " + cases["trainee_last_name"]
    )
    cases["trainee_program"] = cases["trainee_user_id"].map(TRAINEE_PROGRAM_MAP)

    cases["attending_name"] = (
        cases["attending_first_name"].fillna("") + " " + cases["attending_last_name"].fillna("")
    ).str.strip().replace("", None)

    # --- EPA (DB, structured) ---
    cases = cases.merge(
        epa_agg, left_on="trainee_report_participant_id", right_on="report_participant_id", how="left",
    )
    cases["epa_completed"] = cases["epa_row_count"].fillna(0) > 0
    cases["epa_multiple_distinct_scores_flag"] = cases["distinct_epa_score_count"].fillna(0) > 1

    # --- proc_types match ---
    matched = cases["ProcedureCodeList"].apply(lambda c: match_proc_code(c, proc_types))
    cases["proc_type_matched_desc"] = matched.apply(lambda r: r.get("proc_desc"))
    cases["proc_category"] = matched.apply(lambda r: r.get("proc_cat"))
    cases["proc_core_category"] = matched.apply(lambda r: r.get("core_category"))
    cases["baseline_complexity"] = matched.apply(lambda r: r.get("complexity"))
    cases["proc_code_matched_flag"] = matched.apply(lambda r: bool(r))

    # --- text-derived fields (see module docstring for how these work) ---
    cases["clinical_site_from_text"] = cases["ContentText"].apply(extract_site)

    contrast_results = cases["ContentText"].apply(extract_contrast)
    cases["contrast_volume_ml_from_text"] = contrast_results.apply(lambda t: t[0])
    cases["contrast_agent_from_text"] = contrast_results.apply(lambda t: t[1])

    anesthesia_results = cases["ContentText"].apply(extract_anesthesia)
    cases["anesthesia_type_from_text"] = anesthesia_results.apply(lambda t: t[0])
    cases["anesthesia_used_from_text"] = anesthesia_results.apply(lambda t: t[1])

    personnel_context = cases.apply(
        lambda row: extract_trainee_context_from_personnel(
            row["ContentText"], row["trainee_last_name"], row["trainee_first_name"]
        ),
        axis=1,
    )
    personnel_df = pd.DataFrame(list(personnel_context))
    cases = pd.concat([cases.reset_index(drop=True), personnel_df.reset_index(drop=True)], axis=1)

    cases["attending_name_text_matches_db"] = cases.apply(
        lambda r: names_roughly_match(
            r["attending_name_from_text"], r["attending_first_name"], r["attending_last_name"]
        ),
        axis=1,
    )

    # --- EPA source-text vs DB reconciliation ---
    cases["epa_documented_in_text"] = cases["source_epa_documented_from_text"].fillna(False)
    cases["epa_text_db_mismatch_flag"] = (
        (cases["epa_documented_in_text"] & (~cases["epa_completed"]))
        | (
            (~cases["epa_documented_in_text"])
            & cases["epa_completed"]
            & (cases["trainee_match_confidence"] == "matched")
        )
        | (
            cases["epa_documented_in_text"]
            & cases["epa_completed"]
            & cases["source_epa_score_from_text"].notna()
            & (cases["source_epa_score_from_text"] != cases["epa_score_max"])
        )
    )

    # not available anywhere in DB or example report text — explicit nulls
    cases["procedure_duration_minutes"] = None
    cases["report_turnaround_hours"] = None

    cases["content_text_preview"] = cases["ContentText"].str.slice(0, 300)
    cases = cases.drop(columns=["ContentText"])

    return cases


# --------------------------------------------------------------------------
# SUMMARY STATS
# --------------------------------------------------------------------------

def summarize_by_trainee(cases):
    if cases.empty:
        return pd.DataFrame()
    grouped = cases.groupby(
        ["trainee_user_id", "trainee_name", "trainee_pgy_current", "trainee_pgy_note", "trainee_program"],
        dropna=False,
    )
    out = grouped.agg(
        total_cases=("ReportID", "count"),
        epa_completed_count=("epa_completed", "sum"),
        avg_epa_score=("epa_score_max", "mean"),
        avg_baseline_complexity=("baseline_complexity", "mean"),
        avg_fluoro_time_min=("fluoroscopy_time_minutes", "mean"),
        avg_fluoro_dose=("fluoroscopy_dose_value", "mean"),
        pgy_groups_seen_in_text=(
            "trainee_pgy_group_from_text",
            lambda s: ", ".join(sorted({x for x in s if x})),
        ),
    ).reset_index()
    out["epa_completion_rate"] = out["epa_completed_count"] / out["total_cases"]
    return out.sort_values("trainee_name")


def summarize_by_attending(cases):
    if cases.empty:
        return pd.DataFrame()
    grouped = cases.groupby(["attending_user_id", "attending_name"], dropna=False)
    out = grouped.agg(
        total_cases=("ReportID", "count"),
        epa_completed_count=("epa_completed", "sum"),
        avg_epa_score_given=("epa_score_max", "mean"),
    ).reset_index()
    out["epa_completion_rate_for_their_cases"] = out["epa_completed_count"] / out["total_cases"]
    return out.sort_values("attending_name")


def summarize_by_proc_type(cases):
    if cases.empty:
        return pd.DataFrame()
    grouped = cases.groupby(["proc_type_matched_desc", "proc_category", "proc_core_category"], dropna=False)
    out = grouped.agg(
        total_cases=("ReportID", "count"),
        avg_baseline_complexity=("baseline_complexity", "mean"),
        epa_completed_count=("epa_completed", "sum"),
        avg_epa_score=("epa_score_max", "mean"),
    ).reset_index()
    out["epa_completion_rate"] = out["epa_completed_count"] / out["total_cases"]
    return out.sort_values("total_cases", ascending=False)


def summarize_extraction_reconciliation(cases):
    if cases.empty:
        return pd.DataFrame()
    total_cases = len(cases)
    epa_in_db = int(cases["epa_completed"].sum())
    epa_in_text = int(cases["epa_documented_in_text"].sum())
    mismatches = int(cases["epa_text_db_mismatch_flag"].sum())
    unmatched_proc_codes = int((~cases["proc_code_matched_flag"]).sum())
    multi_score_flags = int(cases["epa_multiple_distinct_scores_flag"].sum())
    personnel_found = int(cases["personnel_block_found"].sum())
    matched_confidence = int((cases["trainee_match_confidence"] == "matched").sum())
    not_found_confidence = int((cases["trainee_match_confidence"] == "not_found_in_text").sum())
    ambiguous_confidence = int((cases["trainee_match_confidence"] == "ambiguous_multiple_matches").sum())

    return pd.DataFrame(
        [
            {"metric": "Total case-trainee rows", "value": total_cases},
            {"metric": "EPAs completed (epa_scores table)", "value": epa_in_db},
            {"metric": "EPA completion rate (DB)", "value": round(epa_in_db / total_cases, 4) if total_cases else None},
            {"metric": "EPA documented in source text ('Trainee EPA: N')", "value": epa_in_text},
            {"metric": "Text-vs-DB EPA mismatches (flagged, see Data Quality Flags)", "value": mismatches},
            {"metric": "Procedural Personnel block found in text", "value": personnel_found},
            {"metric": "Trainee matched in personnel block (high confidence)", "value": matched_confidence},
            {"metric": "Trainee NOT found in personnel block text", "value": not_found_confidence},
            {"metric": "Trainee match ambiguous (multiple name matches)", "value": ambiguous_confidence},
            {"metric": "Cases with unmatched ProcedureCodeList -> proc_types", "value": unmatched_proc_codes},
            {"metric": "Report_participants with >1 distinct epa_score (data-quality flag)", "value": multi_score_flags},
        ]
    )


def build_data_quality_flags(cases):
    if cases.empty:
        return pd.DataFrame()
    flagged = cases[
        cases["epa_multiple_distinct_scores_flag"]
        | (~cases["proc_code_matched_flag"])
        | cases["epa_text_db_mismatch_flag"]
        | (cases["trainee_match_confidence"] == "ambiguous_multiple_matches")
        | (cases["attending_name_text_matches_db"] == False)  # noqa: E712
        | cases["attending_user_id"].isna()
    ]
    cols = [
        "ReportID",
        "trainee_name",
        "attending_name",
        "attending_name_from_text",
        "ProcedureCodeList",
        "proc_code_matched_flag",
        "epa_multiple_distinct_scores_flag",
        "epa_completed",
        "epa_documented_in_text",
        "source_epa_score_from_text",
        "epa_score_max",
        "epa_text_db_mismatch_flag",
        "trainee_match_confidence",
    ]
    return flagged[cols].copy()


def build_data_availability_sheet():
    rows = [
        ("Trainee name/ID", "Available", "users.user_id, first_name, last_name, preferred_name"),
        ("PGY level at time of procedure", "Partial",
         "users.pgy is CURRENT PGY only. trainee_pgy_group_from_text gives a coarse group (e.g. 'PGY6/7') "
         "parsed from the Procedural Personnel block when the trainee is matched unambiguously — this is the "
         "closer-to-real-time signal, but only a group, not an exact year, and depends on text-match confidence."),
        ("Trainee program (Integrated IR/ESIR/DR)", "Not available",
         "No signal in the DB or in the example report. Populate TRAINEE_PROGRAM_MAP manually."),
        ("Attending name/ID", "Available", "users.user_id, first_name, last_name. Cross-checked against "
         "attending_name_from_text (parsed from the 'Attending(s):' field) for mismatches."),
        ("Clinical site", "From text, structured field",
         "Parsed from the labeled 'Location: <site>  <room code>  Date of exam:' field — more reliable than "
         "free-text search, but still validated on only one example."),
        ("Procedure type/name", "Available", "reports.ProcedureDescList, ProcedureCodeList"),
        ("Procedure date", "Available", "reports.CreateDate"),
        ("Procedure category (existing)", "Available if code matches",
         "proc_types.proc_cat / core_category, joined on ProcedureCodeList = proc_code (single-code match only)."),
        ("Baseline complexity score", "Available if code matches", "proc_types.complexity"),
        ("EPA score for each case", "Available (DB) + cross-checked (text)",
         "epa_scores.epa_score is the DB value; source_epa_score_from_text is the dictated value from the "
         "personnel block, when parseable."),
        ("EPA completed y/n", "Available", "Derived: row exists in epa_scores for that report_participant."),
        ("Radiation dose", "Available (as fluoroscopy dose)", "reports.fluoroscopy_dose_value/unit"),
        ("Fluoroscopy time", "Available", "reports.fluoroscopy_time_minutes"),
        ("Procedure duration", "Not available", "No start/end timestamp columns exist; no signal in example text."),
        ("Contrast volume", "From text, structured field",
         "Parsed from the labeled 'Contrast: <N> mL <agent>' field."),
        ("Anesthesia used", "From text, structured field",
         "Parsed from a labeled anesthesia-type field (e.g. 'Conscious Sedation:'). Label list "
         "(ANESTHESIA_LABELS) is inferred from one example and likely incomplete."),
        ("Report turnaround time", "Not available",
         "Only reports.CreateDate exists — no second timestamp (order/exam/sign date) to diff against."),
        ("EPAs in source system vs. extracted", "Available via text parsing",
         "source_epa_score_from_text parses 'Trainee EPA: N' out of the Procedural Personnel block and is "
         "matched to the DB trainee by name. trainee_match_confidence tells you how much to trust each row "
         "('matched' / 'not_found_in_text' / 'ambiguous_multiple_matches'). Validated on one example — spot "
         "check a larger sample before treating this as ground truth."),
        ("Missing/failed EPA extractions", "Available via text parsing",
         "See epa_text_db_mismatch_flag and the Extraction Reconciliation / Data Quality Flags sheets."),
    ]
    return pd.DataFrame(rows, columns=["Requested field", "Availability", "Notes"])


# --------------------------------------------------------------------------
# EXCEL EXPORT
# --------------------------------------------------------------------------

def autosize_columns(worksheet, df):
    for i, col in enumerate(df.columns, start=1):
        max_len = max([len(str(col))] + [len(str(v)) for v in df[col].astype(str).values[:500]])
        worksheet.column_dimensions[worksheet.cell(row=1, column=i).column_letter].width = min(max_len + 2, 60)


def write_report(output_path, cases, by_trainee, by_attending, by_proc_type,
                  reconciliation, quality_flags, availability):
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        sheets = {
            "Case-Level Detail": cases,
            "By Trainee": by_trainee,
            "By Attending": by_attending,
            "By Procedure Type": by_proc_type,
            "Extraction Reconciliation": reconciliation,
            "Data Quality Flags": quality_flags,
            "Data Availability": availability,
        }
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name[:31], index=False)
        for name, df in sheets.items():
            if df.empty:
                continue
            ws = writer.sheets[name[:31]]
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for cell in ws[1]:
                cell.font = cell.font.copy(bold=True)
            autosize_columns(ws, df)


# --------------------------------------------------------------------------
# MAIN
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default=None, help="YYYY-MM-DD, filters reports.CreateDate")
    parser.add_argument("--end-date", default=None, help="YYYY-MM-DD, filters reports.CreateDate")
    parser.add_argument("--output", default="epa_dashboard_report.xlsx")
    args = parser.parse_args()

    for var in ("AWS_RDS_USER", "AWS_RDS_PWD", "AWS_RDS_DB"):
        if var not in os.environ:
            sys.exit(f"Missing required environment variable: {var}")

    print("Connecting (read-only session)...")
    conn = get_connection()
    try:
        print("Pulling and enriching case-level data...")
        cases = build_case_level_table(conn, args.start_date, args.end_date)
        if cases.empty:
            print("No cases found for the given date range.")
        print(f"  {len(cases)} case-trainee rows")

        print("Computing summaries...")
        by_trainee = summarize_by_trainee(cases)
        by_attending = summarize_by_attending(cases)
        by_proc_type = summarize_by_proc_type(cases)
        reconciliation = summarize_extraction_reconciliation(cases)
        quality_flags = build_data_quality_flags(cases)
        availability = build_data_availability_sheet()

        print(f"Writing {args.output} ...")
        write_report(
            args.output, cases, by_trainee, by_attending, by_proc_type,
            reconciliation, quality_flags, availability,
        )
        print("Done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()