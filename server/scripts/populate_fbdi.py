import sys
import json
import os
import openpyxl  # type: ignore
from openpyxl.utils import get_column_letter  # type: ignore
from typing import List, Dict, Any, Union

def populate_fbdi_internal(template_path: str, output_path: str, specs: List[Dict[str, Any]], retry_without_vba: bool = False) -> bool:
    """
    Internal population logic that supports a macro-free fallback.
    """
    try:
        # Load the existing template
        # If retry_without_vba is True, we force keep_vba=False
        keep_vba = (not retry_without_vba and template_path.lower().endswith('.xlsm'))
        
        # openpyxl will use lxml if installed, which is more robust
        wb = openpyxl.load_workbook(template_path, keep_vba=keep_vba)
        
        for spec in specs:
            sheet_name: str = str(spec.get('sheetName', ''))
            data: List[Dict[str, Any]] = spec.get('data', [])
            
            if not sheet_name or sheet_name not in wb.sheetnames:
                print(f"Warning: Sheet '{sheet_name}' not found in workbook. Skipping.", file=sys.stderr)
                continue
                
            ws = wb[sheet_name]
            
            # Find the header row (scan first 20 rows)
            header_row_idx: int = -1
            headers: List[str] = []
            
            cols_metadata: List[Dict[str, Any]] = spec.get('columns', [])
            target_name_match: str = ''
            if cols_metadata and len(cols_metadata) > 0:
                target_name_match = str(cols_metadata[0].get('targetName', '')).replace('*', '')
            
            for r_idx in range(1, 21):
                row_cells = [ws.cell(row=r_idx, column=c_idx).value for c_idx in range(1, ws.max_column + 1)]
                valid_cells = [str(c).strip() for c in row_cells if c is not None and str(c).strip()]
                
                if target_name_match and any(target_name_match in str(c) for c in valid_cells if c):
                    header_row_idx = r_idx
                    headers = [str(c).strip() if c else '' for c in row_cells]
                    break
            
            if header_row_idx == -1:
                header_row_idx = 1 # Fallback
                headers = [str(ws.cell(row=1, column=i).value).strip() if ws.cell(row=1, column=i).value else '' for i in range(1, ws.max_column + 1)]
            
            # Map column indices for faster lookup
            header_map: Dict[str, int] = {name: idx+1 for idx, name in enumerate(headers) if name}
            current_write_row: int = header_row_idx + 1
            
            for row_record in data:
                # Type safe iteration over items
                items_to_write: Dict[str, Any] = row_record
                for col_name, val in items_to_write.items():
                    target_col: Union[int, None] = header_map.get(col_name)
                    if not target_col:
                        # Fuzzy match (with/without *)
                        clean_col_name = col_name.replace('*', '')
                        for h_name, h_idx in header_map.items():
                            if h_name.replace('*', '') == clean_col_name:
                                target_col = h_idx
                                break
                    
                    if target_col is not None:
                        ws.cell(row=current_write_row, column=target_col).value = val
                
                # Explicit increment with type ignore to satisfy quirky analyzer
                current_write_row: int = current_write_row + 1 # type: ignore
                
        # Save the populated workbook
        # We always use the requested output_path to ensure Node.js finds it.
        # If we dropped VBA, the file will still be saved to output_path (even if it has .xlsm ext)
        # for standard Excel/openpyxl this is valid, it just won't have macros.
        wb.save(output_path)
        print(f"Success: Workbook saved to {output_path}")
        return True
        
    except Exception as e:
        # If we failed with VBA enabled, retry without it
        if not retry_without_vba and template_path.lower().endswith('.xlsm'):
            print(f"Initial population attempt failed: {str(e)}. Retrying without VBA macros...", file=sys.stderr)
            return populate_fbdi_internal(template_path, output_path, specs, retry_without_vba=True)
        
        # If it still fails, raise it up
        raise e

def populate_fbdi(template_path: str, output_path: str, specs_input: str) -> bool:
    try:
        # specs_input can be raw JSON or a path to a JSON file
        try:
            if os.path.exists(specs_input):
                with open(specs_input, 'r', encoding='utf-8') as f:
                    specs: List[Dict[str, Any]] = json.load(f)
            else:
                specs: List[Dict[str, Any]] = json.loads(specs_input)
        except Exception as json_err:
            print(f"Error parsing specs: {str(json_err)}", file=sys.stderr)
            sys.exit(1)
            
        return populate_fbdi_internal(template_path, output_path, specs)
        
    except Exception as e:
        print(f"Critical error in Python script: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python populate_fbdi.py <template_path> <output_path> <specs_input>", file=sys.stderr)
        sys.exit(1)
        
    t_path: str = sys.argv[1]
    o_path: str = sys.argv[2]
    s_input: str = sys.argv[3]
    
    populate_fbdi(t_path, o_path, s_input)
