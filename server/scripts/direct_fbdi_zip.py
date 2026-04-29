import zipfile
import os
import sys
import json
import csv
import shutil
import tempfile
from typing import List, Dict, Any

def generate_fbdi_zip(output_zip_path: str, extraction_results: List[Dict[str, Any]], skeleton: Dict[str, Any]):
    """
    Generates a compliant FBDI CSV or ZIP using the pre-extracted skeleton.
    No Excel/XLSM access required. Handles VBA-style column shifts and interface naming.
    """
    temp_dir = tempfile.mkdtemp()
    try:
        csv_files = []
        vba_config = skeleton.get('vba', {})
        base_sheets = skeleton.get('sheets', {})
        column_shifts = vba_config.get('columnShifts', [])
        interface_table_names = skeleton.get('interfaceTables', [])
        data_only_list = vba_config.get('dataOnlySheets', [])

        # Helper to convert Column Letter to 0-based index
        def col_to_idx(col_str):
            if not col_str: return -1
            col_str = str(col_str).strip()
            if col_str.isdigit():
                return int(col_str) - 1
            res = 0
            for char in col_str:
                if not char.isalpha(): continue
                res = res * 26 + (ord(char.upper()) - ord('A') + 1)
            return res - 1

        for result in extraction_results:
            sheet_name = result.get('sheetName', '')
            print(f"[ENGINE] Processing input sheet: '{sheet_name}'")
            
            clean_sheet_name = sheet_name.replace('FBDI - ', '').strip().upper()
            config_key = clean_sheet_name.replace(" ", "")
            
            config = None
            final_csv_name = None
            
            # --- 1. Matching Logic ---
            # A. Direct match in data_only_list (case-insensitive)
            for dos in data_only_list:
                if dos.lower() == config_key.lower() or dos.lower().replace('_','') == config_key.lower().replace('_',''):
                    final_csv_name = dos
                    break
            
            # B. Fallback for generic names like 'Data' or 'Sheet1'
            if not final_csv_name and config_key.lower() in ['data', 'sheet1', 'sheet']:
                if len(data_only_list) == 1:
                    final_csv_name = data_only_list[0]
                    print(f"[ENGINE] Generic name '{sheet_name}' matched to single sheet '{final_csv_name}'")
                else:
                    # Match by headers
                    input_cols = [str(c.get('alias', '')).replace('*', '').strip().upper() for c in result.get('columns', [])]
                    input_headers = set(input_cols)
                    
                    best_match = None
                    max_intersect = 0
                    for dos in data_only_list:
                        # Find corresponding skeleton sheet
                        skel_key = next((k for k in base_sheets.keys() if k.lower().replace('_','') == dos.lower().replace('_','')), None)
                        if skel_key:
                            skel_headers = set([str(h).replace('*', '').strip().upper() for h in base_sheets[skel_key].get('headers', [])])
                            intersect = len(input_headers.intersection(skel_headers))
                            if intersect > max_intersect:
                                max_intersect = intersect
                                best_match = dos
                    
                    if best_match and max_intersect > 5:
                        final_csv_name = best_match
                        print(f"[ENGINE] Generic name '{sheet_name}' matched via headers to '{final_csv_name}' (intersect: {max_intersect})")

            if not final_csv_name:
                # Last resort fuzzy match
                for dos in data_only_list:
                    if dos.lower() in config_key.lower() or config_key.lower() in dos.lower():
                        final_csv_name = dos
                        break
            
            if not final_csv_name:
                print(f"[ENGINE] WARNING: No match found for sheet '{sheet_name}'. Available: {data_only_list}")
                continue

            # Find config for the matched sheet
            # Strategy 1: Direct key match (case-insensitive)
            skel_key = next((k for k in base_sheets.keys() if k.lower().replace('_','') == final_csv_name.lower().replace('_','')), None)
            
            # Strategy 2: Index-based mapping (robust for dataOnlySheets -> sheets mapping)
            if not skel_key and final_csv_name in data_only_list:
                try:
                    matched_idx = data_only_list.index(final_csv_name)
                    skeleton_keys = list(base_sheets.keys())
                    if matched_idx < len(skeleton_keys):
                        skel_key = skeleton_keys[matched_idx]
                        print(f"[ENGINE] Matched '{final_csv_name}' to skeleton key '{skel_key}' via index {matched_idx}")
                except Exception as e:
                    print(f"[ENGINE] Index matching failed for {final_csv_name}: {e}")

            config = base_sheets.get(skel_key)
            if not config:
                print(f"[ENGINE] ERROR: No skeleton found for matched sheet '{final_csv_name}' (Skel Key: {skel_key})")
                continue

            # --- 2. Construction logic ---
            csv_filename = f"{final_csv_name}.csv"
            csv_path = os.path.join(temp_dir, csv_filename)
            template_headers = config.get('headers', [])
            col_count = config.get('columnCount', len(template_headers))
            
            # Determine VBA Index for shift filtering
            current_vba_idx = -1
            clean_itn_list = [t.upper().replace('_','') for t in interface_table_names]
            search_itn = final_csv_name.upper().replace('_','')
            if search_itn in clean_itn_list:
                current_vba_idx = clean_itn_list.index(search_itn) + 1

            def should_apply_shift(shift, current_idx):
                target = shift.get('TargetSheet')
                if target is None or str(target).upper() == "ALL" or not target:
                    return True
                return str(target) == str(current_idx)

            # Calculate Mapping Vector
            print(f"[ENGINE] Calculating mapping vector for {final_csv_name} (Col Count: {col_count})")
            index_vector = list(range(col_count))
            for shift in column_shifts:
                if not should_apply_shift(shift, current_vba_idx): continue
                s_type = shift.get('type')
                if s_type in ['MOVE_COL', 'MOVE_COL1_TO_END']:
                    src_idx = col_to_idx(shift.get('sourceCol', 'A'))
                    tgt_idx = col_to_idx(shift.get('targetCell'))
                    if 0 <= src_idx < len(index_vector) and tgt_idx != -1:
                        val = index_vector.pop(src_idx)
                        # User clarified: Always target cell - 1
                        adj_tgt = max(0, min(tgt_idx - 1, len(index_vector)))
                        index_vector.insert(adj_tgt, val)
                        print(f"[ENGINE]   Applied {s_type}: {shift.get('sourceCol')} -> {shift.get('targetCell')} - 1 = pos {adj_tgt}")
                elif s_type in ['DELETE_COL', 'HIDE_COL']:
                    # Disabled as per user request: "dont do you are deleting that"
                    continue
                    # start_col = shift.get('startCol') or shift.get('targetCell')
                    # end_col = shift.get('endCol') or shift.get('startCol') or shift.get('targetCell')
                    # start_idx = col_to_idx(start_col)
                    # end_idx = col_to_idx(end_col)
                    # 
                    # if start_idx != -1:
                    #     # VBA Delete is positional. We must delete from right to left to avoid index shifting during the loop
                    #     count_to_del = max(0, end_idx - start_idx + 1)
                    #     for _ in range(count_to_del):
                    #         if start_idx < len(index_vector):
                    #             removed_val = index_vector.pop(start_idx)
                    #             print(f"[ENGINE]   Applied {s_type}: pos {start_idx} (Orig index {removed_val}) removed.")
            
            print(f"[ENGINE] Final index vector for {final_csv_name}: {index_vector}")

            # Map Aliases
            alias_to_orig_idx = {}
            for col_spec in result.get('columns', []):
                alias = col_spec.get('alias')
                target = (col_spec.get('targetName') or col_spec.get('headerName') or alias).replace('*', '').strip().upper()
                for i, h in enumerate(template_headers):
                    if str(h).replace('*', '').strip().upper() == target:
                        alias_to_orig_idx[alias] = i
                        break

            # Write Data
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
                for row in result.get('data', []):
                    csv_row = []
                    for orig_idx in index_vector:
                        val = ""
                        # Find which alias maps to this orig_idx
                        target_alias = next((a for a, idx in alias_to_orig_idx.items() if idx == orig_idx), None)
                        if target_alias:
                            val = row.get(target_alias, "")
                        csv_row.append(val)
                    
                    # Add "END" marker if needed
                    if len(csv_row) > 0 and str(csv_row[-1]).upper() != "END":
                        csv_row.append("END")
                    writer.writerow(csv_row)
            
            csv_files.append(csv_path)

        # Final Delivery
        if output_zip_path.lower().endswith('.csv'):
            if csv_files:
                shutil.copy2(csv_files[0], output_zip_path)
                return True
            else:
                print(f"[ENGINE] ERROR: No CSV files generated to copy to {output_zip_path}", file=sys.stderr)
                return False
        else:
            # Check for parameters and create parameter_list.properties
            all_parameter_sets = []
            for sheet_res in extraction_results:
                p_sets = sheet_res.get('parameterSets', [])
                if p_sets:
                    all_parameter_sets = p_sets
                    break
            
            param_props_path = None
            if all_parameter_sets:
                param_props_path = os.path.join(temp_dir, "parameter_list.properties")
                # format: each set is a comma-separated line
                lines = []
                for p_set in all_parameter_sets:
                    line = ",".join([str(v) if v is not None else "" for v in p_set])
                    lines.append(line)
                
                content = "\n".join(lines)
                with open(param_props_path, 'w', encoding='utf-8') as pf:
                    pf.write(content)
                print(f"[ENGINE] Created parameter_list.properties with {len(lines)} lines.")

            with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for f in csv_files:
                    zipf.write(f, os.path.basename(f))
                if param_props_path and os.path.exists(param_props_path):
                    zipf.write(param_props_path, "parameter_list.properties")
            return True

    except Exception as e:
        print(f"[ENGINE] Critical Error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return False
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python direct_fbdi_zip.py <skeleton_json_path> <extraction_results_json_path> <output_zip_path>", file=sys.stderr)
        sys.exit(1)
        
    skeleton_path = sys.argv[1]
    results_path = sys.argv[2]
    out_zip_path = sys.argv[3]
    
    try:
        with open(skeleton_path, 'r', encoding='utf-8') as f:
            skeleton_data = json.load(f)
        with open(results_path, 'r', encoding='utf-8') as f:
            results_data = json.load(f)
    except Exception as e:
        print(f"Error loading inputs: {e}", file=sys.stderr)
        sys.exit(1)
        
    if generate_fbdi_zip(out_zip_path, results_data, skeleton_data):
        print(f"Success: FBDI output generated at {out_zip_path}")
    else:
        sys.exit(1)
