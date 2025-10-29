#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# DB connection variables
DB_HOST=${AWS_RDS_ENDPT:-"localhost"}
DB_USER=${AWS_RDS_USER:-"root"}
DB_PASS=${AWS_RDS_PASS:-""}
DB_NAME=${AWS_RDS_DB:-"epa_dash"}
EXCEL_FILE=${1:-"/Users/oanhnguyen/Desktop/BIMIT/epa_dash/DataForOanh.xlsx"}
TABLE_NAME="procedure_types"

generate_python_script() {
    cat > /tmp/procedure_types_import.py << 'EOF'
import pandas as pd
import mysql.connector
import sys
import os
from datetime import datetime
import numpy as np

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
        # Read Excel file - get procedure types and mappings from Proc2Rot sheet
        print(f"Reading Excel file: {excel_file}")
        
        try:
            df_mapping = pd.read_excel(excel_file, sheet_name='Proc2Rot')
            print(f"Found Proc2Rot sheet with {len(df_mapping)} rows")
            print("Columns in Proc2Rot sheet:", list(df_mapping.columns))
            
            # Show first few rows for verification
            print("\\nFirst few rows of mapping data:")
            for i in range(min(5, len(df_mapping))):
                row = df_mapping.iloc[i]
                print(f"  Row {i+1}: id={row.get('id', 'N/A')}, name='{row.get('name', 'N/A')}', rotation_id='{row.get('rotation_id', 'N/A')}'")
            
        except Exception as e:
            print(f"Error reading Proc2Rot sheet: {e}")
            print("Available sheets in the Excel file:")
            xl_file = pd.ExcelFile(excel_file)
            print(xl_file.sheet_names)
            sys.exit(1)
        
        # Connect to database
        print("\\nConnecting to database...")
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
        
        # Create rotation lookup
        print("Building rotation lookup...")
        rotation_lookup = {}
        cursor.execute("SELECT rotation_id, name FROM rotations")
        for rotation_id, name in cursor.fetchall():
            if name:
                rotation_lookup[name.strip()] = rotation_id
        
        print(f"Found {len(rotation_lookup)} rotations in database:")
        for name, rotation_id in rotation_lookup.items():
            print(f"  '{name}' -> rotation_id: {rotation_id}")
        
        # Process the mapping data from Proc2Rot sheet
        # Get unique procedure types and their rotation mappings
        unique_mappings = df_mapping.groupby('name')['rotation_id'].first().reset_index()
        print(f"\\nFound {len(unique_mappings)} unique procedure types with mappings:")
        
        procedure_types_to_insert = []
        
        for index, row in unique_mappings.iterrows():
            try:
                proc_type_name = clean_text(row['name'])
                rotation_name = clean_text(row['rotation_id'])  # This is actually a rotation name, not ID
                
                if not proc_type_name:
                    print(f"Warning: Empty procedure type name in row {index}")
                    continue
                
                # Look up the actual rotation_id from the rotation name
                rotation_id = None
                if rotation_name and rotation_name in rotation_lookup:
                    rotation_id = rotation_lookup[rotation_name]
                else:
                    print(f"Warning: Rotation '{rotation_name}' not found in rotations table")
                
                procedure_types_to_insert.append({
                    'name': proc_type_name,
                    'rotation_id': rotation_id,
                    'rotation_name': rotation_name
                })
                
                print(f"  '{proc_type_name}' -> '{rotation_name}' (rotation_id: {rotation_id})")
                
            except Exception as e:
                print(f"Error processing row {index}: {e}")
                continue
        
        print(f"\\nPrepared {len(procedure_types_to_insert)} unique procedure types for insertion")
        
        # Check existing procedure types
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        existing_count = cursor.fetchone()[0]
        print(f"\\nExisting procedure types in table: {existing_count}")
        
        # Prepare insert statement
        insert_sql = f"""
        INSERT INTO {table_name} (name, rotation_id)
        VALUES (%s, %s)
        """
        
        # Insert procedure types
        inserted_count = 0
        skipped_count = 0
        
        for proc_data in procedure_types_to_insert:
            try:
                proc_type_name = proc_data['name']
                rotation_id = proc_data['rotation_id']
                rotation_name = proc_data['rotation_name']
                
                # Check if procedure type already exists
                cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE name = %s", (proc_type_name,))
                if cursor.fetchone()[0] > 0:
                    print(f"Skipping duplicate procedure type: '{proc_type_name}'")
                    skipped_count += 1
                    continue
                
                # Insert the procedure type
                cursor.execute(insert_sql, (proc_type_name, rotation_id))
                inserted_count += 1
                print(f"Inserted: '{proc_type_name}' -> '{rotation_name}' (rotation_id: {rotation_id})")
                
            except Exception as e:
                print(f"Error inserting procedure type '{proc_data['name']}': {e}")
                continue
        
        # Commit changes
        conn.commit()
        
        print(f"\\nImport completed:")
        print(f"  Procedure types inserted: {inserted_count}")
        print(f"  Procedure types skipped (duplicates): {skipped_count}")
        print(f"  Total procedure types processed: {len(procedure_types_to_insert)}")
        
        # Verify final count
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        final_count = cursor.fetchone()[0]
        print(f"  Final table record count: {final_count}")
        
        # Show the inserted procedure types
        print("\\nInserted procedure types:")
        cursor.execute(f"""
            SELECT pt.id, pt.name, r.name as rotation_name 
            FROM {table_name} pt 
            LEFT JOIN rotations r ON pt.rotation_id = r.rotation_id
            ORDER BY pt.id
        """)
        for pt_id, pt_name, rotation_name in cursor.fetchall():
            print(f"  ID: {pt_id}, Name: '{pt_name}', Rotation: '{rotation_name}'")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
EOF
}

# Main execution
main() {
    echo -e "=== Procedure Types Import Script ==="
    echo "Configuration:"
    echo "  Database Host: $DB_HOST"
    echo "  Database User: $DB_USER" 
    echo "  Database Name: $DB_NAME"
    echo "  Excel File: $EXCEL_FILE"
    echo "  Table Name: $TABLE_NAME"
    echo ""
    
    check_dependencies
    check_file
    test_connection
    
    echo "Generating Python import script..."
    generate_python_script
    
    echo "Starting procedure types import..."
    
    # Pass database password as 'NULL' if empty
    DB_PASS_ARG=${DB_PASS:-"NULL"}
    
    python3 /tmp/procedure_types_import.py "$EXCEL_FILE" "$DB_HOST" "$DB_USER" "$DB_PASS_ARG" "$DB_NAME" "$TABLE_NAME"
    
    if [ $? -eq 0 ]; then
        echo -e "$Import completed successfully!"
        
        # Show final statistics
        echo -e "\n}Final Statistics:"
        if [ -z "$DB_PASS" ]; then
            mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" -e "
                SELECT 
                    COUNT(*) as total_procedure_types,
                    COUNT(DISTINCT rotation_id) as unique_rotations_referenced
                FROM $TABLE_NAME;
            "
        else
            mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
                SELECT 
                    COUNT(*) as total_procedure_types,
                    COUNT(DISTINCT rotation_id) as unique_rotations_referenced
                FROM $TABLE_NAME;
            "
        fi
    else
        echo -e "Import failed!"
        exit 1
    fi
    
    # Cleanup
    rm -f /tmp/procedure_types_import.py
}

# Run the main function
main