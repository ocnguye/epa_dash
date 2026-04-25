import os
from dotenv import load_dotenv
import mysql.connector

load_dotenv()

db = mysql.connector.connect(
    host=os.environ.get("AWS_RDS_HOST"),
    user=os.environ.get("AWS_RDS_USER"),
    password=os.environ.get("AWS_RDS_PWD"),
    database=os.environ.get("AWS_RDS_DB")
)
cursor = db.cursor()

# Get all non-id attendings from reports
cursor.execute("SELECT DISTINCT attending FROM reports WHERE attending NOT REGEXP '^[0-9]+$'")
report_names = [row[0] for row in cursor.fetchall()]

# Get all attendings from users
cursor.execute("SELECT user_id, first_name, last_name FROM users WHERE role='attending'")
users = cursor.fetchall()

# Try to match each report name to a user
matched = 0
unmatched = []

def extract_first_last(name):
    parts = name.strip().split()
    if len(parts) >= 2:
        return parts[0].lower(), parts[-1].lower()  # first and last only
    return name.lower(), ""

for report_name in report_names:
    best_match = None
    report_first, report_last = extract_first_last(report_name)

    for user_id, first_name, last_name in users:
        # Also extract first/last from DB name (handles middle names in DB too)
        db_first, _ = extract_first_last(first_name)
        db_last = last_name.strip().lower()

        if report_first == db_first and report_last == db_last:
            best_match = user_id
            break

### Uncomment this chunk and replace the above loop if you want to use 
### fuzzy matching instead of exact match on first name (but still require 
### exact last name match). Also comment out [if best_match:]

# from difflib import SequenceMatcher

# def similar(a, b):
#     return SequenceMatcher(None, a, b).ratio()

# for report_name in report_names:
#     best_match = None
#     best_score = 0
#     report_first, report_last = extract_first_last(report_name)

#     for user_id, first_name, last_name in users:
#         db_first, _ = extract_first_last(first_name)
#         db_last = last_name.strip().lower()

#         if report_last != db_last:
#             continue  # last name must match exactly

#         score = similar(report_first, db_first)
#         if score > best_score:
#             best_score = score
#             best_match = user_id

#     THRESHOLD = 0.6  # adjust if needed
#     if best_score >= THRESHOLD and best_match:
    if best_match:
        cursor.execute(
            "UPDATE reports SET attending = %s WHERE attending = %s",
            (str(best_match), report_name)
        )
        print(f"Matched '{report_name}' → user ID {best_match}")
        matched += 1
    else:
        unmatched.append(report_name)

db.commit()
print(f"\nDone. {matched} name(s) updated.")
if unmatched:
    print(f"Could not match: {unmatched}")

cursor.close()
db.close()