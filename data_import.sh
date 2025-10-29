# Load environment variables from .env file if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Use AWS RDS credentials if available, otherwise use defaults
DB_HOST=${AWS_RDS_ENDPT:-"localhost"}
DB_USER=${AWS_RDS_USER:-"root"}
DB_PASS=${AWS_RDS_PASS:-""}
DB_NAME=${AWS_RDS_DB:-"epa_dash"}
EXCEL_FILE=${1:-"/Users/oanhnguyen/Desktop/BIMIT/epa_dash/DataForOanh.xlsx"}
TABLE_NAME="procedures"

generate_python_script() {
    cat > /tmp/excel_import.py << 'EOF'
import pandas as pd
import mysql.connector
import sys
import os
from datetime import datetime
import numpy as np

def clean_date(date_val):
    """Clean and convert date values"""
    if pd.isna(date_val) or date_val == 'NULL':
        return None
    
    # Handle Excel date serial numbers (dates from 1899-12-30 indicate Excel serial dates)
    if isinstance(date_val, str) and '1899-12-30' in date_val:
        return None
    
    try:
        if isinstance(date_val, str):
            # Try parsing various date formats
            for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%m/%d/%Y', '%m/%d/%Y %H:%M:%S']:
                try:
                    parsed_date = datetime.strptime(date_val, fmt)
                    return parsed_date.date()  # Return date only for existing table schema
                except ValueError:
                    continue
        elif isinstance(date_val, datetime):
            return date_val.date()
        elif hasattr(date_val, 'to_pydatetime'):
            return date_val.to_pydatetime().date()
    except:
        pass
    
    return None

def clean_text(text_val):
    """Clean text values"""
    if pd.isna(text_val) or text_val == 'NULL':
        return None
    return str(text_val).strip()

def clean_numeric(num_val):
    """Clean numeric values"""
    if pd.isna(num_val) or num_val == 'NULL':
        return None
    try:
        return int(float(num_val))
    except:
        return None

def main():
    # Get parameters
    excel_file = sys.argv[1]
    db_host = sys.argv[2]
    db_user = sys.argv[3]
    db_pass = sys.argv[4] if sys.argv[4] != 'NULL' else None
    db_name = sys.argv[5]
    table_name = sys.argv[6]
    
    try:
        # Read Excel file
        print(f"Reading Excel file: {excel_file}")
        df = pd.read_excel(excel_file, sheet_name='DataForDB')
        print(f"Found {len(df)} rows of data")
        
        # Clean the data
        print("Cleaning data...")
        df['excel_report_id'] = df['report_id'].apply(clean_text)  # Store original report_id from Excel
        df['content'] = df['content'].apply(clean_text)
        df['create_date'] = df['create_date'].apply(clean_date)
        df['lastsign_date'] = df['lastsign_date'].apply(clean_date)
        df['order_id'] = df['order_id'].apply(clean_text)  # order_id is varchar in your table
        df['clinical_site'] = df['clinical_site'].apply(clean_text)
        df['proc_code'] = df['proc_code'].apply(clean_text)  # Map proc_code to proc_code
        df['proc_desc'] = df['proc_desc'].apply(clean_text)
        df['trainee_name'] = df['trainee'].apply(clean_text)
        df['attending_name'] = df['attending'].apply(clean_text)
        df['proc_type_name'] = df['proc_type'].apply(clean_text)
        df['seek_feedback'] = df['seek_feedback'].apply(clean_numeric)
        df['complexity'] = df['complexity'].apply(clean_numeric)
        df['oepa'] = df['oepa'].apply(clean_numeric)
        
        # Connect to database
        print("Connecting to database...")
        config = {
            'user': db_user,
            'password': db_pass,
            'host': db_host,
            'database': db_name,
            'charset': 'utf8mb4',
            'use_unicode': True,
            'autocommit': False
        }
        
        conn = mysql.connector.connect(**config)
        cursor = conn.cursor()
        
        # Create lookup dictionaries for foreign keys
        print("Building foreign key lookups...")
        
        # Get users lookup (using user_id as the primary key, concatenating first_name and last_name)
        user_lookup = {}
        cursor.execute("SELECT user_id, first_name, last_name FROM users")
        for user_id, first_name, last_name in cursor.fetchall():
            if first_name and last_name:
                full_name = f"{first_name.strip()} {last_name.strip()}"
                user_lookup[full_name] = user_id
        print(f"Found {len(user_lookup)} users in database")
        
        # Debug: Show all users found for matching
        print("Available users for matching:")
        for name, user_id in user_lookup.items():
            print(f"  '{name}' -> user_id: {user_id}")
        
        # Get procedure types lookup
        proc_type_lookup = {}
        cursor.execute("SELECT id, name FROM procedure_types")
        for pt_id, name in cursor.fetchall():
            if name:
                proc_type_lookup[name.strip()] = pt_id
        print(f"Found {len(proc_type_lookup)} procedure types in database")
        
        # Debug: Show all procedure types found for matching
        print("Available procedure types for matching:")
        for name, pt_id in proc_type_lookup.items():
            print(f"  '{name}' -> id: {pt_id}")
        
        # Function to resolve foreign keys
        def resolve_user_id(name):
            if not name:
                return None
            name = name.strip()
            if name in user_lookup:
                return user_lookup[name]
            else:
                print(f"Warning: User '{name}' not found in users table")
                return None
        
        def resolve_proc_type_id(name):
            if not name:
                return None
            name = name.strip()
            if name in proc_type_lookup:
                return proc_type_lookup[name]
            else:
                print(f"Warning: Procedure type '{name}' not found in procedure_types table")
                return None
        
        # Check for existing data
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        existing_count = cursor.fetchone()[0]
        print(f"Existing records in table: {existing_count}")
        
        # Prepare insert statement (excluding report_id since it's auto-increment)
        # Note: No temporary column needed since we're not checking duplicates
        insert_sql = f"""
        INSERT INTO {table_name} (
            content, create_date, lastsign_date, order_id,
            clinical_site, proc_code, proc_desc, trainee, attending,
            proc_type, seek_feedback, complexity, oepa
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """
        
        # Insert data - process ALL records without duplicate checking
        inserted_count = 0
        error_count = 0
        
        print(f"\\nStarting import of {len(df)} records...")
        
        for index, row in df.iterrows():
            try:
                # Resolve foreign keys
                trainee_id = resolve_user_id(row['trainee_name'])
                attending_id = resolve_user_id(row['attending_name'])
                proc_type_id = resolve_proc_type_id(row['proc_type_name'])
                
                # Insert the record (no duplicate checking)
                cursor.execute(insert_sql, (
                    row['content'], row['create_date'], row['lastsign_date'],
                    row['order_id'], row['clinical_site'], row['proc_code'], row['proc_desc'],
                    trainee_id, attending_id, proc_type_id, row['seek_feedback'],
                    row['complexity'], row['oepa']
                ))
                inserted_count += 1
                
                if inserted_count % 10 == 0:
                    print(f"Inserted {inserted_count} records...")
                    
            except Exception as e:
                print(f"Error inserting record {index} (Excel report_id: {row.get('excel_report_id', 'N/A')}): {e}")
                error_count += 1
                continue
        
        # Commit changes
        conn.commit()
        
        print(f"\\nImport completed:")
        print(f"  Records inserted: {inserted_count}")
        print(f"  Records with errors: {error_count}")
        print(f"  Total records processed: {len(df)}")
        
        # Verify final count
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        final_count = cursor.fetchone()[0]
        print(f"  Final table record count: {final_count}")
        print(f"  Records added in this run: {final_count - existing_count}")
        
        # Show some sample inserted data
        print("\\nSample of inserted records:")
        cursor.execute(f"""
            SELECT report_id, order_id, 
                   (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE user_id = trainee) as trainee_name,
                   (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE user_id = attending) as attending_name,
                   (SELECT name FROM procedure_types WHERE id = proc_type) as proc_type_name
            FROM {table_name} 
            ORDER BY report_id DESC 
            LIMIT 5
        """)
        
        for record in cursor.fetchall():
            print(f"  ID: {record[0]}, Order: {record[1]}, Trainee: {record[2]}, Attending: {record[3]}, Type: {record[4]}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
EOF
}

main() {
    echo -e "${YELLOW}=== Excel to MySQL Import Script (No Duplicate Checking) ===${NC}"
    echo "Configuration:"
    echo "  Database Host: $DB_HOST"
    echo "  Database User: $DB_USER"
    echo "  Database Name: $DB_NAME"
    echo "  Excel File: $EXCEL_FILE"
    echo "  Table Name: $TABLE_NAME"
    echo ""
    
    
    echo "Generating Python import script..."
    generate_python_script
    
    echo "Starting data import..."
    
    # Pass database password as 'NULL' if empty
    DB_PASS_ARG=${DB_PASS:-"NULL"}
    
    python3 /tmp/excel_import.py "$EXCEL_FILE" "$DB_HOST" "$DB_USER" "$DB_PASS_ARG" "$DB_NAME" "$TABLE_NAME"
    
    if [ $? -eq 0 ]; then
        echo -e "Import completed successfully!"
        
        # Show some statistics
        echo -e "\nFinal Statistics:"
        if [ -z "$DB_PASS" ]; then
            mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" -e "
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(DISTINCT trainee) as unique_trainees,
                    COUNT(DISTINCT attending) as unique_attendings,
                    COUNT(DISTINCT proc_type) as unique_proc_types
                FROM $TABLE_NAME;
            "
        else
            mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(DISTINCT trainee) as unique_trainees,
                    COUNT(DISTINCT attending) as unique_attendings,
                    COUNT(DISTINCT proc_type) as unique_proc_types
                FROM $TABLE_NAME;
            "
        fi
    else
        echo -e "Import failed!"
        exit 1
    fi
    
    # Cleanup
    rm -f /tmp/excel_import.py
}

main