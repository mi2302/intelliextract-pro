import zipfile
import sys
import os

def read_properties(zip_path):
    if not os.path.exists(zip_path):
        return f"Error: File {zip_path} not found"
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            if 'parameter_list.properties' in z.namelist():
                with z.open('parameter_list.properties') as f:
                    return f.read().decode('utf-8')
            else:
                return "Error: parameter_list.properties not found in ZIP"
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Prevent any extra output besides the file content
        content = read_properties(sys.argv[1])
        sys.stdout.write(content)
    else:
        sys.stdout.write("Error: No ZIP path provided")
