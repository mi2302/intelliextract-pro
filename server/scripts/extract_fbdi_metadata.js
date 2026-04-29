const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function extractMetadata(filePath) {
    try {
        const workbook = XLSX.readFile(filePath, { 
            bookVBA: true,
            cellFormula: true,
            cellStyles: true,
            cellNF: true
        });

        const metadata = {
            sheets: {},
            namedRanges: {},
            interfaceTables: [],
            vba: {}
        };

        // 1. Get VBA Metadata (via Python script)
        const pyScript = path.join(__dirname, 'vba_metadata_extractor.py');
        const pyProcess = spawnSync('python', [pyScript, filePath]);
        if (pyProcess.status === 0) {
            try {
                metadata.vba = JSON.parse(pyProcess.stdout.toString());
            } catch (e) {
                console.error("VBA JSON Parse Error:", e.message);
            }
        }

        // 2. Parse Instruction Sheet
        const instrSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('instruction'));
        if (instrSheetName) {
            const ws = workbook.Sheets[instrSheetName];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            
            // Look for table names like POZ_..._INT in the text
            const re = /[A-Z0-9_]+_INT/g;
            const seenTables = new Set();
            data.forEach(row => {
                row.forEach(cell => {
                    const text = String(cell);
                    let m;
                    while ((m = re.exec(text)) !== null) {
                        seenTables.add(m[0]);
                    }
                });
            });
            metadata.interfaceTables = Array.from(seenTables);
        }

        // 3. Parse Named Ranges (Important for VBA mappings)
        if (workbook.Workbook && workbook.Workbook.Names) {
            workbook.Workbook.Names.forEach(n => {
                metadata.namedRanges[n.Name] = n.Ref;
            });
        }

        // 4. Parse Data Sheets
        workbook.SheetNames.forEach(sheetName => {
            if (sheetName.toLowerCase().includes('instruction') || 
                sheetName.toLowerCase().includes('reference')) return;
            
            const ws = workbook.Sheets[sheetName];
            if (!ws['!ref']) return;
            const range = XLSX.utils.decode_range(ws['!ref']);
            
            const startRow = (metadata.vba && metadata.vba.startingDataRowNumber) ? metadata.vba.startingDataRowNumber - 1 : 3;
            const headers = [];
            const hiddenCols = [];
            const cols = ws['!cols'] || [];

            for (let c = range.s.c; c <= range.e.c; c++) {
                const cell = ws[XLSX.utils.encode_cell({ r: startRow, c: c })]; 
                const val = cell ? cell.v : "";
                headers.push(String(val).trim());
                
                if (cols[c] && cols[c].hidden) {
                    hiddenCols.push(c);
                }
            }

            while (headers.length > 0 && !headers[headers.length - 1]) {
                headers.pop();
            }

            if (headers.some(h => h)) {
                metadata.sheets[sheetName] = {
                    headers: headers,
                    hiddenColumns: hiddenCols,
                    columnCount: headers.length,
                    internalName: ws['A1'] ? String(ws['A1'].v).trim() : null
                };
            }
        });

        console.log(JSON.stringify(metadata, null, 2));
    } catch (err) {
        console.error("Error extracting metadata:", err.message);
        process.exit(1);
    }
}

const filePath = process.argv[2];
if (!filePath) {
    console.error("Usage: node extract_fbdi_metadata.js <path_to_excel>");
    process.exit(1);
}

extractMetadata(filePath);
