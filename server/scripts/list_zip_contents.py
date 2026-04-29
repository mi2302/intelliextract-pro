import zipfile
import sys
import json

def list_zip_contents(file_path):
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            return {"success": True, "files": z.namelist()}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No file path provided"}))
        sys.exit(1)
    
    result = list_zip_contents(sys.argv[1])
    print(json.dumps(result))
