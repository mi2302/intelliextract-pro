const XLSX = require('xlsx');

function dumpInstruction(filePath) {
    const workbook = XLSX.readFile(filePath);
    const instrSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('instruction'));
    if (!instrSheetName) {
        console.log("No Instruction sheet found.");
        return;
    }
    const ws = workbook.Sheets[instrSheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(JSON.stringify(data.slice(0, 50), null, 2));
}

dumpInstruction(process.argv[2]);
