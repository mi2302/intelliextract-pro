require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB];
const archiver = require('archiver'); // Added archiver

const app = express();
const PORT = 3006;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const { spawn, spawnSync } = require('child_process');
const { processAssistantChatOCI } = require('./services/assistantService');
const dbConfigService = require('./services/dbConfigService');
const fusionConfigService = require('./services/fusionConfigService');


// Middleware
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Storage for templates
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'templates/');
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/\s+/g, '_');
        cb(null, `FBDI_${Date.now()}_${cleanName}`);
    }
});
const upload = multer({ storage });

// Ensure necessary directories exist
const dirs = ['templates', 'temp', 'temp_output'];
dirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Created directory: ${fullPath}`);
    }
});

// Helper to quote Oracle identifiers safely
function quoteIdentifier(id) {
    if (!id || id === '*' || id.toUpperCase() === 'NULL') return id;
    // Removed double quotes to prevent ORA-00904 case-sensitivity exact match errors
    // Instead of forcing exact case match ("COLUMN_NAME"), we let Oracle evaluate normally
    return id;
}

// Enable Thick mode manually
try {
    const instantClientPath = path.join(__dirname, 'instantclient');
    if (fs.existsSync(instantClientPath)) {
        oracledb.initOracleClient({ libDir: instantClientPath });
    } else {
        console.warn('Instant Client not found in server directory, relying on system PATH');
    }
} catch (err) {
    console.error('Failed to initialize Oracle Client:', err);
    process.exit(1);
}

function getDbConfig() {
    const user = (process.env.DB_USER || '').trim();
    const password = (process.env.DB_PASSWORD || '').trim().replace(/^"|"$/g, '');
    const host = (process.env.DB_HOST || '').trim();
    const port = (process.env.DB_PORT || '').trim();
    const service = (process.env.DB_SERVICE_NAME || '').trim();

    if (!user || !password || !host || !port || !service) {
        throw new Error('Missing required database configuration variables (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_SERVICE_NAME).');
    }

    const connectString = `${host}:${port}/${service}`;
    return { user, password, connectString };
}

let dbPool;

async function initializeDatabase() {
    try {
        const data = dbConfigService.getConfigs();
        console.log(`[DB Init] Active Config ID: ${data.activeConfigId}`);
        const { pool } = await dbConfigService.activateConfig(data.activeConfigId, null);
        dbPool = pool;
        console.log('Oracle Connection Pool initialized from saved config');
    } catch (err) {
        console.error('Oracle DB Initialization Error:', err);
        // Fallback to manual if active switch fails? Or exit.
        process.exit(1);
    }
}

// Initialize DB on startup
initializeDatabase();

// --- Database Configuration APIs ---

app.get('/api/db/configs', (req, res) => {
    try {
        const data = dbConfigService.getConfigs();
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/db/configs', async (req, res) => {
    try {
        const data = await dbConfigService.saveConfig(req.body);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/db/configs/:id', async (req, res) => {
    try {
        const data = await dbConfigService.deleteConfig(req.params.id);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/db/test-connection', async (req, res) => {
    try {
        const result = await dbConfigService.testConnection(req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/db/configs/activate', async (req, res) => {
    try {
        const { id } = req.body;
        const { pool, config } = await dbConfigService.activateConfig(id, dbPool);
        dbPool = pool;
        res.json({ success: true, activeConfigId: id, config });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- Fusion Configuration APIs ---

app.get('/api/fusion/configs', async (req, res) => {
    try {
        const configs = await fusionConfigService.getConfigs(dbPool);
        res.json({ success: true, configs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/fusion/configs', async (req, res) => {
    try {
        const result = await fusionConfigService.saveConfig(dbPool, req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/fusion/configs/:id', async (req, res) => {
    try {
        const result = await fusionConfigService.deleteConfig(dbPool, req.params.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- Database Introspection Endpoints ---

/**
 * List all existing tables in the user's schema
 */
app.get('/api/db/tables', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();
        const sql = `SELECT table_name FROM user_tables ORDER BY table_name`;
        const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

        const tables = result.rows.map(r => r.TABLE_NAME);
        res.json({ success: true, tables });
    } catch (error) {
        console.error('Failed to fetch tables:', error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { }
        }
    }
});

/**
 * Get columns and mapped types for a specific table
 */
app.get('/api/db/columns/:tableName', async (req, res) => {
    const { tableName } = req.params;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const sql = `
            SELECT column_name, data_type, data_length, nullable
            FROM user_tab_columns 
            WHERE table_name = upper(:tableName)
            ORDER BY column_id
        `;
        const result = await connection.execute(sql, { tableName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: `Table ${tableName} not found or no columns found.` });
        }

        const columns = result.rows.map(r => {
            // Map Oracle types to internal types
            let type = 'STRING';
            const oracleType = String(r.DATA_TYPE).toUpperCase();

            if (oracleType.includes('NUMBER')) type = 'NUMBER';
            else if (oracleType.includes('DATE') || oracleType.includes('TIMESTAMP')) type = 'DATE';
            else if (oracleType.includes('BOOL')) type = 'BOOLEAN';

            return {
                name: r.COLUMN_NAME,
                type: type,
                oracleType: oracleType,
                nullable: r.NULLABLE === 'Y'
            };
        });

        res.json({ success: true, columns });
    } catch (error) {
        console.error(`Failed to fetch columns for ${tableName}:`, error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { }
        }
    }
});
// initializeDatabase().then(async () => {
//     // Ensure RELATIONSHIPS column exists
//     let connection;
//     try {
//         connection = await dbPool.getConnection();
//         const checkCol = await connection.execute(
//             `SELECT column_name FROM user_tab_columns WHERE table_name = 'XX_INTELLI_MODEL_ARCHITECTURE' AND column_name = 'RELATIONSHIPS'`
//         );
//         if (checkCol.rows.length === 0) {
//             console.log("Adding RELATIONSHIPS column to XX_INTELLI_MODEL_ARCHITECTURE...");
//             await connection.execute(`ALTER TABLE XX_INTELLI_MODEL_ARCHITECTURE ADD (RELATIONSHIPS CLOB)`);
//             await connection.commit();
//             console.log("Column added.");
//         }
//     } catch (err) {
//         console.warn('Failed to check/add RELATIONSHIPS column:', err.message);
//     } finally {
//         if (connection) await connection.close();
//     }
// });

// --- New AI-Based Metadata Fetching Functions ---

async function appendMappingLog(message) {
    try {
        const logPath = path.join(__dirname, 'mapping-discovery.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        await fs.promises.appendFile(logPath, logEntry);
    } catch (err) {
        console.error("Mapping Logger Failed:", err);
    }
}

async function fetchLocalTableMetadata(connection) {
    console.log("[Metadata] Fetching master tables (XXEA_MS) and comments...");
    const sql = `
        SELECT t.table_name, tc.comments
        FROM user_tables t
        LEFT JOIN user_tab_comments tc ON tc.table_name = t.table_name
        WHERE upper(t.table_name) LIKE 'XXEA_MS%'
    `;
    const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(r => ({
        tableName: r.TABLE_NAME,
        comments: r.COMMENTS || ''
    }));
}

/**
 * Fetches ESS Job Parameters (parameter_list.txt) for a given interface table (csvName)
 */
async function fetchJobParameters(connection, csvName) {
    if (!csvName) return [];
    try {
        console.log("[BATCH] Executing xx_dbms_session...");
        await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        console.log(`[PARAMS] Fetching process_name for identifier: ${csvName}`);
        const jobSql = `SELECT process_name FROM xxfw.xxfw_oic_int_mapper WHERE data_identifier = :csvName`;
        const jobRes = await connection.execute(jobSql, { csvName: csvName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        // console.log(jobRes);
        if (jobRes.rows && jobRes.rows.length > 0) {
            const processName = jobRes.rows[0].PROCESS_NAME;
            console.log(`[PARAMS] Found process_name: ${processName}. Fetching entities...`);

            const entitySql = `
                SELECT ENTITY_NAME, ENTITY_TYPE, ENTITY_VALUE, COLUMN_NAME
                FROM xxfw_intelli_dm_taggable_entity_tab 
                WHERE entity_id IN (
                    SELECT DISTINCT entity_id 
                    FROM xxfw.xxfw_dm_tag_mapping_tab 
                    WHERE tag_id = (SELECT tag_id FROM xxfw.xxfw_dm_tag_tab WHERE upper(tag_name) = upper(:processName))
                )
                ORDER BY ENTITY_ID ASC
            `;
            const entityRes = await connection.execute(entitySql, { processName: processName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

            if (entityRes.rows && entityRes.rows.length > 0) {
                console.log(`[PARAMS] Successfully fetched ${entityRes.rows.length} parameters for ${processName}`);
                return entityRes.rows;
            }
        }
        console.log(`[PARAMS] No parameters found for identifier: ${csvName}`);
        return [];
    } catch (err) {
        console.warn(`[PARAMS] Error fetching parameters for ${csvName}:`, err.message);
        return [];
    }
}

/**
 * Resolves parameter values from filters if ENTITY_VALUE is null.
 * Returns an array of parameter sets (each set is an array of strings).
 */
async function resolveParameterSets(connection, parameters, rawFilters, data = [], specColumns = []) {
    if (!parameters || parameters.length === 0) return [];

    let parameterRows = [[]]; // Start with one empty row

    for (const p of parameters) {
        let values = [];

        // Priority 1: Filter Match
        const matchingFilters = (p.COLUMN_NAME && rawFilters) ? rawFilters.filter(f => {
            const parts = f.field.split('.');
            const colName = parts[parts.length - 1].toUpperCase();
            return colName === p.COLUMN_NAME.toUpperCase();
        }) : [];

        if (matchingFilters.length > 0) {
            const resolvedFilterValues = [];
            for (const filter of matchingFilters) {
                if (filter.value) {
                    let filterVal = String(filter.value);
                    let rawVals = (filter.operator === 'IN' || filterVal.includes(','))
                        ? filterVal.split(',').map(v => v.trim()).filter(v => v.length > 0)
                        : [filterVal];

                    for (let val of rawVals) {
                        // Priority 2: Lookup Resolution (if not FREE_TEXT)
                        if (p.ENTITY_TYPE && p.ENTITY_TYPE !== 'FREE_TEXT' && val) {
                            try {
                                const lookupSql = `SELECT lookup_code FROM xxfw.xxfw_dm_lookup_reference WHERE lookup_type = :l_type AND lookup_value = :l_val`;
                                const lookupRes = await connection.execute(lookupSql, { l_type: p.ENTITY_TYPE, l_val: val }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                                if (lookupRes.rows.length > 0) {
                                    val = lookupRes.rows[0].LOOKUP_CODE;
                                }
                            } catch (err) {
                                console.warn(`[PARAMS] Lookup failed for ${p.ENTITY_TYPE}/${val}:`, err.message);
                            }
                        }
                        resolvedFilterValues.push(val);
                    }
                }
            }
            values = resolvedFilterValues.length > 0 ? resolvedFilterValues : [""];
        }
        // Priority 2: Data-Driven Match (If column is mapped in sheet)
        else if (p.COLUMN_NAME && data && data.length > 0 && specColumns && specColumns.length > 0) {
            const colSpec = specColumns.find(c => c.column && c.column.toUpperCase() === p.COLUMN_NAME.toUpperCase());
            if (colSpec) {
                const alias = colSpec.alias;
                const uniqueDataValues = [...new Set(data.map(row => row[alias]).filter(v => v !== null && v !== undefined && v !== ''))];

                if (uniqueDataValues.length > 0) {
                    const resolvedDataValues = [];
                    for (let val of uniqueDataValues) {
                        // If it has a specific entity type (Lookup-based), resolve it
                        if (p.ENTITY_TYPE && p.ENTITY_TYPE !== 'FREE_TEXT') {
                            try {
                                const lookupSql = `SELECT lookup_code FROM xxfw.xxfw_dm_lookup_reference WHERE lookup_type = :l_type AND lookup_value = :l_val`;
                                const lookupRes = await connection.execute(lookupSql, { l_type: p.ENTITY_TYPE, l_val: val }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                                if (lookupRes.rows.length > 0) {
                                    val = lookupRes.rows[0].LOOKUP_CODE;
                                }
                            } catch (err) {
                                console.warn(`[PARAMS] Data Lookup failed for ${p.ENTITY_TYPE}/${val}:`, err.message);
                            }
                        }
                        // If it's FREE_TEXT, we just use the raw value (String(val))
                        resolvedDataValues.push(String(val));
                    }
                    values = resolvedDataValues;
                }
            }
        }
        // Priority 2: Fallback to ENTITY_VALUE
        else if (p.ENTITY_VALUE !== null && p.ENTITY_VALUE !== undefined && p.ENTITY_VALUE !== '' && p.ENTITY_VALUE !== '(null)') {
            values = [p.ENTITY_VALUE];
        }
        // Priority 3: Empty Fallback
        else {
            values = [""];
        }

        // Safety: If somehow values is empty, make it one empty string
        if (values.length === 0) values = [""];

        // Expand parameterRows by the Cartesian product of current values
        const newRows = [];
        for (const row of parameterRows) {
            for (const val of values) {
                newRows.push([...row, val]);
            }
        }
        parameterRows = newRows;
    }

    return parameterRows;
}

async function fetchLocalColumnMetadata(connection, tableName) {
    console.log(`[Metadata] Fetching columns and comments for table: ${tableName}`);
    const sql = `
        SELECT c.column_name, 
               c.data_type, 
               c.nullable, 
               cc.comments
        FROM user_tab_columns c
        LEFT JOIN user_col_comments cc
              ON cc.table_name = c.table_name
             AND cc.column_name = c.column_name
        WHERE c.table_name = :t
        ORDER BY c.column_id
    `;
    const result = await connection.execute(sql, { t: tableName.toUpperCase() }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(r => ({
        columnName: r.COLUMN_NAME,
        dataType: r.DATA_TYPE,
        nullable: r.NULLABLE,
        comments: r.COMMENTS || ''
    }));
}

// Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', datetime: new Date().toISOString() });
});

app.post('/api/fbdi/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    console.log(`[Upload] File received: ${req.file.filename}`);
    res.json({ success: true, filename: req.file.filename });
});

// OCI Service Import
const {
    analyzeFbdiWithOCI,
    smartMapColumnsWithOCI,
    processNlQueryWithOCI,
    rankTablesWithOCI,
    generateEmbeddingsWithOCI,
    analyzeSheetIntentWithOCI,
    uploadTemplateToOCI,
    downloadTemplateFromOCI,
    listTemplatesInOCI
} = require('./services/ociService');

async function searchVectorKnowledge(connection, queryText, sectionName = null, limit = 20, useMetadataTable = false, preGeneratedEmbedding = null) {
    let queryVec;
    try {
        const targetTable = useMetadataTable ? 'INTELLI_FBDI_KNOWLEDGE_VECTOR_METADATA' : 'INTELLI_FBDI_KNOWLEDGE_VECTOR';

        if (preGeneratedEmbedding) {
            queryVec = JSON.stringify(preGeneratedEmbedding);
        } else {
            const q = Array.isArray(queryText) ? queryText.join(' ') : String(queryText || '');
            if (!q.trim()) return [];
            console.log(`[Vector Search] Querying ${targetTable} for: ${q.substring(0, 50)}... (Limit: ${limit})`);
            const embeddings = await generateEmbeddingsWithOCI([q]);
            if (!embeddings || embeddings.length === 0) return [];
            queryVec = JSON.stringify(embeddings[0]);
        }

        let sql = `
            SELECT CONTENT_CHUNK, TEMPLATE_NAME, SHEET_NAME, SECTION_NAME,
                   VECTOR_DISTANCE(EMBEDDING, VECTOR(:v), COSINE) as distance
            FROM ${targetTable}
        `;

        const binds = { v: queryVec };
        if (sectionName) {
            sql += ` WHERE SECTION_NAME = :s `;
            binds.s = sectionName;
        } else if (!useMetadataTable) {
            // Default to searching important metadata sections if no specific section is provided in standard table
            sql += ` WHERE SECTION_NAME IN ('DB_METADATA', 'COLUMN_METADATA', 'TEMPLATE_LEVEL') `;
        }

        sql += ` ORDER BY distance FETCH FIRST :l ROWS ONLY `;
        binds.l = limit;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        // Post-process to extract structured fields for DB metadata
        const rows = result.rows.map(row => {
            const DISTANCE = row.DISTANCE || row.distance;
            const SECTION_NAME = String(row.SECTION_NAME || '');

            // If it's a DB metadata entry (either from special table or DB_METADATA section)
            if (useMetadataTable || SECTION_NAME === 'DB_METADATA') {
                // In DB vectorization, SHEET_NAME stores the TABLE_NAME
                const TABLE_NAME = row.SHEET_NAME;

                // Extract COLUMN_NAME from CONTENT_CHUNK: "Column: NAME."
                let COLUMN_NAME = '';
                const chunk = String(row.CONTENT_CHUNK || '');
                const colMatch = chunk.match(/Column:\s*([A-Z0-9_]+)/i);
                if (colMatch) {
                    COLUMN_NAME = colMatch[1];
                }

                return { ...row, TABLE_NAME, COLUMN_NAME, DISTANCE };
            }
            return { ...row, DISTANCE };
        });

        console.log(`[Vector Search] Found ${rows.length} relevant knowledge snippets from ${targetTable}.`);
        return rows;
    } catch (error) {
        console.error("Vector Search Failed:", error);
        return [];
    }
}

// Helper for Relationship Discovery (FK Lookup)
async function getTableRelationships(connection, tableNames) {
    if (!tableNames || tableNames.length === 0) return [];

    try {
        const inClause = tableNames.map((_, i) => `:t${i}`).join(',');
        const binds = {};
        tableNames.forEach((t, i) => binds[`t${i}`] = t.toUpperCase());

        const sql = `
            SELECT 
                source_table_name as "source_table", 
                source_table_join_column1 as "source_column", 
                target_table_name as "target_table", 
                target_table_join_column1 as "target_column"
            FROM XXEA_DM_TABLE_JOINS
            WHERE source_table_name IN (${inClause}) 
               OR target_table_name IN (${inClause})
        `;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        return result.rows;
    } catch (error) {
        console.warn("FK Relationship Fetch Failed:", error);
        return [];
    }
}

app.get('/api/fbdi/discovery/resolve-relationships', async (req, res) => {
    let connection;
    try {
        const { tables } = req.query;
        if (!tables) return res.status(400).json({ error: "No tables provided" });

        const tableList = String(tables).split(',');
        connection = await dbPool.getConnection();
        const relationships = await getDiscoveredJoins(connection, tableList);
        res.json({ success: true, relationships });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.close();
    }
});

app.post('/api/fbdi/discovery/bottom-up-discovery', async (req, res) => {
    let connection;
    try {
        const { sheetName, headers, headerInfos, moduleName, intent } = req.body;
        if (!headers || !Array.isArray(headers)) {
            return res.status(400).json({ error: "Headers are required" });
        }

        connection = await dbPool.getConnection();
        console.log(`[Bottom-Up Discovery] Starting for sheet: ${sheetName} with ${headers.length} headers. Context: ${moduleName || 'N/A'}, Intent: ${intent || 'N/A'}`);

        // 1. Batch Vector Search for all headers
        // persona sharpening: Focus on specific column signal, exclude broad intent paragraphs
        const queryPersonas = headers.map((h, i) => {
            let persona = `COLUMN: ${h}`;
            if (headerInfos && headerInfos[i]) persona += ` | INFO: ${headerInfos[i]}`;
            // If module is Unknown or N/A, don't pollute the persona with it
            if (moduleName && moduleName.toLowerCase() !== 'unknown' && moduleName.toLowerCase() !== 'n/a') {
                persona += ` | MODULE: ${moduleName}`;
            }
            return persona;
        });

        const synonymMap = {
            'SUPPLIER': ['VENDOR', 'PARTY', 'SUPPLIER'],
            'VENDOR': ['SUPPLIER', 'PARTY', 'VENDOR'],
            'BU': ['BUSINESS UNIT', 'BU', 'OPERATING_UNIT'],
            'ORG': ['ORGANIZATION', 'ORG'],
            'REQ': ['REQUISITION', 'REQ'],
            'PO': ['PURCHASE ORDER', 'PO'],
            'DT': ['DATE', 'DT', 'TIME'],
            'ADDRESS': ['SITE', 'LOCATION', 'PARTY_SITE', 'ADDRESS'],
            'AGENT': ['BUYER', 'PROCUREMENT_OFFICER', 'AGENT'],
            'BUYER': ['AGENT', 'PROCUREMENT_OFFICER', 'BUYER'],
            'QTY': ['QUANTITY', 'VOLUME', 'QTY'],
            'AMT': ['AMOUNT', 'TOTAL', 'VALUE', 'AMT'],
            'UOM': ['UNIT OF MEASURE', 'UNIT', 'UOM'],
            'TAX': ['VAT', 'GST', 'DUTY', 'TAX'],
            'SITE': ['ADDRESS', 'LOCATION', 'PARTY_SITE', 'SITE']
        };

        const getExpandedTerms = (h) => {
            const terms = [h];
            Object.keys(synonymMap).forEach(key => {
                if (h.includes(key)) {
                    synonymMap[key].forEach(s => terms.push(h.replace(key, s)));
                }
            });
            return [...new Set(terms)];
        };

        console.log(`[Bottom-Up Discovery] Generating batch embeddings for ${queryPersonas.length} headers...`);
        const embeddings = await generateEmbeddingsWithOCI(queryPersonas);

        if (!embeddings || embeddings.length < headers.length) {
            throw new Error(`Failed to generate batch embeddings for sheet: ${sheetName}`);
        }

        const candidateTables = new Set();
        const discoveryPromises = headers.map(async (header, i) => {
            const matches = await searchVectorKnowledge(connection, null, null, 10, true, embeddings[i]);

            const info = (headerInfos && headerInfos[i]) ? headerInfos[i] : '';
            const hClean = header.replace(/\*/g, '').replace(/ /g, '').trim().toUpperCase();

            let internalName = '';
            const internalMatch = info.match(/(?:Internal Column|Column Name):\s*([A-Z0-9_]+)/i);
            if (internalMatch) internalName = internalMatch[1].trim().toUpperCase();

            let tableHint = '';
            const tableMatch = info.match(/Associated Table: ([^|]+)/i);
            if (tableMatch) tableHint = tableMatch[1].trim().toUpperCase();

            const moduleHint = (moduleName || '').toUpperCase();

            const reRanked = matches.map(m => {
                let boost = 0;
                let hasNameMatch = false;
                const colName = (m.COLUMN_NAME || '').toUpperCase().replace(/_/g, '');
                const tabName = (m.TABLE_NAME || '').toUpperCase();
                const content = (m.CONTENT_CHUNK || '').toUpperCase();

                const expandedH = getExpandedTerms(hClean);
                const internalMatchClean = internalName ? internalName.replace(/_/g, '') : '';

                const isExactInternal = internalMatchClean && colName === internalMatchClean;
                const isExactSynonym = expandedH.some(term => colName === term.replace(/ /g, '').replace(/_/g, ''));
                const isPartialMatch = expandedH.some(term => {
                    const t = term.replace(/ /g, '').replace(/_/g, '');
                    return colName.includes(t) || t.includes(colName);
                }) || (internalMatchClean && (colName.includes(internalMatchClean) || internalMatchClean.includes(colName)));

                // 1. Technical Accuracy Boost
                if (isExactInternal) {
                    boost += 0.75; // Heavy priority for explicit internal hints
                    hasNameMatch = true;
                } else if (isExactSynonym) {
                    boost += 0.45; // High priority for exact synonym match
                    hasNameMatch = true;
                } else if (isPartialMatch) {
                    boost += 0.15;
                    hasNameMatch = true;
                }

                // 1.5 Keyword Specificity Boost (e.g. NAME vs LINE)
                // This prevents "Address Name" Mapping to "Address Line" just because of semantic similarity
                const headerHasName = hClean.includes('NAME') || (internalName && internalName.includes('NAME'));
                const colHasName = colName.includes('NAME');
                if (headerHasName && colHasName) {
                    boost += 0.12;
                } else if (headerHasName && !colHasName && (colName.includes('LINE') || colName.includes('NUMBER') || colName.includes('ID'))) {
                    boost -= 0.15; // Penalize if header wants a NAME but column is a LINE/NUMBER/ID
                }

                // 2. Strict Number Matching for Attributes
                const hDigitsMatch = hClean.match(/\d+$/);
                const colDigitsMatch = colName.match(/\d+$/);
                if (hDigitsMatch || colDigitsMatch) {
                    const hDigits = hDigitsMatch ? hDigitsMatch[0] : null;
                    const colDigits = colDigitsMatch ? colDigitsMatch[0] : null;

                    if (hDigits !== colDigits && (hClean.includes('ATTRIBUTE') || colName.includes('ATTRIBUTE'))) {
                        boost -= 0.70; // Heavy penalty for digit mismatch
                    }
                }

                // 3. Prefix Prioritization for Attributes
                if (hClean.startsWith('ATTRIBUTE') && colName.startsWith('ATTRIBUTE')) {
                    boost += 0.10;
                } else if (hClean.startsWith('ATTRIBUTE') && !colName.startsWith('ATTRIBUTE')) {
                    boost -= 0.10; // Penalize suffixed attributes like PJC_RESERVED_ATTRIBUTE
                }

                // 4. Strict Attribute/Global Guard
                const isGlobalHeader = hClean.includes('GLOBAL') || (internalName && internalName.includes('GLOBAL'));
                const isGlobalColumn = colName.includes('GLOBAL');
                if (isGlobalHeader !== isGlobalColumn && (hClean.includes('ATTRIBUTE') || colName.includes('ATTRIBUTE'))) {
                    boost -= 0.60;
                }

                // 5. Timestamp Guard
                const isTimestampHeader = hClean.includes('TIMESTAMP') || (internalName && internalName.includes('TIMESTAMP'));
                const isTimestampColumn = colName.includes('TIMESTAMP');
                if (isTimestampHeader !== isTimestampColumn && (hClean.includes('ATTRIBUTE') || colName.includes('ATTRIBUTE'))) {
                    boost -= 0.60;
                }

                // 6. Intent & Table Hint Boost
                if (tableHint && tabName === tableHint) {
                    boost += 0.40;
                }

                if (moduleHint && moduleHint !== 'UNKNOWN' && moduleHint !== 'N/A') {
                    const keywords = [moduleHint];
                    if (moduleHint.includes('SUPPLIER')) {
                        keywords.push('POZ', 'SUPPLIER', 'VENDOR');
                        if (tabName.startsWith('POZ_')) boost += 0.25;
                    }
                    if (moduleHint.includes('PROCUREMENT') || moduleHint.includes('PURCHASING') || moduleHint.includes('ORDER')) {
                        keywords.push('PO', 'PURCHASE', 'ORDER');
                        if (tabName.startsWith('PO_')) boost += 0.25;
                    }
                    if (moduleHint.includes('PAYABLES') || moduleHint.includes('INVOICE')) {
                        keywords.push('AP', 'INVOICE', 'PAYABLE');
                        if (tabName.startsWith('AP_')) boost += 0.25;
                    }

                    if (keywords.some(k => content.includes(k) || tabName.includes(k))) {
                        boost += 0.12;
                    }
                }

                if (tabName.startsWith('XXEA_MS_')) boost += 0.05;

                let finalDistance = m.DISTANCE - boost;
                if (!hasNameMatch && m.DISTANCE > 0.45) finalDistance = 1.0;

                return {
                    tableName: m.TABLE_NAME || '',
                    columnName: m.COLUMN_NAME || '',
                    content: m.CONTENT_CHUNK,
                    distance: Math.max(0, finalDistance),
                    originalDistance: m.DISTANCE
                };
            }).filter(m => m.distance < 0.65)
                .sort((a, b) => a.distance - b.distance);

            reRanked.slice(0, 5).forEach(m => {
                if (m.tableName) candidateTables.add(m.tableName);
            });

            return {
                header,
                idx: i,
                matches: reRanked.slice(0, 5)
            };
        });

        const discoveries = await Promise.all(discoveryPromises);

        // 2. AI-Driven Table Intent Ranking
        // This helps the frontend prioritize tables that functionally match the sheet's intent
        console.log(`[Bottom-Up Discovery] Ranking candidate tables by AI intent...`);

        // NEW: Functional Intent Analysis
        let sheetAnalysis = null;
        try {
            sheetAnalysis = await analyzeSheetIntentWithOCI(sheetName, headers, moduleName);
            console.log(`[Bottom-Up Discovery] Sheet Functional Role: ${sheetAnalysis.functionalRole || 'N/A'}`);
        } catch (analysisErr) {
            console.warn(`[Bottom-Up Discovery] Intent Analysis failed:`, analysisErr.message);
        }

        const tablesForRanking = Array.from(candidateTables).map(t => ({ tableName: t, comments: '' }));
        let aiRankedTables = [];
        try {
            // Use the functionalRole from analysis as the primary intent if available
            const rankingIntent = (sheetAnalysis && sheetAnalysis.functionalRole) ? sheetAnalysis.functionalRole : (intent || sheetName);

            aiRankedTables = await rankTablesWithOCI(rankingIntent, tablesForRanking, {
                moduleName,
                sheetNames: [sheetName],
                globalIntent: intent, // Pass the overall template intent
                coreTablePattern: sheetAnalysis?.coreTablePattern,
                subObjectType: sheetAnalysis?.subObjectType,
                reasoning: sheetAnalysis?.reasoning
            });

            // If the analysis provided a specific table pattern (e.g., PO_LINE_LOCATIONS_ALL), 
            // ensure it's prioritized if it exists in candidate tables but was missed by ranking.
            if (sheetAnalysis && sheetAnalysis.coreTablePattern && !aiRankedTables.includes(sheetAnalysis.coreTablePattern)) {
                if (Array.from(candidateTables).includes(sheetAnalysis.coreTablePattern)) {
                    aiRankedTables.unshift(sheetAnalysis.coreTablePattern);
                }
            }
        } catch (rankErr) {
            console.warn(`[Bottom-Up Discovery] AI Table Ranking failed:`, rankErr.message);
        }

        const tablesList = Array.from(candidateTables);
        console.log(`[Bottom-Up Discovery] Found ${tablesList.length} candidate tables. Relationships deferred.`);

        res.json({
            success: true,
            sheetName,
            sheetAnalysis, // Include for visibility in browser
            discoveries,
            candidateTables: aiRankedTables,
            aiRankedTables: aiRankedTables,
            relationships: [] // Deferred for performance
        });

    } catch (error) {
        console.error("Bottom-Up Discovery Failed:", error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.close();
    }
});

app.get('/api/fbdi/discovery/table-details', async (req, res) => {
    let connection;
    try {
        const { tables } = req.query;
        if (!tables) return res.status(400).json({ error: "No tables provided" });

        const tableList = String(tables).split(',');
        console.log(`[Table Hydration] Fetching full metadata for ${tableList.length} tables:`, tableList.join(', '));

        const inClause = tableList.map((_, i) => `:t${i}`).join(',');
        const binds = {};
        tableList.forEach((t, i) => binds[`t${i}`] = t.toUpperCase());

        connection = await dbPool.getConnection();
        const start = Date.now();

        // Simple query: Just basic column details from USER_TAB_COLUMNS
        const sql = `
            SELECT 
                table_name as "tableName",
                column_name as "columnName",
                data_type as "dataType",
                nullable as "isNullable"
            FROM user_tab_columns
            WHERE table_name IN (${inClause})
            ORDER BY table_name, column_id
        `;

        const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`[Table Hydration] Fetched ${result.rows.length} columns in ${Date.now() - start}ms`);

        // Helper to map Oracle types to Frontend simplified types
        const mapType = (oraType) => {
            const t = String(oraType).toUpperCase();
            if (t.includes('CHAR') || t.includes('CLOB')) return 'STRING';
            if (t.includes('NUMBER') || t.includes('FLOAT') || t.includes('DOUBLE')) return 'NUMBER';
            if (t.includes('DATE') || t.includes('TIMESTAMP')) return 'DATE';
            return 'STRING';
        };

        // Group by table in DataObject format
        const grouped = result.rows.reduce((acc, row) => {
            const tableName = row.tableName;
            if (!acc[tableName]) {
                acc[tableName] = {
                    id: tableName,
                    // name: tableName,
                    name: toTitleCase(tableName),
                    tableName: tableName,
                    fields: []
                };
            }
            acc[tableName].fields.push({
                name: row.columnName,
                type: mapType(row.dataType),
                description: `${row.dataType}${row.isNullable === 'N' ? ' [REQ]' : ''}`
            });
            return acc;
        }, {});

        res.json({ success: true, objects: Object.values(grouped) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) await connection.close();
    }
});

app.post('/api/fbdi/analyze-fbdi', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();
        console.log("Analyzing FBDI via OCI:", req.body.fileName);

        // Perform Vector Search for context
        const queryText = `Analyze FBDI for: ${req.body.fileName} ${(req.body.sheetNames || []).join(' ')}. Instructions: ${req.body.instructions || ''}`;
        const knowledge = await searchVectorKnowledge(connection, queryText);
        const knowledgeText = knowledge.map(k => k.CONTENT_CHUNK).join('\n---\n');

        // Pass metadata and candidates to OCI for matching
        const result = await analyzeFbdiWithOCI({
            ...req.body,
            candidateGroups: [],
            priorKnowledge: knowledgeText
        });
        res.json(result);
    } catch (error) {
        console.error("OCI Analysis Error:", error);
        res.status(500).json({
            error: "AI Analysis Failed",
            details: error.message,
            moduleName: "Unknown",
            intent: "Unknown",
            confidence: "Low"
        });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
});

app.post('/api/fbdi/knowledge/enrich-template', async (req, res) => {
    const { templateName, productFamily, moduleName, intent, instructions, sheetDetails } = req.body;
    // console.log("Template Name: ", templateName)
    // console.log("Product Family: ", productFamily)
    // console.log("Module Name: ", moduleName)
    // console.log("Intent: ", intent)
    // console.log("Instructions: ", instructions)
    // console.log("Sheet Details: ", sheetDetails)
    let connection;
    try {
        console.log(`[Knowledge Enrichment] Starting enrichment for template: ${templateName}`);
        connection = await dbPool.getConnection();

        const chunks = [];

        // 1. Template Level Chunk
        let templateContext = `Template: ${templateName}\nProduct Family: ${productFamily || 'Oracle Fusion'}\nModule: ${moduleName || 'N/A'}\nIntent: ${intent || 'N/A'}`;
        if (instructions) {
            templateContext += `\nInstructions: ${instructions.substring(0, 1000)}`;
        }
        chunks.push({
            sheet: 'Template-Level',
            section: 'TEMPLATE_LEVEL',
            content: templateContext
        });

        // 2. Sheet & Column Level Chunks
        if (sheetDetails && Array.isArray(sheetDetails)) {
            sheetDetails.forEach(sheet => {
                // Sheet Level Chunk
                chunks.push({
                    sheet: sheet.name,
                    section: 'SHEET_LEVEL',
                    content: `Template: ${templateName}\nModule: ${moduleName}\nSheet: ${sheet.name}\nDescription: ${sheet.description || 'N/A'}`
                });

                // Column Level Chunks
                if (sheet.headers && Array.isArray(sheet.headers)) {
                    sheet.headers.forEach((header, idx) => {
                        const info = (sheet.headerInfos && sheet.headerInfos[idx]) ? sheet.headerInfos[idx] : '';
                        const sample = (sheet.sampleRows && sheet.sampleRows[0] && sheet.sampleRows[0][idx]) ? sheet.sampleRows[0][idx] : '';

                        let colContextArr = [
                            `Chunk Type: COLUMN_METADATA`,
                            `Template: ${templateName}`,
                            `Module: ${moduleName}`,
                            `Sheet: ${sheet.name}`,
                            `Header: ${header}`
                        ];

                        if (info) {
                            const infoParts = info.split(' | ');
                            infoParts.forEach(part => {
                                colContextArr.push(part);
                            });
                        }

                        if (sample) colContextArr.push(`Example Data: ${sample}`);

                        const colContext = colContextArr.join('\n');

                        chunks.push({
                            sheet: sheet.name,
                            section: 'COLUMN_METADATA',
                            content: colContext
                        });
                    });
                }
            });
        }

        console.log(`[Knowledge Enrichment] Generated ${chunks.length} chunks. Vectorizing...`);

        // Batch processing for embeddings
        const bSize = 15;
        for (let i = 0; i < chunks.length; i += bSize) {
            const batch = chunks.slice(i, i + bSize);
            const batchTexts = batch.map(c => c.content);
            const embeddings = await generateEmbeddingsWithOCI(batchTexts);

            if (embeddings) {
                for (let j = 0; j < batch.length; j++) {
                    const chunk = batch[j];
                    const vec = JSON.stringify(embeddings[j]);
                    const sql = `
                        INSERT INTO INTELLI_FBDI_KNOWLEDGE_VECTOR 
                        (ID, TEMPLATE_NAME, SHEET_NAME, SECTION_NAME, CONTENT_CHUNK, EMBEDDING, CREATED_AT)
                        VALUES (XX_INTELLI_MODEL_EXT_SEQ.NEXTVAL, :t, :s, :sec, :c, VECTOR(:v), CURRENT_TIMESTAMP)
                    `;
                    try {
                        await connection.execute(sql, {
                            t: templateName,
                            s: chunk.sheet,
                            sec: chunk.section,
                            c: chunk.content,
                            v: vec
                        }, { autoCommit: true });
                    } catch (e) {
                        // Skip duplicates if necessary, but here we likely want all context
                        console.warn(`[Knowledge Enrichment] Insert failed for chunk:`, e.message);
                    }
                }
            }
        }

        res.json({ success: true, message: `Enriched vector store with ${chunks.length} metadata chunks.` });
    } catch (error) {
        console.error("Knowledge Enrichment Failed:", error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
});

app.post('/api/fbdi/nl-query', async (req, res) => {
    try {
        const { query, metadata } = req.body;
        console.log("[OCI NL Query] Processing:", query);
        const result = await processNlQueryWithOCI(query, metadata);
        res.json(result);
    } catch (error) {
        console.error("OCI NL Query Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/fbdi/suggest-transformations', async (req, res) => {
    try {
        const { columnName, sourceField, dataType, moduleContext } = req.body;
        console.log(`[OCI Suggest] Suggesting for: ${columnName} (Type: ${dataType})`);
        const { suggestTransformationsWithOCI } = require('./services/ociService');
        const suggestions = await suggestTransformationsWithOCI(columnName, sourceField, dataType, moduleContext);
        res.json(suggestions);
    } catch (error) {
        console.error("Suggest Transformations Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/fbdi/modules', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();

        const result = await connection.execute(
            `SELECT DISTINCT DATA_GROUP AS GROUP_NAME FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING WHERE DATA_GROUP IS NOT NULL ORDER BY DATA_GROUP`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json(result.rows.map(r => r.GROUP_NAME));
    } catch (err) {
        console.error('Error fetching groups:', err);
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
});

app.get('/api/db-check', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();
        const result = await connection.execute('SELECT sysdate FROM DUAL');
        res.json({ status: 'connected', database: 'oracle', result: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(err);
            }
        }
    }
});

app.post('/api/fusion/test-connection', async (req, res) => {
    const { url, username, password } = req.body;

    if (!url || !username || !password) {
        return res.status(400).json({ success: false, message: 'URL, Username, and Password are required.' });
    }

    // Clean URL
    let baseUrl = url.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    // Construct standard User Profile endpoint
    const testUrl = `${baseUrl}/fscmRestApi/resources/11.13.18.05/announcements/describe`;

    console.log(`[Fusion Auth] Testing connection for user: ${username} at ${testUrl}`);

    try {
        const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const response = await axios.get(testUrl, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 second timeout
        });

        if (response.status === 200) {
            console.log(`[Fusion Auth] Success: Connection verified for ${username}`);
            return res.json({ success: true, message: 'Successfully authenticated with Oracle Fusion.' });
        } else {
            console.warn(`[Fusion Auth] Unexpected status: ${response.status}`);
            return res.status(response.status).json({ success: false, message: `Unexpected response from Fusion: ${response.status}` });
        }
    } catch (error) {
        console.error(`[Fusion Auth] Failed:`, error.message);
        let errorMsg = error.message;
        if (error.response) {
            if (error.response.status === 401) {
                errorMsg = 'Invalid credentials. Please check your username and password.';
            } else if (error.response.status === 403) {
                errorMsg = 'Forbidden: User does not have permission to access the User Profiles API.';
            } else {
                errorMsg = `Fusion API Error (${error.response.status}): ${error.response.statusText}`;
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            errorMsg = 'Could not reach the Fusion host. Please check the URL.';
        } else if (error.code === 'ETIMEDOUT') {
            errorMsg = 'Connection timed out. Fusion instance might be slow or unreachable.';
        }

        res.status(error.response?.status || 500).json({
            success: false,
            message: errorMsg
        });
    }
});

app.post('/api/fusion/load-to-interface', async (req, res) => {
    const { url, username, password, fileName } = req.body;

    if (!url || !username || !password || !fileName) {
        return res.status(400).json({ success: false, message: 'URL, Username, Password, and FileName are required.' });
    }

    console.log(`[Fusion Load] Initiating load for ${fileName} to ${url}`);

    let connection;
    let resolvedJobName = "InterfaceLoaderController"; // Default/Fallback
    let fusionUrl = "Pending...";
    let payload = null;

    try {
        // 1. Locate the file
        const actualPath = fs.existsSync(path.join(__dirname, 'templates', fileName))
            ? path.join(__dirname, 'templates', fileName)
            : path.join(__dirname, 'temp', fileName);

        if (!fs.existsSync(actualPath)) {
            return res.status(404).json({ success: false, message: `File ${fileName} not found on server.` });
        }

        // 2. Identify JOB NAME from ZIP contents (SQL Lookup)
        let interfaceDetails = "";

        const listZipScript = path.join(__dirname, 'scripts', 'list_zip_contents.py');
        const listResult = spawnSync('python', [listZipScript, actualPath]);
        if (listResult.status === 0) {
            const output = JSON.parse(listResult.stdout.toString());
            if (output.success && output.files.length > 0) {
                // Find first CSV or any CSV
                const csvFile = output.files.find(f => f.toLowerCase().endsWith('.csv'));
                if (csvFile) {
                    const csvNameOnly = csvFile.replace(/\.csv$/i, '');
                    console.log(`[Fusion Load] Found CSV in ZIP: ${csvFile}. Looking up process name for: ${csvNameOnly}...`);

                    connection = await dbPool.getConnection();
                    // Initialize session context
                    await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
                    const sql = `SELECT process_name FROM xxfw.xxfw_oic_int_mapper WHERE data_identifier = :csvName`;
                    const dbResult = await connection.execute(sql, { csvName: csvNameOnly }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                    if (dbResult.rows && dbResult.rows.length > 0) {
                        resolvedJobName = dbResult.rows[0].PROCESS_NAME;
                        console.log(`[Fusion Load] Resolved Job Name: ${resolvedJobName}`);
                    } else {
                        console.warn(`[Fusion Load] No mapping found for ${csvFile} in xxfw_oic_int_mapper.`);
                    }
                }
            }
        }

        // 3. Read and Base64 encode
        const fileBuffer = fs.readFileSync(actualPath);
        const base64File = fileBuffer.toString('base64');

        // 4. Prepare Fusion API Request
        let baseUrl = url.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        const fusionUrl = `${baseUrl}/fscmRestApi/resources/11.13.18.05/erpintegrations`;

        payload = {
            OperationName: "loadAndImportData",
            jobName: resolvedJobName,
            interfaceDetails: interfaceDetails,
            notificationCode: "10",
            fileContent: base64File,
            fileName: fileName,
            contentType: "zip"
        };

        const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        console.log(`[Fusion Auth] Preparing Authorization header for user: ${username}`);
        console.log(`[Fusion Load] Calling ERP Integration API at: ${fusionUrl}`);

        const response = await axios.post(fusionUrl, payload, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        if (response.status === 201 || response.status === 200) {
            const result = response.data;
            return res.json({
                success: true,
                message: `Data load requested successfully.`,
                jobName: resolvedJobName,
                fusionUrl: fusionUrl,
                payload: { ...payload, fileContent: "[REDACTED]" },
                jobId: result.JobId || result.requestId,
                details: result
            });
        } else {
            return res.status(response.status).json({
                success: false,
                message: `Fusion API Error (${response.status})`,
                jobName: resolvedJobName,
                fusionUrl: fusionUrl,
                payload: { ...payload, fileContent: "[REDACTED]" },
                details: response.data
            });
        }
    } catch (error) {
        console.error(`[Fusion Load] Failed:`, error.message);
        let detailedMessage = error.message;
        if (error.response && error.response.data) {
            detailedMessage = typeof error.response.data === 'object'
                ? JSON.stringify(error.response.data)
                : error.response.data;
        }
        res.status(error.response?.status || 500).json({
            success: false,
            message: `Request Failed: ${error.message}`,
            jobName: resolvedJobName || "Unknown",
            fusionUrl: fusionUrl || "Unknown",
            payload: payload ? { ...payload, fileContent: "[REDACTED]" } : { fileContent: "[REDACTED]" },
            details: detailedMessage
        });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { }
        }
    }
});

app.post('/api/fusion/upload-to-ucm', async (req, res) => {
    const { url, username, password, fileName } = req.body;

    if (!url || !username || !password || !fileName) {
        return res.status(400).json({ success: false, message: 'URL, Username, Password, and FileName are required.' });
    }

    console.log(`[Fusion UCM] Initiating upload for ${fileName} to ${url}`);

    let connection;
    let resolvedJobName = "Unknown";
    let documentAccount = "fin$/payables$/import$"; // Default
    let fusionUrl = "Pending...";
    let payload = null;

    try {
        const actualPath = fs.existsSync(path.join(__dirname, 'templates', fileName))
            ? path.join(__dirname, 'templates', fileName)
            : path.join(__dirname, 'temp', fileName);

        if (!fs.existsSync(actualPath)) {
            return res.status(404).json({ success: false, message: `File ${fileName} not found on server.` });
        }

        // 1. Resolve Job Name and Document Account
        const listZipScript = path.join(__dirname, 'scripts', 'list_zip_contents.py');
        const listResult = spawnSync('python', [listZipScript, actualPath]);

        if (listResult.status === 0) {
            const output = JSON.parse(listResult.stdout.toString());
            const csvFile = output.success ? output.files.find(f => f.toLowerCase().endsWith('.csv')) : null;

            if (csvFile) {
                const csvNameOnly = csvFile.replace(/\.csv$/i, '');
                connection = await dbPool.getConnection();

                // Initialize session
                await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);

                // A. Resolve Job Name
                const jobSql = `SELECT process_name FROM xxfw.xxfw_oic_int_mapper WHERE data_identifier = :csvName`;
                const jobRes = await connection.execute(jobSql, { csvName: csvNameOnly }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                if (jobRes.rows && jobRes.rows.length > 0) {
                    resolvedJobName = jobRes.rows[0].PROCESS_NAME;

                    // B. Resolve UCM Account
                    const accountSql = `SELECT ucm_account_name FROM xxfw.XXFW_FUS_ESS_IMPORT_JOB_DETAILS WHERE upper(job_definition_display_name) = upper(:jobName)`;
                    const accRes = await connection.execute(accountSql, { jobName: resolvedJobName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                    if (accRes.rows && accRes.rows.length > 0) {
                        documentAccount = accRes.rows[0].UCM_ACCOUNT_NAME;
                    }
                }
            }
        }

        // 2. Read and Base64 encode
        const fileBuffer = fs.readFileSync(actualPath);
        const base64File = fileBuffer.toString('base64');
        // 3. Prepare Fusion API Request
        let baseUrl = url.trim();
        const urlMatch = baseUrl.match(/^(https?:\/\/[^\/]+)/i);
        if (urlMatch) {
            baseUrl = urlMatch[1];
        } else if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        fusionUrl = `${baseUrl}/fscmRestApi/resources/11.13.18.05/erpintegrations`;

        payload = {
            OperationName: "uploadFileToUCM",
            FileName: fileName,
            ContentType: "zip",
            DocumentContent: base64File,
            DocumentAccount: documentAccount,
            DocumentId: null
        };

        const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        console.log(`[Fusion UCM] Initiating upload for ${fileName} to ${fusionUrl}`);

        const response = await axios.post(fusionUrl, payload, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        if (response.status === 201 || response.status === 200) {
            return res.json({
                success: true,
                message: `File uploaded to UCM successfully.`,
                documentId: response.data.DocumentId,
                documentAccount: documentAccount,
                jobName: resolvedJobName,
                fusionUrl: fusionUrl,
                payload: { ...payload },
                details: response.data
            });
        } else {
            return res.status(response.status).json({
                success: false,
                message: `Fusion UCM Error (${response.status})`,
                payload: { ...payload },
                details: response.data
            });
        }
    } catch (error) {
        console.error(`[Fusion UCM] Failed:`, error.message);
        let detailedMessage = error.message;
        if (error.response && error.response.data) {
            detailedMessage = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data;
        }
        res.status(error.response?.status || 500).json({
            success: false,
            message: `UCM Upload Failed: ${error.message}`,
            payload: payload ? { ...payload } : null,
            details: detailedMessage
        });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { }
        }
    }
});

app.get('/api/fusion/get-ess-metadata', async (req, res) => {
    const { jobName } = req.query;
    if (!jobName) return res.status(400).json({ success: false, message: 'jobName is required' });

    let connection;
    try {
        connection = await dbPool.getConnection();
        const sql = `
            SELECT INTERFACE_OPERATION_NAME, INTERFACE_JOB_PACKAGE_NAME, INTERFACE_JOBDEFNAME, INTERFACE_ESS_PARAMETERS,
                   SUBMIT_ESS_OPERATION_NAME, SUBMIT_ESS_JOB_PACKAGE_NAME, SUBMIT_ESS_JOBDEFNAME
            FROM xxfw.XXFW_SUBMIT_ESS_JOB_PARAMETERS 
            WHERE upper(job_display_name) = upper(:jobName)
        `;
        const result = await connection.execute(sql, { jobName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        if (result.rows && result.rows.length > 0) {
            res.json({ success: true, metadata: result.rows[0] });
        } else {
            res.status(404).json({ success: false, message: `No metadata found for ${jobName}` });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) { try { await connection.close(); } catch (e) { } }
    }
});

app.get('/api/fusion/get-parameter-rows', async (req, res) => {
    const { fileName } = req.query;
    if (!fileName) return res.status(400).json({ success: false, message: 'fileName is required' });

    try {
        const actualPath = path.join(__dirname, 'templates', fileName);
        const scriptPath = path.join(__dirname, 'scripts', 'read_properties.py');
        const pythonProcess = spawnSync('python', [scriptPath, actualPath]);
        const propertiesContent = pythonProcess.stdout.toString();

        if (propertiesContent && !propertiesContent.startsWith('Error:')) {
            const lines = propertiesContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            res.json({ success: true, rows: lines });
        } else {
            res.status(400).json({ success: false, message: propertiesContent || 'No parameters found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/fusion/submit-ess-job', async (req, res) => {
    const { url, username, password, payload } = req.body;
    if (!url || !username || !password || !payload) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        let baseUrl = url.trim();
        const urlMatch = baseUrl.match(/^(https?:\/\/[^\/]+)/i);
        if (urlMatch) baseUrl = urlMatch[1];

        const fusionUrl = `${baseUrl}/fscmRestApi/resources/11.13.18.05/erpintegrations`;
        const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

        const response = await axios.post(fusionUrl, payload, {
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            timeout: 60000
        });

        res.json({ success: true, result: response.data });
    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            message: error.message,
            details: error.response?.data
        });
    }
});

app.get('/api/fusion/job-status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { url, username, password } = req.query;

    if (!url || !username || !password || !jobId) {
        return res.status(400).json({ success: false, message: 'URL, Username, Password, and JobId are required.' });
    }

    try {
        let baseUrl = url.trim();
        // SANITIZE: extract only the base domain
        const urlMatch = baseUrl.match(/^(https?:\/\/[^\/]+)/i);
        if (urlMatch) {
            baseUrl = urlMatch[1];
        } else if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        // Finder-based status check for erpintegrations
        const statusUrl = `${baseUrl}/fscmRestApi/resources/11.13.18.05/erpintegrations?finder=ESSJobStatusRF;requestId=${jobId}`;

        console.log(`[Fusion Status] Checking status for Job ${jobId} at ${statusUrl}`);

        const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const response = await axios.get(statusUrl, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200) {
            // The response usually contains an items array with the job status details
            const items = response.data.items || [];
            if (items.length > 0) {
                const jobInfo = items[0];
                return res.json({
                    success: true,
                    status: jobInfo.RequestStatus || jobInfo.Status || jobInfo.jobStatus || 'UNKNOWN',
                    details: jobInfo
                });
            } else {
                return res.json({ success: true, status: 'NOT_FOUND', message: 'Job ID not found in Fusion yet.' });
            }
        } else {
            return res.status(response.status).json({ success: false, message: `Fusion Status Error (${response.status})` });
        }
    } catch (error) {
        console.error(`[Fusion Status] Failed:`, error.message);
        res.status(error.response?.status || 500).json({ success: false, message: error.message });
    }
});

// Helper to fetch and filter mappings using the same logic for both endpoints

async function getDiscoveredJoins(connection, tables) {
    if (!tables || tables.length < 2) return [];

    try {
        console.log(`[Join Discovery] Checking for valid joins (Direct & Indirect) between: ${tables.join(', ')}`);

        // 1. Fetch ALL known relationships to build a complete graph
        const allRelationsSql = `
            SELECT 
                SOURCE_TABLE_NAME, SOURCE_TABLE_JOIN_COLUMN1, SOURCE_TABLE_JOIN_COLUMN2,
                TARGET_TABLE_NAME, TARGET_TABLE_JOIN_COLUMN1, TARGET_TABLE_JOIN_COLUMN2
            FROM XXEA_DM_TABLE_JOINS
        `;
        const relResult = await connection.execute(allRelationsSql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const allRelations = relResult.rows;

        // 2. Build Adjacency List for the Graph
        const graph = {};
        allRelations.forEach(rel => {
            const src = (rel.SOURCE_TABLE_NAME || '').toUpperCase();
            const tgt = (rel.TARGET_TABLE_NAME || '').toUpperCase();
            if (!src || !tgt) return;

            if (!graph[src]) graph[src] = [];
            if (!graph[tgt]) graph[tgt] = [];

            graph[src].push({ to: tgt, rel });
            graph[tgt].push({ to: src, rel }); // Bidirectional for pathfinding
        });

        // 3. Pathfinding (BFS) to connect all tables in the input list
        const rootTable = tables[0].toUpperCase();
        const finalJoins = [];
        const visitedTables = new Set([rootTable]);
        const tablesToConnect = tables.slice(1).map(t => t.toUpperCase());

        for (const targetTable of tablesToConnect) {
            if (visitedTables.has(targetTable)) continue;

            // BFS to find path from ANY already connected table to this targetTable
            const queue = [];
            const parentMap = new Map();

            visitedTables.forEach(t => queue.push(t));

            let foundPath = false;
            let current = null;

            while (queue.length > 0) {
                current = queue.shift();
                if (current === targetTable) {
                    foundPath = true;
                    break;
                }

                const neighbors = graph[current] || [];
                for (const neighbor of neighbors) {
                    if (!parentMap.has(neighbor.to) && !visitedTables.has(neighbor.to)) {
                        parentMap.set(neighbor.to, { from: current, rel: neighbor.rel });
                        queue.push(neighbor.to);
                    } else if (neighbor.to === targetTable && !parentMap.has(neighbor.to)) {
                        parentMap.set(neighbor.to, { from: current, rel: neighbor.rel });
                        foundPath = true;
                        break;
                    }
                }
                if (foundPath) break;
            }

            if (foundPath) {
                let pathNode = targetTable;
                while (parentMap.has(pathNode)) {
                    const entry = parentMap.get(pathNode);
                    const rel = entry.rel;

                    const srcTbl = rel.SOURCE_TABLE_NAME;
                    const tgtTbl = rel.TARGET_TABLE_NAME;
                    const srcCol1 = rel.SOURCE_TABLE_JOIN_COLUMN1;
                    const tgtCol1 = rel.TARGET_TABLE_JOIN_COLUMN1;
                    const srcCol2 = rel.SOURCE_TABLE_JOIN_COLUMN2;
                    const tgtCol2 = rel.TARGET_TABLE_JOIN_COLUMN2;

                    let condition = `${srcTbl}.${srcCol1} = ${tgtTbl}.${tgtCol1}`;
                    if (srcCol2 && tgtCol2) {
                        condition += ` AND ${srcTbl}.${srcCol2} = ${tgtTbl}.${tgtCol2}`;
                    }

                    const joinKey = [srcTbl, tgtTbl].sort().join('-');
                    if (!finalJoins.some(j => [j.sourceObjectId.toUpperCase(), j.targetObjectId.toUpperCase()].sort().join('-') === joinKey)) {
                        finalJoins.push({
                            sourceObjectId: srcTbl,
                            targetObjectId: tgtTbl,
                            joinType: 'INNER',
                            condition: condition
                        });
                    }

                    visitedTables.add(pathNode);
                    pathNode = entry.from;
                }
            } else {
                console.warn(`[Join Discovery] No path found to connect table: ${targetTable}`);
            }
        }

        console.log(`[Join Discovery] Successfully discovered ${finalJoins.length} joins.`);
        return finalJoins;
    } catch (err) {
        console.error('[Join Discovery] Pathfinding Failed:', err.message);
        return [];
    }
}


async function getFilteredMappings(connection, { moduleName, sheetNames, analysisModuleName, unmappedHeaders, instructions, intent, sheetDetails }) {
    console.log("[getFilteredMappings] Received intent:", intent);
    console.log("[getFilteredMappings] Received analysisModuleName:", analysisModuleName);
    console.log("[getFilteredMappings] Starting AI-based mapping discovery...");

    try {
        await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
    } catch (sessionErr) { }

    let businessIntent = '';
    if (intent && String(intent).trim().length > 0) {
        businessIntent = String(intent);
    } else if (Array.isArray(analysisModuleName) && analysisModuleName.length > 0) {
        businessIntent = analysisModuleName.join(' ');
    } else if (analysisModuleName) {
        businessIntent = String(analysisModuleName);
    } else {
        businessIntent = String(moduleName || (sheetNames ? sheetNames[0] : 'Unknown Business Object'));
    }

    console.log(`[AI Mapping] Final search intent: ${businessIntent}`);
    await appendMappingLog(`--- New Mapping Discovery Session ---`);
    await appendMappingLog(`Business Intent: ${businessIntent}`);

    // NEW: Intent Augmentation
    let sheetAnalysis = null;
    try {
        const sampleHeaders = unmappedHeaders ? (Array.isArray(unmappedHeaders) ? unmappedHeaders : Object.values(unmappedHeaders).flat()) : [];
        sheetAnalysis = await analyzeSheetIntentWithOCI(businessIntent, sampleHeaders, moduleName);
        if (sheetAnalysis && sheetAnalysis.functionalRole) {
            console.log(`[AI Mapping] Augmented Intent: ${sheetAnalysis.functionalRole}`);
            businessIntent = sheetAnalysis.functionalRole;
        }
    } catch (e) {
        console.warn("[AI Mapping] Intent Augmentation failed:", e.message);
    }

    const knowledgeVec = await searchVectorKnowledge(connection, businessIntent);
    const knowledgeText = knowledgeVec.map(k => k.CONTENT_CHUNK).join('\n---\n');

    // Phase 1: Fetch and Rank Tables based on Comments
    const allTables = await fetchLocalTableMetadata(connection);
    const topTables = await rankTablesWithOCI(businessIntent, allTables, {
        instructions,
        sheetNames,
        priorKnowledge: knowledgeText,
        globalIntent: intent, // Pass the global intent
        coreTablePattern: sheetAnalysis?.coreTablePattern,
        subObjectType: sheetAnalysis?.subObjectType,
        reasoning: sheetAnalysis?.reasoning
    });

    // Prioritize core table pattern if identified
    if (sheetAnalysis && sheetAnalysis.coreTablePattern && !topTables.includes(sheetAnalysis.coreTablePattern)) {
        if (allTables.some(t => t.tableName === sheetAnalysis.coreTablePattern)) {
            topTables.unshift(sheetAnalysis.coreTablePattern);
        }
    }

    console.log(`[AI Mapping] Top tables identified: ${topTables.join(', ')}`);
    await appendMappingLog(`Top AI Ranked Tables: ${topTables.join(', ')}`);

    if (topTables.length === 0) {
        console.warn("[AI Mapping] No relevant tables identified by AI.");
        await appendMappingLog(`[WARNING] No relevant tables identified for intent.`);
        return [];
    }

    // Phase 2: Fetch Column Metadata for identified tables
    let aiCandidates = [];
    for (const tbl of topTables) {
        const columns = await fetchLocalColumnMetadata(connection, tbl);
        const tableSiblings = columns.slice(0, 5).map(c => c.columnName).join(', ');

        aiCandidates.push(...columns.map(c => ({
            GROUP_NAME: 'AI_DISCOVERED',
            TABLE_NAME: tbl,
            COLUMN_NAME: c.columnName,
            DATA_TYPE: c.dataType,
            IS_REQUIRED: c.nullable === 'N' ? 'Yes' : 'No',
            METADATA_COLUMN_HEADER: c.columnName,
            COLUMN_DESCRIPTION: c.comments,
            TABLE_CONTEXT: tableSiblings
        })));
    }

    // TRUST AI RANKED TABLES: Use only the candidates derived from the AI-ranked tables.
    // This simplifies the pipeline and avoids noise from broad vector searches across irrelevant tables.
    console.log(`[AI Mapping] Total candidates identified from ranked tables: ${aiCandidates.length}`);
    await appendMappingLog(`Total candidates available for AI Mapping: ${aiCandidates.length}`);

    // Phase 3: Perform Semantic Mapping
    let allMappings = [];

    if (unmappedHeaders) {
        const unmappedHeaderGroups = {};
        if (Array.isArray(unmappedHeaders)) {
            unmappedHeaderGroups['General'] = unmappedHeaders;
        } else {
            Object.assign(unmappedHeaderGroups, unmappedHeaders);
        }

        for (const [sheet, headers] of Object.entries(unmappedHeaderGroups)) {
            console.log(`[AI Mapping] Mapping ${headers.length} headers for sheet: ${sheet}`);
            const sheetContext = `${businessIntent} - Sheet: ${sheet}`;

            // Extract just the names for the basic logging, but pass the full objects to OCI
            // so it can see the technical descriptions.
            const headerNames = headers.map(h => typeof h === 'object' ? h.header : h);

            const smartMappings = await smartMapColumnsWithOCI(headers, aiCandidates, sheetContext, [], {
                instructions: instructions,
                sheetNames: sheetNames,
                currentSheet: sheet,
                priorKnowledge: knowledgeText
            });
            if (smartMappings) {
                await appendMappingLog(`Final Mappings for sheet "${sheet}":`);
                for (const m of smartMappings) {
                    await appendMappingLog(`  - Header: "${m.DATA_IDENTIFIER}" -> ${m.TABLE_NAME}.${m.COLUMN_NAME} (Score: ${m.CONFIDENCE_SCORE || 0}%)`);
                    await appendMappingLog(`    Reason: ${m.REASONING || 'N/A'}`);
                    allMappings.push({
                        DATA_IDENTIFIER: m.DATA_IDENTIFIER,
                        TABLE_NAME: m.TABLE_NAME,
                        COLUMN_NAME: m.COLUMN_NAME,
                        METADATA_COLUMN_HEADER: m.METADATA_COLUMN_HEADER,
                        CONFIDENCE_SCORE: m.CONFIDENCE_SCORE,
                        REASONING: m.REASONING
                    });
                }
            }
        }
        await appendMappingLog(`--- Mapping Session End ---`);
    } else {
        // If no headers provided, return all columns for the top tables as potential mappings
        allMappings = aiCandidates.map(c => ({
            DATA_IDENTIFIER: c.METADATA_COLUMN_HEADER,
            TABLE_NAME: c.TABLE_NAME,
            COLUMN_NAME: c.COLUMN_NAME,
            METADATA_COLUMN_HEADER: c.METADATA_COLUMN_HEADER
        }));
    }

    return allMappings;
}


app.post('/api/fbdi/module-columns', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName, unmappedHeaders, instructions, intent } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();

        if (!moduleName && (!sheetNames || sheetNames.length === 0)) {
            return res.status(400).json({ success: false, message: 'Module name or sheet names are required' });
        }

        // Reuse identical mapping logic to limit the searched tables to mapping-related tables only
        let allMappings = await getFilteredMappings(connection, req.body);
        let tables = [...new Set(allMappings.map(m => m.TABLE_NAME))].filter(Boolean);
        console.log("Final Tables list for schema extraction:", tables);

        if (tables.length === 0) {
            return res.json({ success: true, objects: [], targetModule: analysisModuleName || moduleName });
        }

        const objects = [];

        // Step 2: Fetch Columns for each table
        for (const tableName of tables) {
            console.log(`Fetching columns for table: ${tableName} `);
            const columnsSql = `
                SELECT 
                    T.column_name, 
                    T.data_type,
                    C.COMMENTS
                FROM user_tab_columns T
                LEFT JOIN ALL_COL_COMMENTS C ON T.table_name = C.table_name AND T.column_name = C.column_name AND C.OWNER = 'XX_FUSION_API'
                WHERE T.table_name = UPPER(:tbl)
                ORDER BY T.column_id
            `;
            const columnsResult = await connection.execute(columnsSql, [tableName]);

            if (columnsResult.rows.length > 0) {
                const fields = columnsResult.rows.map(row => ({
                    name: row[0],
                    type: mapOracleType(row[1]),
                    description: row[2] || row[1] // Use comment if available, else data type
                }));

                objects.push({
                    id: tableName,
                    name: toTitleCase(tableName),
                    tableName: tableName,
                    fields: fields
                });
            }
        }

        // Step 3: Discover Joins
        const discoveredJoins = await getDiscoveredJoins(connection, tables);
        const relationships = discoveredJoins.map(rel => {
            const srcObj = objects.find(o => o.tableName === rel.sourceTable);
            const trgObj = objects.find(o => o.tableName === rel.targetTable);
            if (srcObj && trgObj) {
                return {
                    sourceObjectId: srcObj.id,
                    targetObjectId: trgObj.id,
                    joinType: rel.joinType,
                    condition: rel.condition
                };
            }
            return null;
        }).filter(Boolean);

        res.json({
            success: true,
            moduleName: moduleName,
            objects: objects,
            relationships: relationships
        });

    } catch (err) {
        console.error('Module Schema Fetch Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.post('/api/fbdi/fbdi-import', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName, unmappedHeaders, instructions, intent } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();

        if (!moduleName && (!sheetNames || sheetNames.length === 0)) {
            return res.status(400).json({ success: false, message: 'Module name or sheet names are required' });
        }

        // Reuse identical mapping logic to limit the searched tables
        let allMappings = await getFilteredMappings(connection, {
            moduleName,
            sheetNames,
            analysisModuleName,
            unmappedHeaders,
            instructions,
            intent,
            sheetDetails: req.body.sheetDetails
        });

        res.json({
            success: true,
            mappings: allMappings,
            targetModule: analysisModuleName || moduleName
        });

    } catch (err) {
        console.error('FBDI Mappings Fetch Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.get('/api/fbdi/tables', async (req, res) => {
    let connection;

    try {
        connection = await dbPool.getConnection();

        const result = await connection.execute(
            `SELECT table_name FROM user_tables where table_name like '%MSAI%' ORDER BY table_name`
        );
        const tables = result.rows.map(row => row[0]);

        res.json({
            success: true,
            tables: tables
        });

    } catch (err) {
        console.error('Fetch Tables Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

// Template Upload Engine
app.post('/api/fbdi/upload-template', upload.single('template'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    try {
        // Upload to OCI
        const localPath = req.file.path;
        const objectName = req.file.filename;

        console.log(`[Upload] Extracting FBDI Metadata locally for ${objectName}...`);
        let fbdiStructure = null;
        try {
            const extractorScript = path.join(__dirname, 'scripts', 'extract_fbdi_metadata.js');
            const result = spawnSync('node', [extractorScript, localPath]);
            if (result.status === 0) {
                fbdiStructure = result.stdout.toString();
                console.log(`[Upload] FBDI Metadata extracted successfully.`);
            } else {
                console.warn(`[Upload] FBDI Metadata extraction failed:`, result.stderr.toString());
            }
        } catch (extErr) {
            console.warn(`[Upload] Metadata extraction error:`, extErr.message);
        }

        console.log(`[Upload] Uploading ${objectName} to OCI Bucket...`);
        await uploadTemplateToOCI(localPath, objectName);

        // Clean up local file
        fs.unlinkSync(localPath);
        console.log(`[Upload] Local file ${localPath} cleaned up.`);

        res.json({
            success: true,
            filename: objectName,
            fbdiStructure: fbdiStructure // Return this so the frontend can pass it to save-model
        });
    } catch (error) {
        console.error("[Upload] Failed to process template upload:", error);
        res.status(500).json({ success: false, message: "Failed to store template in OCI." });
    }
});

// Populate Template Engine
app.post('/api/fbdi/populate-template', async (req, res) => {
    const { specs, templateName, outputFileName } = req.body;

    if (!specs || !templateName) {
        return res.status(400).json({ success: false, message: 'Specs and templateName are required' });
    }

    const taskId = Date.now();
    const localTemplatePath = path.join(__dirname, 'temp', `${taskId}_${templateName}`);
    const localOutputPath = path.join(__dirname, 'temp_output', `${taskId}_${outputFileName || 'populated_template.xlsm'}`);

    try {
        // 1. Download template from OCI
        console.log(`[Populate] Downloading template ${templateName} from OCI...`);
        await downloadTemplateFromOCI(templateName, localTemplatePath);

        // 2. Run Python Population Script
        console.log(`[Populate] Running Python script for ${templateName}...`);

        const pythonProcess = spawn('python', [
            path.join(__dirname, 'scripts', 'populate_fbdi.py'),
            localTemplatePath,
            localOutputPath,
            JSON.stringify(specs)
        ]);

        let pythonError = '';
        pythonProcess.stderr.on('data', (data) => {
            pythonError += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`[Populate] Python process failed with code ${code}:`, pythonError);
                // Clean up template
                if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                return res.status(500).json({ success: false, message: 'Template population failed', error: pythonError });
            }

            console.log(`[Populate] Population successful: ${localOutputPath}`);

            // 3. Send file back to user
            res.download(localOutputPath, outputFileName || 'populated_template.xlsm', (err) => {
                if (err) {
                    console.error("[Populate] Error sending file:", err);
                }

                // Clean up files after sending
                try {
                    if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                    if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
                    console.log(`[Populate] Cleaned up temporary files for task ${taskId}`);
                } catch (cleanupErr) {
                    console.error("[Populate] Cleanup failed:", cleanupErr);
                }
            });
        });

    } catch (error) {
        console.error("[Populate] Unexpected error:", error);
        if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
        res.status(500).json({ success: false, message: 'Internal server error during population' });
    }
});

app.post('/api/fbdi/extract-batch', async (req, res) => {
    const { specs, exportFormat, templateFile } = req.body;
    if (!specs || !Array.isArray(specs)) return res.status(400).json({ success: false, message: 'Invalid specs' });

    let connection;
    try {
        connection = await dbPool.getConnection();

        try {
            console.log("[BATCH] Executing xx_dbms_session...");
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) {
            console.warn("[BATCH] Failed to execute xx_dbms_session:", sessionErr.message);
        }

        // --- OPTIMIZATION 1: Bulk check XX_VERSION existence for all tables in one query ---
        const allUniqueTables = new Set();
        specs.forEach(spec => {
            spec.columns.forEach(c => { if (c && c.table) allUniqueTables.add(c.table.toUpperCase()); });
        });
        const allTablesArr = Array.from(allUniqueTables);
        const tablesWithVersion = new Set();

        if (allTablesArr.length > 0) {
            try {
                const binds = {};
                const bindNames = allTablesArr.map((_, i) => `:tbl${i}`).join(', ');
                allTablesArr.forEach((tbl, i) => { binds[`tbl${i}`] = tbl; });

                const versionCheckSql = `
                    SELECT table_name 
                    FROM user_tab_columns 
                    WHERE column_name = 'XX_VERSION' 
                      AND table_name IN (${bindNames})
                `;
                const versionResult = await connection.execute(versionCheckSql, binds);
                versionResult.rows.forEach(row => tablesWithVersion.add(row[0]));
                console.log(`[BATCH] Optimized Version Check found ${tablesWithVersion.size} tables with XX_VERSION.`);
            } catch (err) {
                console.warn("[BATCH] Bulk XX_VERSION check failed:", err.message);
            }
        }

        // --- OPTIMIZATION 3: Join Discovery Cache ---
        const discoveredJoinsCache = new Map();

        // --- OPTIMIZATION 2: Parallel Query Execution with separate connections from pool ---
        // We use Promise.all to run all extraction queries in parallel.
        // To get true parallelism in OracleDB, each execution needs its own connection from the pool.

        const results = await Promise.all(specs.map(async (spec) => {
            let specConnection;
            try {
                specConnection = await dbPool.getConnection();

                // --- CRITICAL: Initialize session for EACH parallel connection ---
                try {
                    await specConnection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
                } catch (sessionErr) {
                    console.warn(`[BATCH] Session init failed for sheet ${spec.sheetName}:`, sessionErr.message);
                }

                const { columns, joins, filters, sheetName } = spec;

                // Pass the version set and join cache to the builder
                const query = await buildExtractionQuery(specConnection, columns, joins, filters, null, {
                    tablesWithVersion,
                    discoveredJoinsCache
                });

                console.log(`[BATCH] Parallel Execution SQL for ${sheetName}:`, query);

                // Tuning fetchArraySize for performance
                const result = await specConnection.execute(query, [], {
                    fetchArraySize: 1000,
                    outFormat: oracledb.OUT_FORMAT_OBJECT
                });

                return {
                    sheetName,
                    columns,
                    data: result.rows,
                    filters: spec.filters
                };
            } finally {
                if (specConnection) await specConnection.close();
            }
        }));

        const format = (exportFormat || '').toUpperCase();
        let templateToUse = templateFile;
        let fbdiStructure = null;
        let isZip = (exportFormat === 'FBDI-ZIP');

        if (format.includes('FBDI') || format === 'XLSM') {
            // Priority 1: Model Name Lookup (Most robust)
            const modelName = req.body.modelName;
            if (modelName) {
                try {
                    const modelRes = await connection.execute(
                        `SELECT TEMPLATENAME, FBDI_STRUCTURE FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :b_name`,
                        { b_name: modelName },
                        { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    if (modelRes.rows.length > 0) {
                        templateToUse = modelRes.rows[0].TEMPLATENAME || templateToUse;
                        fbdiStructure = modelRes.rows[0].FBDI_STRUCTURE;
                        console.log(`[BATCH] Found template ${templateToUse} and structure link for model ${modelName}`);
                    }
                } catch (err) {
                    console.warn(`[BATCH] Model lookup by name failed:`, err.message);
                }
            }

            // Priority 2: objectGroupId Lookup (Fallback if modelName didn't yield results)
            if ((!templateToUse || !fbdiStructure) && specs.length > 0 && specs[0].objectGroupId) {
                const modelIdMatch = specs[0].objectGroupId.match(/grp_(?:db|fbdi)_(\d+)/);
                if (modelIdMatch) {
                    const modelId = modelIdMatch[1];
                    try {
                        const modelRes = await connection.execute(
                            `SELECT TEMPLATENAME, FBDI_STRUCTURE FROM XX_INTELLI_MODELS WHERE MODEL_ID = :b_id`,
                            { b_id: modelId },
                            { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        if (modelRes.rows.length > 0) {
                            templateToUse = templateToUse || modelRes.rows[0].TEMPLATENAME;
                            fbdiStructure = fbdiStructure || modelRes.rows[0].FBDI_STRUCTURE;
                            console.log(`[BATCH] Found metadata via modelId ${modelId}`);
                        }
                    } catch (dbErr) {
                        console.warn("[BATCH] Database lookup via modelId failed:", dbErr.message);
                    }
                }
            }

            // Handle XLSM / Population / Direct ZIP Flow
            if ((format === 'XLSM' || exportFormat === 'FBDI-ZIP') && templateToUse) {
                const taskId = Date.now();
                const localTemplatePath = path.join(__dirname, 'temp', `${taskId}_${templateToUse}`);
                const localOutputPath = path.join(__dirname, 'temp_output', `${taskId}_Extraction.${exportFormat === 'FBDI-ZIP' ? 'zip' : 'xlsm'}`);

                try {
                    // 1. Download from OCI
                    await downloadTemplateFromOCI(templateToUse, localTemplatePath);
                    console.log(`[OCI Storage] Downloaded template: ${templateToUse}`);

                    // 2. Prepare Population Specs
                    const populationSpecs = await Promise.all(results.map(async r => {
                        // Normalize sheet name for parameter lookup (remove "FBDI - " if present)
                        const cleanSheetName = (r.sheetName || "").replace(/^FBDI - /i, "").trim();
                        const rawParams = await fetchJobParameters(connection, cleanSheetName);
                        const pSets = await resolveParameterSets(connection, rawParams, r.filters, r.data, r.columns);
                        return {
                            sheetName: r.sheetName || 'Data',
                            columns: r.columns.map(c => ({
                                alias: c.alias,
                                headerName: c.headerName || c.targetName || c.alias,
                                targetName: c.targetName || c.headerName || c.alias
                            })),
                            data: r.data,
                            parameterSets: pSets
                        };
                    }));

                    const localSpecsPath = path.join(__dirname, 'temp', `${taskId}_specs.json`);
                    fs.writeFileSync(localSpecsPath, JSON.stringify(populationSpecs));

                    // 3. Run Logic (New High-Performance FBDI vs Legacy XLSM)
                    let pythonProcess;
                    if (exportFormat === 'FBDI-ZIP' && fbdiStructure) {
                        console.log(`[BATCH] Using HIGH-PERFORMANCE FBDI Engine (Skeleton-Aware)`);
                        const localSkeletonPath = path.join(__dirname, 'temp', `${taskId}_skeleton.json`);
                        fs.writeFileSync(localSkeletonPath, fbdiStructure);

                        pythonProcess = spawn('python', [
                            path.join(__dirname, 'scripts', 'direct_fbdi_zip.py'),
                            localSkeletonPath,
                            localSpecsPath,
                            localOutputPath
                        ]);

                        // Clean up skeleton path on close handled later
                    } else if (exportFormat === 'FBDI-ZIP') {
                        console.log(`[BATCH] FBDI-ZIP requested but no skeleton found. Falling back to template analysis...`);
                        const localSkeletonPath = path.join(__dirname, 'temp', `${taskId}_skeleton.json`);
                        const extractorScript = path.join(__dirname, 'scripts', 'extract_fbdi_metadata.js');
                        const result = spawnSync('node', [extractorScript, localTemplatePath]);

                        if (result.status === 0) {
                            const structureStr = result.stdout.toString();
                            fs.writeFileSync(localSkeletonPath, structureStr);

                            // Self-Healing: Backfill the structure to the DB
                            if (specs.length > 0 && specs[0].objectGroupId) {
                                const modelIdMatch = specs[0].objectGroupId.match(/grp_(?:db|fbdi)_(\d+)/);
                                if (modelIdMatch) {
                                    const modelId = modelIdMatch[1];
                                    connection.execute(
                                        `UPDATE XX_INTELLI_MODELS SET FBDI_STRUCTURE = :b_struct WHERE MODEL_ID = :b_id`,
                                        { b_struct: structureStr, b_id: modelId }
                                    ).then(() => {
                                        console.log(`[BATCH] Self-healed FBDI_STRUCTURE for model ${modelId}.`);
                                    }).catch(err => {
                                        console.warn(`[BATCH] Failed to self-heal FBDI_STRUCTURE:`, err.message);
                                    });
                                }
                            }

                            pythonProcess = spawn('python', [
                                path.join(__dirname, 'scripts', 'direct_fbdi_zip.py'),
                                localSkeletonPath,
                                localSpecsPath,
                                localOutputPath
                            ]);
                        } else {
                            console.error(`[BATCH] Fallback extraction failed:`, result.stderr.toString());
                            throw new Error("Failed to extract template skeleton for FBDI-ZIP");
                        }
                    } else {
                        console.log(`[BATCH] Running surgical_populate.py for XLSM...`);
                        pythonProcess = spawn('python', [
                            path.join(__dirname, 'scripts', 'surgical_populate.py'),
                            localTemplatePath,
                            localOutputPath,
                            localSpecsPath
                        ]);
                    }

                    let pythonError = '';
                    pythonProcess.stderr.on('data', (data) => pythonError += data.toString());

                    pythonProcess.on('close', async (code) => {
                        // Cleanup specs file
                        if (fs.existsSync(localSpecsPath)) fs.unlinkSync(localSpecsPath);

                        // Cleanup skeleton file if it exists
                        const localSkeletonPath = path.join(__dirname, 'temp', `${taskId}_skeleton.json`);
                        if (fs.existsSync(localSkeletonPath)) fs.unlinkSync(localSkeletonPath);

                        if (code !== 0) {
                            console.error(`[BATCH] Population failed:`, pythonError);
                            if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                            if (!res.headersSent) res.status(500).json({ success: false, message: 'Population failed', error: pythonError });
                            return;
                        }

                        // 4. Send File
                        if (!fs.existsSync(localOutputPath)) {
                            console.error(`[BATCH] Population script finished but output file not found: ${localOutputPath}`);
                            if (!res.headersSent) res.status(500).json({ success: false, message: 'Population failed to produce output' });
                            return;
                        }

                        if (isZip) {
                            let finalZipName = `FBDI_Load_${templateToUse.replace('.xlsm', '')}.zip`;
                            if (fbdiStructure) {
                                try {
                                    const structParse = typeof fbdiStructure === 'string' ? JSON.parse(fbdiStructure) : fbdiStructure;
                                    if (structParse.vba && structParse.vba.zipFileName) {
                                        finalZipName = `${structParse.vba.zipFileName}.zip`;
                                    }
                                } catch (e) { }
                            }
                            res.setHeader('Content-Type', 'application/zip');
                            res.setHeader('Content-Disposition', `attachment; filename="${finalZipName}"`);
                        } else {
                            res.setHeader('Content-Type', 'application/vnd.ms-excel.sheet.macroEnabled.12');
                            res.setHeader('Content-Disposition', `attachment; filename="Populated_${templateToUse || 'Extraction.xlsm'}"`);
                        }

                        const stream = fs.createReadStream(localOutputPath);
                        stream.pipe(res);

                        stream.on('end', () => {
                            // Cleanup
                            try {
                                if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                                if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
                                console.log(`[BATCH] Temporary files cleaned up. Task ${taskId} complete.`);
                            } catch (e) { console.warn("[BATCH] Cleanup failed:", e.message); }
                        });
                    });
                    return; // Early return as file is being streamed
                } catch (procErr) {
                    console.error("[BATCH] Population Process Error:", procErr);
                    if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                    if (!res.headersSent) res.status(500).json({ success: false, message: 'Population failed', error: procErr.message });
                    return;
                }
            }

            // Fallback: Original ZIP logic (if FBDI or if XLSM failed but we want something)
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="Consolidated_FBDI_${Date.now()}.zip"`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);
            archive.on('error', (err) => {
                console.error('[BATCH] Archiver error:', err);
                if (!res.headersSent) res.status(500).json({ success: false, message: 'Archive generation failed' });
            });

            // Handle Parameter List Properties for Fallback ZIP
            let allParameterSets = [];
            for (const result of results) {
                const cleanSheetName = (result.sheetName || "").replace(/^FBDI - /i, "").trim();
                const rawParams = await fetchJobParameters(connection, cleanSheetName);
                if (rawParams.length > 0) {
                    const pSets = await resolveParameterSets(connection, rawParams, result.filters, result.data, result.columns);
                    if (pSets && pSets.length > 0) {
                        allParameterSets = pSets;
                        break;
                    }
                }
            }

            if (allParameterSets.length > 0) {
                const paramLines = allParameterSets.map(set => set.join(',')).join('\n');
                archive.append(paramLines, { name: 'parameter_list.properties' });
                console.log(`[BATCH] Added parameter_list.properties to fallback ZIP.`);
            }

            for (const result of results) {
                const sheetName = result.sheetName || 'Data';
                const columns = result.columns;
                const rows = result.data;
                const headers = columns.map(c => `"${((c && c.alias) || '').replace(/"/g, '""')}"`).join(',');
                let csvContent = headers + '\n';
                rows.forEach(row => {
                    const line = columns.map(c => {
                        let val = (c && c.alias) ? row[c.alias] : '';
                        if (val === null || val === undefined) val = '';
                        val = String(val).replace(/"/g, '""');
                        if (val.includes(',') || val.includes('\n') || val.includes('"')) return `"${val}"`;
                        return val;
                    }).join(',');
                    csvContent += line + '\n';
                });
                archive.append(csvContent, { name: `${sheetName}.csv` });
            }
            await archive.finalize();
            return;
        }

        res.json({
            success: true,
            results
        });

    } catch (err) {
        console.error('Batch Extraction Error:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// --- Unified SQL Builder Engine ---
async function buildExtractionQuery(connection, columns, joins, filters, limit = null, cache = {}) {
    const { tablesWithVersion: preFetchedVersions, discoveredJoinsCache } = cache;

    if (!columns || columns.length === 0) {
        throw new Error('No columns specified');
    }

    let query = 'SELECT ';
    query += columns.filter(c => c && c.alias).map(c => {
        let colExpr = '';
        if (c.expression && c.expression !== 'NULL') {
            colExpr = c.expression;
        } else if (c.table && c.column) {
            colExpr = `${quoteIdentifier(c.table)}.${quoteIdentifier(c.column)}`;
        } else {
            colExpr = 'NULL';
        }

        if (c.transformations && c.transformations.length > 0) {
            c.transformations.forEach(t => {
                if (t.type === 'UPPERCASE') colExpr = `UPPER(${colExpr})`;
                if (t.type === 'LOWERCASE') colExpr = `LOWER(${colExpr})`;
                if (t.type === 'TRIM') colExpr = `TRIM(${colExpr})`;
            });
        }
        return `${colExpr} AS "${c.alias}"`;
    }).join(', ');

    const initialTables = [...new Set(columns.filter(c => c && c.table).map(c => c.table.toUpperCase()))];
    let allInvolvedTables = new Set(initialTables);

    if (initialTables.length === 0) {
        query += ' FROM DUAL';
    } else {
        // DISCOVER JOINS IF MORE THAN ONE TABLE
        let finalJoins = joins || [];
        if (initialTables.length > 1) {
            let discovered;
            const cacheKey = [...initialTables].sort().join(',');

            if (discoveredJoinsCache && discoveredJoinsCache.has(cacheKey)) {
                discovered = discoveredJoinsCache.get(cacheKey);
            } else {
                discovered = await getDiscoveredJoins(connection, initialTables);
                if (discoveredJoinsCache) discoveredJoinsCache.set(cacheKey, discovered);
            }

            discovered.forEach(dj => {
                const srcTbl = dj.sourceObjectId.toUpperCase();
                const tgtTbl = dj.targetObjectId.toUpperCase();

                // Add to table list for FROM clause
                allInvolvedTables.add(srcTbl);
                allInvolvedTables.add(tgtTbl);

                const alreadyExists = finalJoins.some(fj => {
                    const fjLeft = (fj.leftTable || '').toUpperCase();
                    const fjRight = (fj.rightTable || '').toUpperCase();
                    return (fjLeft === srcTbl && fjRight === tgtTbl) || (fjLeft === tgtTbl && fjRight === srcTbl);
                });

                if (!alreadyExists) {
                    finalJoins.push({
                        leftTable: srcTbl,
                        rightTable: tgtTbl,
                        condition: dj.condition,
                        type: dj.joinType || 'INNER'
                    });
                }
            });
        }

        const tablesArray = Array.from(allInvolvedTables);

        // IMPLICIT JOIN SYNTAX
        query += ` FROM ${tablesArray.map(t => quoteIdentifier(t)).join(', ')}`;


        const tablesWithVersion = preFetchedVersions || new Set();
        const allConditions = [];

        // 1. Join Conditions
        finalJoins.forEach(j => {
            if (j.condition) {
                allConditions.push(j.condition);
            }
        });

        // 2. Filter Conditions (Improved Grouping: OR for same-column inclusions)
        if (filters && filters.length > 0) {
            const filterGroups = {};
            filters.forEach(f => {
                if (f.field && f.operator && f.value !== undefined) {
                    if (!filterGroups[f.field]) filterGroups[f.field] = [];
                    filterGroups[f.field].push(f);
                }
            });

            for (const [field, fieldFilters] of Object.entries(filterGroups)) {
                const [table, col] = field.split('.');
                if (!table || !col) continue;

                const fieldConditions = fieldFilters.map(f => {
                    let valExpr = `'${String(f.value).replace(/'/g, "''")}'`;
                    if (f.operator === 'IN' || f.operator === 'NOT IN') {
                        const vals = String(f.value).split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(',');
                        valExpr = `(${vals})`;
                    } else if (f.operator === 'LIKE' || f.operator === 'NOT LIKE') {
                        valExpr = `'%${String(f.value).replace(/'/g, "''")}%'`;
                    }
                    return `${quoteIdentifier(table)}.${quoteIdentifier(col)} ${f.operator} ${valExpr}`;
                });

                if (fieldConditions.length > 1) {
                    // Use OR if all are inclusion operators (=, LIKE, IN), else use AND (for ranges/exclusions)
                    const useOr = fieldFilters.every(f => ['=', 'LIKE', 'IN'].includes(f.operator.toUpperCase()));
                    allConditions.push(`(${fieldConditions.join(useOr ? ' OR ' : ' AND ')})`);
                } else {
                    allConditions.push(fieldConditions[0]);
                }
            }
        }

        // Bulk check XX_VERSION existence if not pre-fetched
        if (!preFetchedVersions && tablesArray.length > 0) {
            try {
                const binds = {};
                const bindNames = tablesArray.map((_, i) => `:tbl${i}`).join(', ');
                tablesArray.forEach((tbl, i) => { binds[`tbl${i}`] = tbl; });

                const versionCheckSql = `
                    SELECT table_name 
                    FROM all_tab_columns 
                    WHERE owner = 'XX_FUSION_API'
                      AND column_name = 'XX_VERSION' 
                      AND table_name IN (${bindNames})
                `;
                const versionResult = await connection.execute(versionCheckSql, binds);
                versionResult.rows.forEach(row => tablesWithVersion.add(String(row[0]).toUpperCase()));
            } catch (err) {
                console.warn("Bulk XX_VERSION check failed:", err.message);
            }
        }

        // 3. Version Conditions
        tablesArray.forEach(t => {
            if (tablesWithVersion.has(t.toUpperCase())) {
                allConditions.push(`${quoteIdentifier(t)}.XX_VERSION = (SELECT MAX(XX_VERSION) FROM ${quoteIdentifier(t)})`);
            }
        });


        if (allConditions.length > 0) {
            query += ` WHERE ${allConditions.join(' AND ')}`;
        }
    }

    if (limit) {
        query += ` FETCH NEXT ${limit} ROWS ONLY`;
    }

    return query;
}

// Generate SQL Endpoint
app.post('/api/fbdi/generate-sql', async (req, res) => {
    const { columns, joins, filters, limit } = req.body;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const query = await buildExtractionQuery(connection, columns, joins, filters, limit);
        res.json({ success: true, query });
    } catch (err) {
        console.error('Generate SQL Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// SQL to JSON Mapping Endpoint
app.post('/api/fbdi/sql-to-json-mapping', async (req, res) => {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, message: 'SQL is required' });

    try {
        console.log(`[SQL Mapping] Analyzing query: ${sql.substring(0, 100)}...`);

        // Basic SQL Parsing logic with multi-line support
        const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
        if (!selectMatch) {
            return res.status(400).json({ success: false, message: 'Invalid SQL: Could not find SELECT ... FROM' });
        }

        const selectContent = selectMatch[1];
        // Split by commas, considering quotes
        const clauses = selectContent.split(/,(?=(?:[^"'`]*["'`][^"'`]*["'`])*[^"'`]*$)/);

        const mappings = [];
        const fromMatch = sql.match(/FROM\s+([\s\S]+?)(\s+WHERE|\s+GROUP|\s+ORDER|\s+FETCH|$)/i);
        const fromContent = fromMatch ? fromMatch[1] : '';

        // Map of alias to table to help with simple unqualified columns
        // e.g. FROM EMPLOYEES E
        const tableAliases = {};
        const fromParts = fromContent.split(',');
        fromParts.forEach(p => {
            const parts = p.trim().split(/\s+/);
            if (parts.length >= 2) {
                tableAliases[parts[parts.length - 1].toUpperCase()] = parts[0].toUpperCase().replace(/"/g, '');
            } else if (parts.length === 1) {
                tableAliases[parts[0].toUpperCase().replace(/"/g, '')] = parts[0].toUpperCase().replace(/"/g, '');
            }
        });

        clauses.forEach((clause, index) => {
            const parts = clause.split(/\s+[Aa][Ss]\s+/i);
            const rawSource = parts[0].trim();
            const targetAlias = (parts.length >= 2)
                ? parts[1].trim().replace(/^["'`]|["'`]$/g, '')
                : `Column_${index + 1}`;

            let cleanSource = rawSource.replace(/^["'`]|["'`]$/g, '').trim();

            // Basic function stripping (UPPER, LOWER, TRIM)
            const funcMatch = cleanSource.match(/^([A-Z_]+)\((.+)\)$/i);
            if (funcMatch) {
                // We keep the inner part for table.column mapping
                cleanSource = funcMatch[2].trim();
            }

            let tableName = '';
            let columnName = '';

            if (cleanSource.includes('.')) {
                const [aliasOrTbl, col] = cleanSource.split('.').map(s => s.trim().replace(/^["'`]|["'`]$/g, ''));
                tableName = tableAliases[aliasOrTbl.toUpperCase()] || aliasOrTbl.toUpperCase();
                columnName = col.toUpperCase();
            } else {
                // Try to find the first table from FROM clause if only one table exists
                const tables = Object.values(tableAliases);
                if (tables.length === 1) {
                    tableName = tables[0];
                }
                columnName = cleanSource.toUpperCase();
            }

            mappings.push({
                DATA_IDENTIFIER: targetAlias,
                TABLE_NAME: tableName,
                COLUMN_NAME: columnName,
                REASONING: `Extracted from SQL: ${rawSource}`,
                CONFIDENCE_SCORE: 100
            });
        });

        res.json({
            success: true,
            mappings: mappings
        });
    } catch (err) {
        console.error('SQL Analysis Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Extraction Engine (Single)

// Extraction Engine (Single)
app.post('/api/fbdi/extract', async (req, res) => {
    const { columns, joins, filters, limit, templateFile, sheetName, exportFormat } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();

        try {
            console.log("[EXTRACT] Executing xx_dbms_session...");
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) {
            console.warn("[EXTRACT] Failed to execute xx_dbms_session:", sessionErr.message);
        }

        let query;
        try {
            query = await buildExtractionQuery(connection, columns, joins, filters, limit);
        } catch (buildErr) {
            return res.status(400).json({ success: false, message: buildErr.message });
        }

        console.log('Running Extraction Query:', query);
        let result;
        try {
            // Tuning fetchArraySize for performance
            result = await connection.execute(query, [], {
                fetchArraySize: 1000,
                outFormat: oracledb.OUT_FORMAT_OBJECT
            });
        } catch (queryErr) {
            console.error('Individual Extraction Query Failed:', queryErr.message);
            throw { message: queryErr.message, query: query };
        }

        const rows = result.rows;

        const format = (exportFormat || '').toUpperCase();
        let templateToUse = templateFile;
        let fbdiStructure = null;
        let isZip = (format === 'FBDI-ZIP' || format === 'FBDI');
        let isFbdiCsv = false; // Individual extractions for FBDI are now ZIP-wrapped

        if (format.includes('FBDI') || format === 'XLSM') {
            // Priority 1: Model Name Lookup
            const modelName = req.body.modelName;
            if (modelName) {
                try {
                    const modelRes = await connection.execute(
                        `SELECT TEMPLATENAME, FBDI_STRUCTURE FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :b_name`,
                        { b_name: modelName },
                        { outFormat: oracledb.OUT_FORMAT_OBJECT }
                    );
                    if (modelRes.rows.length > 0) {
                        templateToUse = modelRes.rows[0].TEMPLATENAME || templateToUse;
                        fbdiStructure = modelRes.rows[0].FBDI_STRUCTURE;
                        console.log(`[EXTRACT] Found template ${templateToUse} and structure for model ${modelName}`);
                    }
                } catch (err) {
                    console.warn(`[EXTRACT] Model lookup by name failed:`, err.message);
                }
            }

            // Priority 2: objectGroupId Lookup
            const specs = req.body.specs || [];
            if ((!templateToUse || !fbdiStructure) && specs.length > 0 && specs[0].objectGroupId) {
                const modelIdMatch = specs[0].objectGroupId.match(/grp_(?:db|fbdi)_(\d+)/);
                if (modelIdMatch) {
                    const modelId = modelIdMatch[1];
                    try {
                        const modelRes = await connection.execute(
                            `SELECT TEMPLATENAME, FBDI_STRUCTURE FROM XX_INTELLI_MODELS WHERE MODEL_ID = :b_id`,
                            { b_id: modelId },
                            { outFormat: oracledb.OUT_FORMAT_OBJECT }
                        );
                        if (modelRes.rows.length > 0) {
                            templateToUse = templateToUse || modelRes.rows[0].TEMPLATENAME;
                            fbdiStructure = fbdiStructure || modelRes.rows[0].FBDI_STRUCTURE;
                        }
                    } catch (dbErr) {
                        console.warn("[EXTRACT] Database lookup via modelId failed:", dbErr.message);
                    }
                }
            }

            // If we have a template and it's a high-perf format, use the engine
            if (templateToUse && (format === 'FBDI-ZIP' || format === 'FBDI' || format === 'XLSM')) {
                // ... logic similar to batch-extract ...
                // BUT for a single result
                const taskId = Date.now();
                const localTemplatePath = path.join(__dirname, 'temp', `${taskId}_${templateToUse}`);
                const extension = isZip ? 'zip' : (isFbdiCsv ? 'csv' : 'xlsm');
                const localOutputPath = path.join(__dirname, 'temp_output', `${taskId}_Extraction.${extension}`);

                try {
                    if (!fbdiStructure) {
                        await downloadTemplateFromOCI(templateToUse, localTemplatePath);
                        console.log(`[EXTRACT] Downloaded template: ${templateToUse}`);
                    } else {
                        console.log(`[EXTRACT] Skipping template download, using direct engine for ${templateToUse}`);
                    }

                    const rawParams = await fetchJobParameters(connection, sheetName);
                    const pSets = await resolveParameterSets(connection, rawParams, req.body.filters, rows, columns);

                    const populationSpecs = [{
                        sheetName: sheetName || 'Data',
                        columns: columns,
                        data: rows,
                        parameterSets: pSets
                    }];

                    const localSpecsPath = path.join(__dirname, 'temp', `${taskId}_specs.json`);
                    fs.writeFileSync(localSpecsPath, JSON.stringify(populationSpecs));

                    if ((isZip || isFbdiCsv) && fbdiStructure) {
                        console.log(`[EXTRACT] Using HIGH-PERFORMANCE FBDI Engine (Single Sheet) for format: ${format}`);
                        const localSkeletonPath = path.join(__dirname, 'temp', `${taskId}_skeleton.json`);
                        const skeletonString = typeof fbdiStructure === 'string' ? fbdiStructure : JSON.stringify(fbdiStructure);
                        fs.writeFileSync(localSkeletonPath, skeletonString);

                        console.log(`[EXTRACT] Spawning direct_fbdi_zip.py with output: ${localOutputPath}`);
                        const pythonProcess = spawn('python', [
                            path.join(__dirname, 'scripts', 'direct_fbdi_zip.py'),
                            localSkeletonPath,
                            localSpecsPath,
                            localOutputPath
                        ]);

                        let pythonStdout = '';
                        let pythonStderr = '';
                        pythonProcess.stdout.on('data', (d) => pythonStdout += d.toString());
                        pythonProcess.stderr.on('data', (d) => pythonStderr += d.toString());

                        pythonProcess.on('close', (code) => {
                            if (code !== 0) {
                                console.error(`[EXTRACT] Python engine failed with code ${code}. Stderr: ${pythonStderr}`);
                                if (!res.headersSent) res.status(500).json({ success: false, message: 'FBDI Generation failed', detail: pythonStderr });
                                return;
                            }
                            console.log(`[EXTRACT] Python engine success. Output path: ${localOutputPath}`);
                            let finalFileName = `Extraction_${taskId}.${extension}`;
                            if (fbdiStructure) {
                                try {
                                    const structParse = typeof fbdiStructure === 'string' ? JSON.parse(fbdiStructure) : fbdiStructure;
                                    if (isZip && structParse.vba && structParse.vba.zipFileName) {
                                        finalFileName = `${structParse.vba.zipFileName}.zip`;
                                    } else if (isZip) {
                                        if (templateToUse) {
                                            finalFileName = `FBDI_${templateToUse.replace('.xlsm', '')}.zip`;
                                        }
                                    }
                                } catch (e) { }
                            }
                            res.setHeader('Content-Type', 'application/zip');
                            res.setHeader('Content-Disposition', `attachment; filename="${finalFileName}"`);
                            const stream = fs.createReadStream(localOutputPath);
                            stream.pipe(res);
                            stream.on('end', () => {
                                try {
                                    if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                                    if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
                                } catch (e) { }
                            });
                        });
                        return;
                    } else if (isZip) {
                        // Fallback extraction
                        console.log(`[EXTRACT] Falling back to template analysis...`);
                        const localSkeletonPath = path.join(__dirname, 'temp', `${taskId}_skeleton.json`);
                        const extractorScript = path.join(__dirname, 'scripts', 'extract_fbdi_metadata.js');
                        const result = spawnSync('node', [extractorScript, localTemplatePath]);
                        if (result.status === 0) {
                            fs.writeFileSync(localSkeletonPath, result.stdout.toString());
                            const pythonProcess = spawn('python', [
                                path.join(__dirname, 'scripts', 'direct_fbdi_zip.py'),
                                localSkeletonPath,
                                localSpecsPath,
                                localOutputPath
                            ]);
                            // ... same close logic ...
                            pythonProcess.on('close', (code) => {
                                // (Implementation truncated for brevity, but matches batch-extract)
                                if (code === 0) {
                                    res.setHeader('Content-Type', 'application/zip');
                                    res.setHeader('Content-Disposition', `attachment; filename="FBDI_Fallback.zip"`);
                                    const stream = fs.createReadStream(localOutputPath);
                                    stream.pipe(res);
                                    // Cleanup
                                    stream.on('end', () => {
                                        try {
                                            // KEEP TEMP FILES FOR DEBUGGING
                                            // if (fs.existsSync(localTemplatePath)) fs.unlinkSync(localTemplatePath);
                                            // if (fs.existsSync(localOutputPath)) fs.unlinkSync(localOutputPath);
                                        } catch (e) { }
                                    });
                                    try {
                                        if (fs.existsSync(localSpecsPath)) fs.unlinkSync(localSpecsPath);
                                        if (fs.existsSync(localSkeletonPath)) fs.unlinkSync(localSkeletonPath);
                                    } catch (e) { }
                                } else {
                                    res.status(500).json({ success: false, message: 'FBDI Generation failed', detail: result.stderr.toString() });
                                }
                            });
                        } else {
                            console.error(`[EXTRACT] Metadata extraction failed for ZIP fallback:`, result.stderr.toString());
                            res.status(500).json({ success: false, message: 'FBDI Metadata extraction failed for ZIP' });
                        }
                        return;
                    } else if (format === 'XLSM') {
                        // Legacy XLSM path only if NOT FBDI
                        if (!fs.existsSync(localTemplatePath)) {
                            await downloadTemplateFromOCI(templateToUse, localTemplatePath);
                        }
                        const pythonProcess = spawn('python', [
                            path.join(__dirname, 'scripts', 'surgical_populate.py'),
                            localTemplatePath,
                            localOutputPath,
                            localSpecsPath
                        ]);
                        pythonProcess.on('close', (code) => {
                            if (code === 0) {
                                res.setHeader('Content-Type', 'application/vnd.ms-excel.sheet.macroEnabled.12');
                                res.setHeader('Content-Disposition', `attachment; filename="Populated_${templateToUse}"`);
                                fs.createReadStream(localOutputPath).pipe(res);
                            } else {
                                res.status(500).send("XLSM Population failed");
                            }
                        });
                        return;
                    }

                } catch (zipErr) {
                    console.error("[EXTRACT] FBDI flow failed:", zipErr.message);
                }
            }
        }

        // Legacy "FBDI" (Single CSV in ZIP) format
        if (format === 'FBDI' || format === 'CSV-ZIP') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${sheetName || 'Extraction'}_${Date.now()}.zip"`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            archive.on('error', (err) => {
                console.error('[SINGLE] Archiver error:', err);
                if (!res.headersSent) res.status(500).json({ success: false, message: 'Archive generation failed' });
            });

            // Make a CSV string for the single query result
            const headers = columns.map(c => `"${((c && c.alias) || '').replace(/"/g, '""')}"`).join(',');
            let csvContent = headers + '\n';

            rows.forEach(row => {
                const line = columns.map(c => {
                    let val = (c && c.alias) ? row[c.alias] : '';
                    if (val === null || val === undefined) val = '';
                    val = String(val).replace(/"/g, '""');
                    if (val.includes(',') || val.includes('\n') || val.includes('"')) {
                        return `"${val}"`;
                    }
                    return val;
                }).join(',');
                csvContent += line + '\n';
            });

            archive.append(csvContent, { name: `${sheetName}.csv` });
            await archive.finalize();
            return;
        }

        res.json({
            success: true,
            query: query,
            data: rows
        });

    } catch (err) {
        console.error('Extraction Error:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message, query: err.query || '' });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.post('/api/fbdi/save-model', async (req, res) => {
    const { modelName, templateName, username, userId, objects, specs, fbdiStructure: providedStructure } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();

        // 0. Extract FBDI Structure if template is provided
        let fbdiStructure = providedStructure || null;
        if (!fbdiStructure && templateName && templateName !== 'UNKNOWN') {
            const taskId = Date.now();
            const tempTemplatePath = path.join(__dirname, 'temp', `${taskId}_${templateName}`);
            try {
                console.log(`[FBDI Metadata] Extraction skeleton missing or requested for ${templateName}. Attempting backfill...`);
                await downloadTemplateFromOCI(templateName, tempTemplatePath);

                const extractorScript = path.join(__dirname, 'scripts', 'extract_fbdi_metadata.js');
                const result = spawnSync('node', [extractorScript, tempTemplatePath]);

                if (result.status === 0) {
                    fbdiStructure = result.stdout.toString();
                    console.log(`[FBDI Metadata] Extraction successful.`);
                } else {
                    console.warn(`[FBDI Metadata] Extraction failed:`, result.stderr.toString());
                }
            } catch (err) {
                console.warn(`[FBDI Metadata] Global extraction error:`, err.message);
            } finally {
                if (fs.existsSync(tempTemplatePath)) fs.unlinkSync(tempTemplatePath);
            }
        }

        // 1. Insert/Check Model in XX_INTELLI_MODELS
        let modelId;
        const checkModel = await connection.execute(
            `SELECT MODEL_ID FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :b_name`,
            { b_name: modelName }
        );

        if (checkModel.rows.length > 0) {
            modelId = checkModel.rows[0][0];
            console.log(`Model ${modelName} already exists with ID: ${modelId}. Updating metadata...`);
            await connection.execute(
                `UPDATE XX_INTELLI_MODELS 
                 SET FBDI_STRUCTURE = :b_struct, TEMPLATENAME = :b_template 
                 WHERE MODEL_ID = :b_id`,
                { b_struct: fbdiStructure, b_template: templateName, b_id: modelId }
            );
        } else {
            console.log(`Inserting new model into XX_INTELLI_MODELS: ${modelName}, Template: ${templateName}`);
            const result = await connection.execute(
                `INSERT INTO XX_INTELLI_MODELS (MODEL_ID, MODEL_NAME, USERNAME, USER_ID, TEMPLATENAME, FBDI_STRUCTURE) 
                 VALUES (XX_INTELLI_MODELS_SEQ.NEXTVAL, :b_name, :b_user, :b_uid, :b_template, :b_struct) 
                 RETURNING MODEL_ID INTO :b_id`,
                {
                    b_name: modelName,
                    b_user: username || 'GUEST',
                    b_uid: userId || '1001',
                    b_template: templateName || 'UNKNOWN',
                    b_struct: fbdiStructure,
                    b_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            modelId = result.outBinds.b_id[0];
            console.log(`Created model ${modelName} with ID: ${modelId}`);
        }

        // 2. Persist Architecture (TABLES and EXTRACTIONS as COMMA SEPARATED STRINGS)
        const tablesList = (objects || []).map(o => o.tableName || o.name).filter(Boolean).join(', ');
        const specsList = (specs || []).map(s => s.name).filter(Boolean).join(', ');

        console.log(`Persisting architecture for: ${modelName}, Template: ${templateName}`);
        console.log(`Tables: ${tablesList}`);
        console.log(`Extractions: ${specsList}`);

        // Upsert logic for Architecture (Delete then Insert for simplicity)
        await connection.execute(`DELETE FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name`, { b_name: modelName });

        const relationshipsJson = JSON.stringify(req.body.relationships || []);

        await connection.execute(
            `INSERT INTO XX_INTELLI_MODEL_ARCHITECTURE (MODEL_NAME, TABLES, EXTRACTIONS, TEMPLATENAME, RELATIONSHIPS) 
             VALUES (:b_name, :b_tables, :b_specs, :b_template, :b_rels)`,
            {
                b_name: modelName,
                b_tables: tablesList,
                b_specs: specsList,
                b_template: templateName || 'UNKNOWN',
                b_rels: relationshipsJson
            }
        );

        // 3. Persist Individual Extractions into XX_INTELLI_MODEL_EXTRACTIONS
        if (specs && Array.isArray(specs)) {
            console.log(`Persisting ${specs.length} extraction specs into XX_INTELLI_MODEL_EXTRACTIONS for Model ID: ${modelId}`);

            for (const spec of specs) {
                const mappingsJson = JSON.stringify(spec.columns || []);
                const filtersJson = JSON.stringify(spec.filters || []);
                const sqlQuery = spec.sqlQuery || '';

                // Get max version for this extraction
                const versionRes = await connection.execute(
                    `SELECT MAX(VERSION) as MAX_VER FROM XX_INTELLI_MODEL_EXTRACTIONS WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
                    { b_mid: modelId, b_ename: spec.name },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );

                let nextVersion = '1.0';
                if (versionRes.rows && versionRes.rows[0].MAX_VER) {
                    const currentVer = parseFloat(versionRes.rows[0].MAX_VER);
                    nextVersion = (currentVer + 0.1).toFixed(1);
                }

                console.log(`Saving extraction ${spec.name} as version ${nextVersion}`);

                await connection.execute(
                    `INSERT INTO XX_INTELLI_MODEL_EXTRACTIONS (ID, MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, LOAD_FILE_NAME) 
                     VALUES (XX_INTELLI_MODEL_EXT_SEQ.NEXTVAL, :b_mid, :b_ename, :b_map, :b_sql, :b_template, :b_ver, :b_filters, :b_sheet)`,
                    {
                        b_mid: modelId,
                        b_ename: spec.name,
                        b_map: mappingsJson,
                        b_sql: sqlQuery,
                        b_template: templateName || 'UNKNOWN',
                        b_ver: nextVersion,
                        b_filters: filtersJson,
                        b_sheet: spec.sheetName || ''
                    }
                );
            }
        }

        await connection.commit();
        res.json({ success: true, modelId: modelId });

    } catch (err) {
        console.error('Save Model Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.post('/api/fbdi/model/update-architecture', async (req, res) => {
    const { modelName, objects, relationships } = req.body;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const tablesList = (objects || []).map(o => o.tableName || o.name).filter(Boolean).join(', ');
        const relationshipsJson = JSON.stringify(relationships || []);

        console.log(`Updating architecture for: ${modelName}`);

        // Upsert architecture
        await connection.execute(`DELETE FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name`, { b_name: modelName });
        await connection.execute(
            `INSERT INTO XX_INTELLI_MODEL_ARCHITECTURE (MODEL_NAME, TABLES, RELATIONSHIPS, TEMPLATENAME) 
             VALUES (:b_name, :b_tables, :b_rels, (SELECT MAX(TEMPLATENAME) FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :b_name))`,
            {
                b_name: modelName,
                b_tables: tablesList,
                b_rels: relationshipsJson
            }
        );

        await connection.commit();
        res.json({ success: true, message: 'Architecture updated successfully' });
    } catch (err) {
        console.error('Update Architecture Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.post('/api/fbdi/extraction/update', async (req, res) => {
    const { modelId, extractionName, columns, filters, sqlQuery, templateName, isClone, version, sheetName } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();
        const mappingsJson = JSON.stringify(columns || []);
        const filtersJson = JSON.stringify(filters || []);

        if (isClone) {
            // Get max version for this extraction
            const versionRes = await connection.execute(
                `SELECT MAX(VERSION) as MAX_VER FROM XX_INTELLI_MODEL_EXTRACTIONS WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
                { b_mid: modelId, b_ename: extractionName },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            let nextVersion = '1.0';
            if (versionRes.rows && versionRes.rows[0].MAX_VER) {
                const currentVer = parseFloat(versionRes.rows[0].MAX_VER);
                nextVersion = (currentVer + 0.1).toFixed(1);
            }

            console.log(`Creating new version ${nextVersion} for extraction ${extractionName}`);

            // Insert new version
            await connection.execute(
                `INSERT INTO XX_INTELLI_MODEL_EXTRACTIONS (ID, MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, LOAD_FILE_NAME) 
                 VALUES (XX_INTELLI_MODEL_EXT_SEQ.NEXTVAL, :b_mid, :b_ename, :b_map, :b_sql, :b_template, :b_ver, :b_filters, :b_sheet)`,
                {
                    b_mid: modelId,
                    b_ename: extractionName,
                    b_map: mappingsJson,
                    b_sql: sqlQuery || '',
                    b_template: templateName || 'UNKNOWN',
                    b_ver: nextVersion,
                    b_filters: filtersJson,
                    b_sheet: sheetName || ''
                }
            );

            await connection.commit();
            res.json({ success: true, version: nextVersion, action: 'CLONE' });
        } else {
            console.log(`Updating existing version ${version} for extraction ${extractionName}`);

            // Update specific version
            const result = await connection.execute(
                `UPDATE XX_INTELLI_MODEL_EXTRACTIONS 
                 SET COLUMN_MAPPINGS = :b_map, EXTRACTION_SQL_QUERY = :b_sql, TEMPLATENAME = :b_template, DATA_FILTERS = :b_filters, LOAD_FILE_NAME = :b_sheet
                 WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename AND VERSION = :b_ver`,
                {
                    b_mid: modelId,
                    b_ename: extractionName,
                    b_map: mappingsJson,
                    b_sql: sqlQuery || '',
                    b_template: templateName || 'UNKNOWN',
                    b_ver: version || '1.0',
                    b_filters: filtersJson,
                    b_sheet: sheetName || ''
                }
            );

            if (result.rowsAffected === 0) {
                // If it doesn't exist (e.g. first time save of a newly created spec in UI), insert it as 1.0
                console.log(`Version ${version} not found, inserting as initial version 1.0`);
                await connection.execute(
                    `INSERT INTO XX_INTELLI_MODEL_EXTRACTIONS (ID, MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, LOAD_FILE_NAME) 
                     VALUES (XX_INTELLI_MODEL_EXT_SEQ.NEXTVAL, :b_mid, :b_ename, :b_map, :b_sql, :b_template, '1.0', :b_filters, :b_sheet)`,
                    {
                        b_mid: modelId,
                        b_ename: extractionName,
                        b_map: mappingsJson,
                        b_sql: sqlQuery || '',
                        b_template: templateName || 'UNKNOWN',
                        b_filters: filtersJson,
                        b_sheet: sheetName || ''
                    }
                );
            }

            await connection.commit();
            res.json({ success: true, version: version || '1.0', action: 'SAVE' });
        }
    } catch (err) {
        console.error('Update Extraction Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.get('/api/fbdi/extraction/download-spec/:modelId/:extractionId', async (req, res) => {
    const { modelId, extractionId } = req.params;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const modelRes = await connection.execute(
            `SELECT MODEL_NAME FROM XX_INTELLI_MODELS WHERE MODEL_ID = :id`,
            { id: modelId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const specRes = await connection.execute(
            `SELECT EXTRACTION_NAME, VERSION, COLUMN_MAPPINGS, DATA_FILTERS FROM XX_INTELLI_MODEL_EXTRACTIONS WHERE ID = :id`,
            { id: extractionId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (modelRes.rows.length === 0 || specRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Specification not found' });
        }

        const modelName = modelRes.rows[0].MODEL_NAME;
        const spec = specRes.rows[0];
        const mappings = JSON.parse(spec.COLUMN_MAPPINGS || '[]');
        const filters = JSON.parse(spec.DATA_FILTERS || '[]');

        const wb = XLSX.utils.book_new();

        // Sheet 1: Mappings
        const mappingData = mappings.map(m => ({
            'Target Name': m.targetName || m.name,
            'Source Field': m.sourceField || 'Literal/Transformation',
            'Rules': (m.transformations || []).map(t => t.type).join(' -> ')
        }));
        const wsMappings = XLSX.utils.json_to_sheet(mappingData);
        XLSX.utils.book_append_sheet(wb, wsMappings, 'Field Mappings');

        // Sheet 2: Filters
        const filterData = filters.map(f => ({
            'Field': f.field || f.column,
            'Operator': f.operator,
            'Value': f.value
        }));
        const wsFilters = XLSX.utils.json_to_sheet(filterData);
        XLSX.utils.book_append_sheet(wb, wsFilters, 'Data Filters');

        // Sheet 3: Metadata
        const metaData = [
            { 'Property': 'Model', 'Value': modelName },
            { 'Property': 'Extraction', 'Value': spec.EXTRACTION_NAME },
            { 'Property': 'Version', 'Value': spec.VERSION },
            { 'Property': 'Export Date', 'Value': new Date().toISOString() }
        ];
        const wsMeta = XLSX.utils.json_to_sheet(metaData);
        XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadata');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${spec.EXTRACTION_NAME.replace(/\s/g, '_')}_v${spec.VERSION}.xlsx"`);
        res.send(buf);

    } catch (err) {
        console.error('Download Spec Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { }
        }
    }
});

app.get('/api/fbdi/saved-models', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();
        const result = await connection.execute(
            `SELECT MODEL_ID, MODEL_NAME, TEMPLATENAME, USERNAME, USER_ID FROM XX_INTELLI_MODELS ORDER BY MODEL_ID DESC`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // FAST RESPONSE: No eager loading of details here anymore
        res.json({
            success: true,
            models: result.rows,
            latestModelDetail: null // Deferred to bulk or on-demand
        });
    } catch (err) {
        console.error('Fetch Models Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

// FBDI Assistant Chat Endpoint
app.post('/api/assistant/chat', upload.single('file'), async (req, res) => {
    const { message, history: historyRaw, fusionConfigs: fusionConfigsRaw } = req.body;
    let history = [];
    let fusionConfigs = [];
    try {
        history = historyRaw ? JSON.parse(historyRaw) : [];
        fusionConfigs = fusionConfigsRaw ? JSON.parse(fusionConfigsRaw) : [];
    } catch (e) { console.warn("Context parse error", e); }

    const file = req.file;
    let connection;
    try {
        connection = await dbPool.getConnection();

        // Enriched Model Metadata for context (deep exploration)
        const modelsResult = await connection.execute(
            `SELECT 
                m.MODEL_ID, 
                m.MODEL_NAME, 
                a.TABLES, 
                a.EXTRACTIONS
             FROM XX_INTELLI_MODELS m
             LEFT JOIN XX_INTELLI_MODEL_ARCHITECTURE a ON m.MODEL_NAME = a.MODEL_NAME
             ORDER BY m.MODEL_ID DESC
             FETCH FIRST 15 ROWS ONLY`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const modelIds = modelsResult.rows.map(r => r.MODEL_ID);
        let extractionsMap = {};

        if (modelIds.length > 0) {
            const bindNames = modelIds.map((_, i) => `:id${i}`).join(',');
            const binds = {};
            modelIds.forEach((id, i) => binds[`id${i}`] = id);

            // Fetch all extractions and we will select latest version in JS for robustness
            const extractionRes = await connection.execute(
                `SELECT MODEL_ID, ID, EXTRACTION_NAME, VERSION, COLUMN_MAPPINGS, DATA_FILTERS 
                 FROM XX_INTELLI_MODEL_EXTRACTIONS 
                 WHERE MODEL_ID IN (${bindNames})
                 ORDER BY MODEL_ID, EXTRACTION_NAME, VERSION DESC`,
                binds,
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            extractionRes.rows.forEach(e => {
                const mid = e.MODEL_ID;
                if (!extractionsMap[mid]) extractionsMap[mid] = {};

                // Only keep the first (latest because of ORDER BY VERSION DESC) one for each name
                if (!extractionsMap[mid][e.EXTRACTION_NAME]) {
                    extractionsMap[mid][e.EXTRACTION_NAME] = {
                        id: e.ID,
                        name: e.EXTRACTION_NAME,
                        version: e.VERSION,
                        mappings: e.COLUMN_MAPPINGS,
                        filters: e.DATA_FILTERS
                    };
                }
            });

            // Convert to array format expected by assistantService
            Object.keys(extractionsMap).forEach(mid => {
                extractionsMap[mid] = Object.values(extractionsMap[mid]);
            });
        }

        const modelsWithExtractions = modelsResult.rows.map(row => ({
            ...row,
            EXTRACTION_DETAILS: extractionsMap[row.MODEL_ID] || []
        }));


        let fileInfo = null;
        if (file) {
            console.log(`[Assistant] Processing uploaded file: ${file.originalname}`);
            const filePath = file.path;
            const ext = path.extname(file.originalname).toLowerCase();

            if (ext === '.xlsx' || ext === '.xlsm') {
                // RUN METADATA EXTRACTION SCRIPT FOR EXCEL
                console.log(`[Assistant] Excel detected. Running metadata extractor...`);
                const extractorScript = path.join(__dirname, 'scripts', 'extract_fbdi_metadata.js');
                const result = spawnSync('node', [extractorScript, filePath]);

                if (result.status === 0) {
                    const metadata = result.stdout.toString();
                    fileInfo = {
                        name: file.originalname,
                        type: 'FBDI_TEMPLATE',
                        content: metadata
                    };
                } else {
                    console.warn(`[Assistant] Metadata extraction failed:`, result.stderr.toString());
                    fileInfo = { name: file.originalname, content: "Error: Could not extract metadata from Excel file." };
                }
                fs.unlinkSync(filePath);
            } else if (ext === '.zip') {
                // Keep ZIP files for Fusion loading
                console.log(`[Assistant] ZIP detected. Keeping for potential Fusion load.`);
                fileInfo = {
                    name: file.originalname,
                    serverFilename: file.filename,
                    type: 'ZIP_ARCHIVE'
                };
                // DO NOT UNLINK
            } else {
                // Standard text file handling
                const content = fs.readFileSync(filePath, 'utf8');
                fileInfo = {
                    name: file.originalname,
                    content: content.substring(0, 50000)
                };
                fs.unlinkSync(filePath);
            }
        }

        let assistantResponse = await processAssistantChatOCI(message, history, {
            models: modelsWithExtractions,
            fileInfo: fileInfo,
            fusionConfigs: fusionConfigs
        });

        // Handle Tool Use (Recursive loop if Claude wants to query DB)
        let toolLoopCount = 0;
        const MAX_TOOL_LOOPS = 3;

        while (assistantResponse.tool_use && toolLoopCount < MAX_TOOL_LOOPS) {
            toolLoopCount++;
            const tool = assistantResponse.tool_use;
            let toolResult;

            console.log(`[Assistant] Executing DB tool: ${tool.name}`);

            if (tool.name === 'search_models') {
                const searchRes = await connection.execute(
                    `SELECT MODEL_ID, MODEL_NAME, TEMPLATENAME FROM XX_INTELLI_MODELS 
                     WHERE UPPER(MODEL_NAME) LIKE UPPER(:b_term) OR UPPER(TEMPLATENAME) LIKE UPPER(:b_term)`,
                    { b_term: `%${tool.input.searchTerm}%` },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                toolResult = searchRes.rows;
            } else if (tool.name === 'get_model_architecture') {
                const arch = await getSavedModelDetailInternal(connection, tool.input.modelId);
                toolResult = {
                    modelName: arch.group.name,
                    tables: arch.group.objects.map(o => o.tableName),
                    relationships: arch.group.relationships
                };
            } else if (tool.name === 'get_table_columns') {
                const colsRes = await connection.execute(
                    `SELECT column_name, data_type FROM user_tab_columns 
                     WHERE table_name = UPPER(:b_table) ORDER BY column_id`,
                    { b_table: tool.input.tableName },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                toolResult = colsRes.rows;
            } else if (tool.name === 'get_model_extractions') {
                const specRes = await connection.execute(
                    `SELECT ID, EXTRACTION_NAME, VERSION FROM XX_INTELLI_MODEL_EXTRACTIONS 
                     WHERE MODEL_ID = :b_mid ORDER BY VERSION DESC`,
                    { b_mid: tool.input.modelId },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT }
                );
                toolResult = specRes.rows;
            }

            // Feed tool result back to Claude
            // In a real multi-turn flow, we'd add this to the message history.
            // For now, we'll use a simplified re-prompting approach or update processAssistantChat to handle this.
            // Let's update processAssistantChat to accept tool results.
            assistantResponse = await processAssistantChat(
                `The result for ${tool.name} is: ${JSON.stringify(toolResult)}. Please continue your response based on this.`,
                { models: modelsResult.rows }
            );
        }

        res.json(assistantResponse);
    } catch (err) {
        console.error('Assistant Chat Error:', err);
        res.status(500).json({ reply: 'An error occurred in the assistant.', action_required: false });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});


app.post('/api/fbdi/saved-models-bulk', async (req, res) => {
    const { modelIds } = req.body;
    if (!modelIds || !Array.isArray(modelIds)) {
        return res.status(400).json({ success: false, message: "modelIds array required" });
    }

    let connection;
    try {
        connection = await dbPool.getConnection();
        const details = [];

        // Use a loop for now, but in the same connection for better performance than multiple roundtrips
        for (const id of modelIds) {
            try {
                const detail = await getSavedModelDetailInternal(connection, id);
                details.push(detail);
            } catch (err) {
                console.warn(`Failed to fetch detail for model ${id}:`, err.message);
            }
        }

        res.json({ success: true, details });
    } catch (err) {
        console.error('Bulk Fetch Models Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

async function getSavedModelDetailInternal(connection, modelId) {
    // 1. Get Model Info
    const modelRes = await connection.execute(
        `SELECT MODEL_NAME, TEMPLATENAME FROM XX_INTELLI_MODELS WHERE MODEL_ID = :b_id`,
        { b_id: modelId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (modelRes.rows.length === 0) {
        throw new Error('Model not found');
    }
    const model = modelRes.rows[0];

    // 2. Get Architecture
    const archRes = await connection.execute(
        `SELECT TABLES, RELATIONSHIPS, TEMPLATENAME FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name`,
        { b_name: model.MODEL_NAME },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let tablesCsv = '';
    let storedRelationships = [];
    if (archRes.rows && archRes.rows.length > 0) {
        const rawTables = archRes.rows[0].TABLES;
        if (rawTables) {
            tablesCsv = typeof rawTables === 'string' ? rawTables : String(rawTables);
        }

        const rawRels = archRes.rows[0].RELATIONSHIPS;
        if (rawRels) {
            try {
                const relStr = typeof rawRels === 'string' ? rawRels : String(rawRels);
                storedRelationships = JSON.parse(relStr);
            } catch (e) {
                console.error("Failed to parse stored relationships:", e);
            }
        }
    }

    const tableNames = tablesCsv.split(',').map(s => s.trim()).filter(Boolean);

    // 3. Reconstruct Object Schema
    const objects = [];
    if (tableNames.length > 0) {
        const bindNames = tableNames.map((_, i) => `:tbl${i}`).join(', ');
        const binds = {};
        tableNames.forEach((name, i) => { binds[`tbl${i}`] = name.toUpperCase(); });

        const columnsResult = await connection.execute(
            `SELECT table_name, column_name, data_type 
             FROM user_tab_columns 
             WHERE table_name IN (${bindNames}) 
             ORDER BY table_name, column_id`,
            binds,
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const tableGroups = {};
        columnsResult.rows.forEach(row => {
            const tName = row.TABLE_NAME;
            if (!tableGroups[tName]) tableGroups[tName] = [];
            tableGroups[tName].push({
                name: row.COLUMN_NAME,
                type: mapOracleType(row.DATA_TYPE),
                description: row.DATA_TYPE
            });
        });

        for (const tableName of tableNames) {
            const upperName = tableName.toUpperCase();
            if (tableGroups[upperName]) {
                objects.push({
                    id: tableName,
                    name: toTitleCase(tableName),
                    tableName: tableName,
                    fields: tableGroups[upperName]
                });
            }
        }
    }

    // 4. Get Latest Extractions (Versions)
    const specRes = await connection.execute(
        `SELECT ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, LOAD_FILE_NAME 
         FROM XX_INTELLI_MODEL_EXTRACTIONS e 
         WHERE MODEL_ID = :b_id 
         AND VERSION = (
             SELECT MAX(VERSION) FROM XX_INTELLI_MODEL_EXTRACTIONS e2 
             WHERE e2.MODEL_ID = e.MODEL_ID AND e2.EXTRACTION_NAME = e.EXTRACTION_NAME
         )`,
        { b_id: modelId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const specifications = specRes.rows.map(row => {
        let cols = [];
        try {
            const mappingStr = typeof row.COLUMN_MAPPINGS === 'string' ? row.COLUMN_MAPPINGS : (row.COLUMN_MAPPINGS ? String(row.COLUMN_MAPPINGS) : '[]');
            cols = JSON.parse(mappingStr);
        } catch (e) {
            console.error(`Failed to parse mappings for spec ${row.EXTRACTION_NAME}`);
        }

        let flts = [];
        try {
            const filterStr = typeof row.DATA_FILTERS === 'string' ? row.DATA_FILTERS : (row.DATA_FILTERS ? String(row.DATA_FILTERS) : '[]');
            flts = JSON.parse(filterStr);
        } catch (e) {
            console.error(`Failed to parse filters for spec ${row.EXTRACTION_NAME}`);
        }

        return {
            id: `spec_db_${row.ID}`,
            name: row.EXTRACTION_NAME,
            version: row.VERSION || '1.0',
            objectGroupId: `grp_db_${modelId}`,
            columns: cols,
            filters: flts,
            format: row.TEMPLATENAME?.toLowerCase().includes('csv') ? 'csv' : 'fbdi',
            backendTemplateName: row.TEMPLATENAME,
            sheetName: row.LOAD_FILE_NAME,
            createdAt: new Date().toISOString()
        };
    });

    // 5. Discover Joins (Prioritize stored relationships)
    let relationships = [];
    if (storedRelationships && storedRelationships.length > 0) {
        console.log(`Using ${storedRelationships.length} stored relationships for model ${model.MODEL_NAME}`);
        // Clean up legacy IDs (strip 'obj_' prefix)
        relationships = storedRelationships.map(rel => ({
            ...rel,
            sourceObjectId: rel.sourceObjectId?.startsWith('obj_') ? rel.sourceObjectId.replace('obj_', '') : rel.sourceObjectId,
            targetObjectId: rel.targetObjectId?.startsWith('obj_') ? rel.targetObjectId.replace('obj_', '') : rel.targetObjectId
        }));
    } else {
        const discoveredJoins = await getDiscoveredJoins(connection, tableNames);
        relationships = discoveredJoins.map(rel => {
            const srcObj = objects.find(o => o.tableName.toUpperCase() === rel.sourceTable.toUpperCase());
            const trgObj = objects.find(o => o.tableName.toUpperCase() === rel.targetTable.toUpperCase());
            if (srcObj && trgObj) {
                return {
                    sourceObjectId: srcObj.id,
                    targetObjectId: trgObj.id,
                    joinType: rel.joinType || 'INNER',
                    condition: rel.condition
                };
            }
            return null;
        }).filter(Boolean);
    }

    return {
        group: {
            id: `grp_db_${modelId}`,
            modelId: modelId,
            name: model.MODEL_NAME,
            templateName: model.TEMPLATENAME || (archRes.rows && archRes.rows[0].TEMPLATENAME) || 'UNKNOWN',
            databaseType: 'ORACLE',
            objects: objects,
            relationships: relationships
        },
        specifications: specifications
    };
}

app.get('/api/fbdi/saved-model/:modelId', async (req, res) => {
    const { modelId } = req.params;
    let connection;
    try {
        connection = await dbPool.getConnection();
        const detail = await getSavedModelDetailInternal(connection, modelId);
        res.json({ success: true, ...detail });
    } catch (err) {
        console.error('Fetch Saved Model Detail Error:', err);
        res.status(err.message === 'Model not found' ? 404 : 500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

// Start Server
const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

function mapOracleType(oracleType) {
    if (!oracleType) return 'STRING';
    const type = oracleType.toString().toUpperCase();
    if (type.includes('CHAR') || type.includes('CLOB') || type.includes('XML')) return 'STRING';
    if (type.includes('NUMBER') || type.includes('FLOAT') || type.includes('INT')) return 'NUMBER';
    if (type.includes('DATE') || type.includes('TIMESTAMP')) return 'DATE';
    return 'STRING';
}

function toTitleCase(str) {
    if (!str) return '';
    return str.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
}
