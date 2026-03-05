import * as XLSX from 'xlsx';

const MODULE_PREFIX_MAP: Record<string, string> = {
    'AP': 'Payables',
    'PO': 'Purchasing',
    'GL': 'General Ledger',
    'FA': 'Fixed Assets',
    'AR': 'Receivables',
    'INV': 'Inventory',
    'RCV': 'Receipt Accounting',
    'XLA': 'Subledger Accounting',
    'ZX': 'Tax',
    'HZ': 'Trading Community Architecture',
    'PA': 'Projects',
    'Pj': 'Projects',
    'OKC': 'Contracts',
    'OKS': 'Service Contracts',
    'OM': 'Order Management',
    'CST': 'Cost Management',
    'MSC': 'Supply Chain Planning',
    'WSH': 'Shipping',
    'WMS': 'Warehouse Management',
    'EGP': 'Product Management',
    'EGO': 'Product Hub',
    'BEN': 'Benefits',
    'PAY': 'Payroll',
    'PER': 'Human Resources',
    'Hrc': 'Human Capital Management',
    'Abs': 'Absence Management',
    'POZ': 'Suppliers'
};

export interface AgentAnalysis {
    productFamily?: string;
    moduleName: string;
    possibleModules?: string[];
    mainObject?: string;
    intent: string;
    summary: string;
    confidence: 'High' | 'Medium' | 'Low';
    sheets: string[];
    primaryDataSheet: string;
    hasMacros: boolean;
    rawMetadata: {
        props: any;
        instructionText: string;
    };
}

export const analyzeFbdiContent = (fileBuffer: ArrayBuffer, fileName: string = ''): AgentAnalysis => {
    // 1. Read Workbook with Full Metadata
    const workbook = XLSX.read(fileBuffer, {
        type: 'array',
        bookVBA: true,
        bookProps: true
    });

    const props = workbook.Props || {};
    const custProps = workbook.Custprops || {};
    const allSheets = workbook.SheetNames || []; // Safety check
    if (!allSheets || allSheets.length === 0) {
        return {
            moduleName: 'Unknown',
            intent: 'No Sheets Found',
            summary: 'File appears to be empty or corrupted (no sheets).',
            confidence: 'Low',
            hasMacros: false,
            primaryDataSheet: '',
            sheets: [],
            rawMetadata: { props: {}, instructionText: '' }
        };
    }

    // 2. Identify Macros
    const hasMacros = !!(workbook as any).vbaProject || fileName.toLowerCase().endsWith('.xlsm');

    // 3. Extract Module/Object from Document Properties (Most Reliable)
    let moduleNameRaw = props.Subject || custProps['Application'] || '';
    let intent = props.Title || custProps['Document Type'] || '';

    // 4. Scan the Instruction Sheet (The "Source of Truth")
    const instructionSheetName = allSheets.find(n => n.toLowerCase().includes('instruction'));
    let extractedInstructionText = '';

    if (instructionSheetName) {
        const sheet = workbook.Sheets[instructionSheetName];

        // Oracle titles are frequently in A1, B2, or C2
        const textSamples = [sheet['A1']?.v, sheet['B2']?.v, sheet['C2']?.v]
            .filter(v => typeof v === 'string' && v.length > 5);

        // Store first valid text for AI Context
        if (textSamples.length > 0) extractedInstructionText = textSamples[0];

        for (const text of textSamples) {
            // Remove generic boilerplate
            if (text.includes('Fusion') || text.includes('11g')) continue;

            if (!intent) {
                intent = text.replace(/template|import|instructions/gi, '').trim();
            }
        }
    }

    // 5. Interface Sheet Heuristics (The Fallback)
    const dataSheets = allSheets.filter(n => {
        const lower = n.toLowerCase();
        return !lower.includes('instruction') && !lower.includes('reference') && !lower.includes('label') && !lower.includes('note');
    });

    // Prioritize HEADER sheets
    const primarySheet = dataSheets.find(n => n.toUpperCase().includes('HEADER')) || dataSheets[0] || '';

    // If still no module, use sheet prefix
    if (!moduleNameRaw && primarySheet) {
        const parts = primarySheet.split(/[_ ]+/);
        moduleNameRaw = parts[0];

        // If intent is generic, parse sheet name suffixe
        if ((!intent || intent === 'Data Import') && parts.length > 1) {
            const intentParts = parts.filter((p, i) => i !== 0 && !['INTERFACE', 'INT', 'GEN', 'IMPORT', 'HEADERS', 'LINES'].includes(p.toUpperCase()));
            if (intentParts.length > 0) intent = intentParts.join(' ');
        }
    }

    // 6. Final Clean-up & Mapping
    // Map raw codes (e.g. AP) to full names (Payables)
    const modulePrefix = moduleNameRaw ? moduleNameRaw.toUpperCase().split(' ')[0] : '';
    const moduleName = MODULE_PREFIX_MAP[modulePrefix] || moduleNameRaw || 'Oracle Fusion';

    const formattedIntent = intent ?
        intent.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') :
        'Data Import';

    const summary = `${hasMacros ? 'Automated ' : ''}Targeting ${formattedIntent} in the ${moduleName} module via sheet: ${primarySheet || 'None'}.`;

    return {
        moduleName,
        intent: formattedIntent,
        hasMacros,
        summary,
        confidence: (props.Subject || intent.length > 5) ? 'High' : 'Medium',
        primaryDataSheet: primarySheet,
        sheets: dataSheets,
        rawMetadata: {
            props: { ...props, ...custProps },
            instructionText: extractedInstructionText
        }
    };
};
