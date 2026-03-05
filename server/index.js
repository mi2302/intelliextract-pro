require('dotenv').config();
const express = require('express');
const cors = require('cors');
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB];
const archiver = require('archiver'); // Added archiver

const app = express();
const PORT = 3006;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { spawn } = require('child_process');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Storage for templates
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'templates/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

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

async function initializeDatabase() {
    let connection;
    try {
        const dbConfig = getDbConfig();
        const { user, password, connectString } = dbConfig;

        // console.log('Environment Debug:', {
        //     raw_password_length: (process.env.DB_PASSWORD || '').length,
        //     processed_password_length: password.length,
        //     processed_password_first: password.charAt(0),
        //     processed_password_last: password.charAt(password.length - 1),
        //     has_dollar: password.includes('$')
        // });

        // console.log('Attempting connection with:', {
        //     user,
        //     connectString,
        //     passwordLength: password.length
        // });

        connection = await oracledb.getConnection(dbConfig);

        console.log('Connected to Oracle Database');
    } catch (err) {
        console.error('Oracle DB Initialization Error:', err);
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('Error closing connection:', err);
            }
        }
    }
}

// Initialize DB on startup
initializeDatabase();

// Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', datetime: new Date().toISOString() });
});

// OCI Service Import
const { analyzeFbdiWithOCI } = require('./services/ociService');

app.post('/api/analyze-fbdi', async (req, res) => {
    try {
        console.log("Analyzing FBDI via OCI:", req.body.fileName);
        const result = await analyzeFbdiWithOCI(req.body);
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
    }
});

app.get('/api/modules', async (req, res) => {
    let connection;
    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        const result = await connection.execute(
            `SELECT DISTINCT DATA_GROUP AS GROUP_NAME FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING WHERE DATA_GROUP IS NOT NULL ORDER BY DATA_GROUP`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // result.rows = [{ GROUP_NAME: 'Procurement' }, ...]
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
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);
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

app.post('/api/module-columns', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName } = req.body;
    let connection;

    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        if (!moduleName && (!sheetNames || sheetNames.length === 0)) {
            return res.status(400).json({ success: false, message: 'Module name or sheet names are required' });
        }

        // Call xx_dbms_session first before querying mapping tables
        try {
            console.log("Executing xx_dbms_session...");
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) {
            console.warn("Failed to execute xx_dbms_session, continuing anyway:", sessionErr.message);
        }

        let objectsSql = '';
        let binds = {};

        if (sheetNames && sheetNames.length > 0) {
            console.log(`[Mappings API] Searching for Tables by Sheet Names: ${sheetNames.join(', ')}`);
            const bindNames = sheetNames.map((_, i) => `:sheet${i}`).join(', ');
            sheetNames.forEach((name, i) => {
                binds[`sheet${i}`] = name.toUpperCase();
            });

            objectsSql = `
                SELECT DISTINCT DATA_IDENTIFIER, TABLE_NAME
                FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING
                WHERE UPPER(DATA_IDENTIFIER) IN (${bindNames})
            `;
        } else {
            const searchTerm = `%${moduleName.toUpperCase()}%`;
            const exactTerm = moduleName.toUpperCase();
            binds = { exactTerm, searchTerm };
            objectsSql = `
                SELECT DISTINCT DATA_IDENTIFIER, TABLE_NAME 
                FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING 
                WHERE UPPER(DATA_IDENTIFIER) = :exactTerm
                   OR UPPER(DATA_GROUP) = :exactTerm
                   OR UPPER(DATA_IDENTIFIER) LIKE :searchTerm 
                   OR UPPER(DATA_GROUP) LIKE :searchTerm
            `;
        }

        const objectsResult = await connection.execute(objectsSql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Found ${objectsResult.rows.length} mappings in Recon Mapping.`);

        let mappings = objectsResult.rows;
        let tables = mappings.map(m => m.TABLE_NAME).filter(Boolean);
        console.log("Tables Which are in recon mapping:", tables);
        // GRANULAR FALLBACK: If specific sheets are missing, search xxfw_dm_objects_v
        if (sheetNames && sheetNames.length > 0) {
            const foundIdentifiers = mappings.map(m => (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
            const missingSheets = sheetNames.filter(s => !foundIdentifiers.includes(s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));

            if (missingSheets.length > 0) {
                console.log(`[Fallback] Sheets missing from Recon Mapping: ${missingSheets.join(', ')}`);

                for (const sheet of missingSheets) {
                    const searchVal = (analysisModuleName || moduleName || sheet).toUpperCase();
                    const fbSql = `
                        SELECT DISTINCT 
                            TABLE_NAME 
                        FROM XXEA_DM_TABLE_COL_DEF 
                        WHERE UPPER(GROUP_NAME) = UPPER(:analysisModuleName)
                          AND TABLE_STORE = 'Master Data Store'
                    `;
                    const fbResult = await connection.execute(fbSql, {
                        analysisModuleName: searchVal
                    }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                    const fbTables = fbResult.rows.map(row => row.TABLE_NAME).filter(Boolean);
                    if (fbTables.length > 0) {
                        console.log(`[Fallback] Discovered ${fbTables.length} tables for missing sheet '${sheet}': ${fbTables.join(', ')}`);
                        tables = [...new Set([...tables, ...fbTables])];
                    }
                }
            }
        } else if (tables.length === 0 && (moduleName || analysisModuleName)) {
            // General fallback
            const searchVal = (analysisModuleName || moduleName).toUpperCase();

            console.log(`[General Fallback] Searching xxfw_dm_objects_v for module: ${searchVal}`);
            const fbSql = `
                SELECT DISTINCT TABLE_NAME 
                FROM XXEA_DM_TABLE_COL_DEF 
                WHERE UPPER(GROUP_NAME) = UPPER(:analysisModuleName)
                  AND TABLE_STORE = 'Master Data Store'
            `;
            const fbResult = await connection.execute(fbSql, {
                analysisModuleName: searchVal
            });
            tables = fbResult.rows.map(row => row[0]).filter(Boolean);
        }

        tables = [...new Set(tables)]; // Ensure uniqueness
        console.log("Final Tables list for schema extraction:", tables);

        if (tables.length === 0) {
            return res.json({ success: true, objects: [] });
        }

        if (tables.length === 0) {
            return res.json({ success: true, objects: [] });
        }

        const objects = [];

        // Step 2: Fetch Columns for each table
        for (const tableName of tables) {
            console.log(`Fetching columns for table: ${tableName}`);
            const columnsSql = `
                SELECT column_name, data_type 
                FROM user_tab_columns 
                WHERE table_name = UPPER(:tbl)
                ORDER BY column_id
            `;
            const columnsResult = await connection.execute(columnsSql, [tableName]);

            if (columnsResult.rows.length > 0) {
                const fields = columnsResult.rows.map(row => ({
                    name: row[0],
                    type: mapOracleType(row[1]),
                    description: row[1]
                }));

                objects.push({
                    id: `obj_${tableName}`,
                    name: toTitleCase(tableName),
                    tableName: tableName,
                    fields: fields
                });
            }
        }

        res.json({
            success: true,
            moduleName: moduleName,
            objects: objects
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

app.post('/api/fbdi-mappings', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName } = req.body;
    let connection;

    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        if (!moduleName && (!sheetNames || sheetNames.length === 0)) {
            return res.status(400).json({ success: false, message: 'Module name or sheet names are required' });
        }

        let sql = '';
        let binds = {};

        if (sheetNames && sheetNames.length > 0) {
            console.log(`[Mappings API] Searching for column mappings by Sheet Names: ${sheetNames.join(', ')}`);
            const bindNames = sheetNames.map((_, i) => `:sheet${i}`).join(', ');
            sheetNames.forEach((name, i) => {
                binds[`sheet${i}`] = name.toUpperCase();
            });

            sql = `
                SELECT 
                    DATA_IDENTIFIER, 
                    TABLE_NAME, 
                    COLUMN_NAME, 
                    METADATA_COLUMN_HEADER 
                FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING 
                WHERE UPPER(DATA_IDENTIFIER) IN (${bindNames})
            `;
        } else {
            const searchTerm = `%${moduleName.toUpperCase()}%`;
            const exactTerm = moduleName.toUpperCase();
            console.log(`[Mappings API] Searching for column mappings by Main Object like: ${searchTerm} or exact: ${exactTerm}`);
            binds = { exactTerm, searchTerm };

            sql = `
                SELECT 
                    DATA_IDENTIFIER, 
                    TABLE_NAME, 
                    COLUMN_NAME, 
                    METADATA_COLUMN_HEADER 
                FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING 
                WHERE UPPER(DATA_IDENTIFIER) = :exactTerm
                   OR UPPER(DATA_GROUP) = :exactTerm
                   OR UPPER(DATA_IDENTIFIER) LIKE :searchTerm 
                   OR UPPER(DATA_GROUP) LIKE :searchTerm
            `;
        }

        try {
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) { }

        let result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        let allMappings = result.rows;

        // GRANULAR FALLBACK: If specific sheets are missing, search xxfw_dm_objects_v
        if (sheetNames && sheetNames.length > 0) {
            const foundIdentifiers = new Set(allMappings.map(m => (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));
            const missingSheets = sheetNames.filter(s => !foundIdentifiers.has(s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));

            if (missingSheets.length > 0) {
                console.log(`[Fallback Mappings] Sheets missing from Recon Mapping: ${missingSheets.join(', ')}`);
                console.log(`analysisModuleName : ${analysisModuleName}`)
                console.log(`moduleName : ${moduleName}`)

                for (const sheet of missingSheets) {
                    const searchVal = (analysisModuleName || moduleName || sheet).toUpperCase();
                    console.log(`Fall back searching value is : ${searchVal}`)
                    console.log(`sheet : ${sheet}`)
                    const fbSql = `
                        SELECT DISTINCT
                            UPPER(:sheet) as DATA_IDENTIFIER, 
                            TABLE_NAME,
                            COLUMN_NAME,
                            BUSINESS_COLUMN_NAME as METADATA_COLUMN_HEADER
                        FROM XXEA_DM_TABLE_COL_DEF 
                        WHERE UPPER(GROUP_NAME) = UPPER(:analysisModuleName)
                          AND TABLE_STORE = 'Master Data Store'
                    `;
                    const fbResult = await connection.execute(fbSql, {
                        sheet: sheet,
                        analysisModuleName: searchVal
                    }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                    // console.log(`fbResult : ${JSON.stringify(fbResult)}`)
                    // console.log(`[Fallback Mappings] Discovered ${fbResult.rows.length} mappings for missing sheet '${sheet}' using fallback discovery.`);
                    if (fbResult.rows.length > 0) {
                        console.log(`[Fallback Mappings] Discovered ${fbResult.rows.length} mappings for missing sheet '${sheet}' using fallback discovery.`);
                        allMappings = [...allMappings, ...fbResult.rows];
                    }
                    // console.log(`allMappings : ${JSON.stringify(allMappings)}`)
                }
            }
        } else if (allMappings.length === 0 && (moduleName || analysisModuleName)) {
            // General fallback
            const searchVal = (analysisModuleName || moduleName).toUpperCase();
            console.log(`[General Fallback Mappings] Searching XXEA_DM_TABLE_COL_DEF for module: ${searchVal}`);
            const fbSql = `
                SELECT DISTINCT 
                    UPPER(GROUP_NAME) as DATA_IDENTIFIER, 
                    TABLE_NAME,
                    COLUMN_NAME,
                    BUSINESS_COLUMN_NAME as METADATA_COLUMN_HEADER
                FROM XXEA_DM_TABLE_COL_DEF 
                WHERE UPPER(GROUP_NAME) = UPPER(:analysisModuleName)
                  AND TABLE_STORE = 'Master Data Store'
            `;
            const fbResult = await connection.execute(fbSql, {
                analysisModuleName: searchVal
            }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            allMappings = fbResult.rows;
        }

        res.json({
            success: true,
            mappings: allMappings
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

app.get('/api/tables', async (req, res) => {
    let connection;

    try {
        const dbConfig = getDbConfig(); // Use credentials from .env
        connection = await oracledb.getConnection(dbConfig);

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
app.post('/api/upload-template', upload.single('template'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    res.json({ success: true, filename: req.file.filename });
});

app.post('/api/extract-batch', async (req, res) => {
    const { specs, exportFormat, templateFile } = req.body;
    if (!specs || !Array.isArray(specs)) return res.status(400).json({ success: false, message: 'Invalid specs' });

    let connection;
    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        try {
            console.log("[BATCH] Executing xx_dbms_session...");
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) {
            console.warn("[BATCH] Failed to execute xx_dbms_session:", sessionErr.message);
        }

        // --- OPTIMIZATION: Bulk check XX_VERSION existence for all tables in one query ---
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
        // ---------------------------------------------------------------------------------

        const results = [];
        for (const spec of specs) {
            const { columns, joins, sheetName } = spec;

            // Generate Query
            let query = 'SELECT ';
            query += columns.filter(Boolean).map(c => {
                let colExpr = '';
                if (c.expression && c.expression !== 'NULL') {
                    colExpr = c.expression;
                } else if (c.table && c.column) {
                    colExpr = `${quoteIdentifier(c.table)}.${quoteIdentifier(c.column)}`;
                } else {
                    colExpr = 'NULL';
                }

                if (c.transformations) {
                    c.transformations.forEach(t => {
                        if (t.type === 'UPPERCASE') colExpr = `UPPER(${colExpr})`;
                        if (t.type === 'LOWERCASE') colExpr = `LOWER(${colExpr})`;
                        if (t.type === 'TRIM') colExpr = `TRIM(${colExpr})`;
                    });
                }
                const aliasName = c.alias ? c.alias : 'UNKNOWN_COLUMN';
                return `${colExpr} AS "${aliasName}"`;
            }).join(', ');

            const tables = [...new Set(columns.filter(c => c && c.table).map(c => c.table))];
            if (tables.length === 0) {
                query += ' FROM DUAL';
            } else {
                query += ` FROM ${quoteIdentifier(tables[0])}`;
                if (joins && joins.length > 0) {
                    joins.forEach(j => {
                        if (j.rightTable && j.condition) {
                            // Note: condition is usually raw SQL, don't quote automatically
                            query += ` ${j.type || 'LEFT'} JOIN ${quoteIdentifier(j.rightTable)} ON ${j.condition}`;
                        }
                    });
                }

                // Ensure we only extract the latest version for each table (if XX_VERSION actually exists)
                const versionConditions = [];
                for (const t of tables) {
                    // Optimized: Sync check against pre-fetched Set instead of N+1 await queries
                    if (tablesWithVersion.has(t.toUpperCase())) {
                        versionConditions.push(`${quoteIdentifier(t)}.XX_VERSION = (SELECT MAX(XX_VERSION) FROM ${quoteIdentifier(t)})`);
                    }
                }

                if (versionConditions.length > 0) {
                    query += ` WHERE ${versionConditions.join(' AND ')}`;
                }
            }

            console.log(`[BATCH] SQL for ${sheetName}:`, query);
            let result;
            try {
                result = await connection.execute(query);
            } catch (queryErr) {
                console.error(`[BATCH] Query Failed for ${sheetName}:`, queryErr.message);
                console.error(`[BATCH] Failing Query:`, query);
                throw { message: `${queryErr.message} in sheet ${sheetName}`, query: query };
            }
            const rows = result.rows.map(row => {
                const rowObj = {};
                result.metaData.forEach((m, i) => { rowObj[m.name] = row[i]; });
                return rowObj;
            });

            results.push({
                sheetName,
                columns,
                data: rows
            });
        }

        const format = (exportFormat || '').toUpperCase();
        if (format === 'FBDI') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="Consolidated_FBDI_${Date.now()}.zip"`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            archive.on('error', (err) => {
                console.error('[BATCH] Archiver error:', err);
                if (!res.headersSent) res.status(500).json({ success: false, message: 'Archive generation failed' });
            });

            // Loop through each sheet and create a CSV file inside the zip
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
                        if (val.includes(',') || val.includes('\n') || val.includes('"')) {
                            return `"${val}"`;
                        }
                        return val;
                    }).join(',');
                    csvContent += line + '\n';
                });

                archive.append(csvContent, { name: `${sheetName}.csv` });
            }

            await archive.finalize();
            return;
        }

        res.json({ success: true, results });

    } catch (err) {
        console.error('Batch Extraction Error:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// Extraction Engine (Single)
app.post('/api/extract', async (req, res) => {
    const { columns, joins, limit, templateFile, sheetName, exportFormat } = req.body;
    let connection;

    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        try {
            console.log("[EXTRACT] Executing xx_dbms_session...");
            await connection.execute(`BEGIN xxdm1.xx_dbms_session(1000); END;`);
        } catch (sessionErr) {
            console.warn("[EXTRACT] Failed to execute xx_dbms_session:", sessionErr.message);
        }

        if (!columns || columns.length === 0) {
            return res.status(400).json({ success: false, message: 'No columns specified' });
        }

        // 1. Build Query
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
                    // Note: Other transformations (DATE_FORMAT, CONCAT etc.) can be added here if needed
                });
            }
            return `${colExpr} AS "${c.alias}"`;
        }).join(', ');

        const tables = [...new Set(columns.filter(c => c && c.table).map(c => c.table))];
        if (tables.length === 0) {
            query += ' FROM DUAL';
        } else {
            const primaryTable = tables[0];
            query += ` FROM ${quoteIdentifier(primaryTable)}`;

            const joinedTables = new Set([primaryTable]);

            if (joins && joins.length > 0) {
                joins.forEach(j => {
                    if (j.rightTable && j.condition) {
                        query += ` ${j.type || 'LEFT'} JOIN ${quoteIdentifier(j.rightTable)} ON ${j.condition}`;
                        joinedTables.add(j.rightTable);
                    }
                });
            }

            // Tables that weren't joined but are required (cross join style)
            tables.forEach(t => {
                if (!joinedTables.has(t)) {
                    query += `, ${quoteIdentifier(t)}`;
                    joinedTables.add(t);
                }
            });

            // --- OPTIMIZATION: Bulk check XX_VERSION existence for all joined tables ---
            const tablesWithVersion = new Set();
            if (tables.length > 0) {
                try {
                    const binds = {};
                    const bindNames = tables.map((_, i) => `:tbl${i}`).join(', ');
                    tables.forEach((tbl, i) => { binds[`tbl${i}`] = tbl; });

                    const versionCheckSql = `
                        SELECT table_name 
                        FROM user_tab_columns 
                        WHERE column_name = 'XX_VERSION' 
                          AND table_name IN (${bindNames})
                    `;
                    const versionResult = await connection.execute(versionCheckSql, binds);
                    versionResult.rows.forEach(row => tablesWithVersion.add(row[0]));
                } catch (err) {
                    console.warn("Bulk XX_VERSION check failed:", err.message);
                }
            }

            // Ensure we only extract the latest version for each table (if XX_VERSION actually exists)
            const versionConditions = [];
            for (const t of tables) {
                if (tablesWithVersion.has(t.toUpperCase())) {
                    versionConditions.push(`${quoteIdentifier(t)}.XX_VERSION = (SELECT MAX(XX_VERSION) FROM ${quoteIdentifier(t)})`);
                }
            }

            if (versionConditions.length > 0) {
                query += ` WHERE ${versionConditions.join(' AND ')}`;
            }
        }

        if (limit) {
            query += ` FETCH NEXT ${limit} ROWS ONLY`;
        } // Oracle 12c+ syntax for limit

        console.log('Running Extraction Query:', query);
        let result;
        try {
            result = await connection.execute(query);
        } catch (queryErr) {
            console.error('Individual Extraction Query Failed:', queryErr.message);
            throw { message: queryErr.message, query: query };
        }
        const meta = result.metaData;
        const rows = result.rows.map(row => {
            const rowObj = {};
            meta.forEach((m, i) => {
                rowObj[m.name] = row[i];
            });
            return rowObj;
        });

        const format = (exportFormat || '').toUpperCase();
        if (format === 'FBDI') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="FBDI_${sheetName}_${Date.now()}.zip"`);

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

app.post('/api/save-model', async (req, res) => {
    const { modelName, templateName, username, userId, objects, specs } = req.body;
    let connection;

    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        // 1. Insert/Check Model in XX_INTELLI_MODELS
        let modelId;
        const checkModel = await connection.execute(
            `SELECT MODEL_ID FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :b_name`,
            { b_name: modelName }
        );

        if (checkModel.rows.length > 0) {
            modelId = checkModel.rows[0][0];
            console.log(`Model ${modelName} already exists with ID: ${modelId}`);
        } else {
            console.log(`Inserting new model into XX_INTELLI_MODELS: ${modelName}, Template: ${templateName}`);
            const result = await connection.execute(
                `INSERT INTO XX_INTELLI_MODELS (MODEL_NAME, USERNAME, USER_ID, TEMPLATENAME) 
                 VALUES (:b_name, :b_user, :b_uid, :b_template) 
                 RETURNING MODEL_ID INTO :b_id`,
                {
                    b_name: modelName,
                    b_user: username || 'GUEST',
                    b_uid: userId || '1001',
                    b_template: templateName || 'UNKNOWN',
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
        await connection.execute(
            `INSERT INTO XX_INTELLI_MODEL_ARCHITECTURE (MODEL_NAME, TABLES, EXTRACTIONS, TEMPLATENAME) 
             VALUES (:b_name, :b_tables, :b_specs, :b_template)`,
            {
                b_name: modelName,
                b_tables: tablesList,
                b_specs: specsList,
                b_template: templateName || 'UNKNOWN'
            }
        );

        // 3. Persist Individual Extractions into XX_INTELLI_EXTRACTIONS
        if (specs && Array.isArray(specs)) {
            console.log(`Persisting ${specs.length} extraction specs into XX_INTELLI_EXTRACTIONS for Model ID: ${modelId}`);

            for (const spec of specs) {
                // Check if extraction exists for this model
                const checkExt = await connection.execute(
                    `SELECT ID FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
                    { b_mid: modelId, b_ename: spec.name }
                );

                const mappingsJson = JSON.stringify(spec.columns || []);
                const sqlQuery = spec.sqlQuery || ''; // Use if provided

                if (checkExt.rows.length > 0) {
                    // Update existing
                    await connection.execute(
                        `UPDATE XX_INTELLI_EXTRACTIONS 
                         SET COLUMN_MAPPINGS = :b_map, EXTRACTION_SQL_QUERY = :b_sql, TEMPLATENAME = :b_template
                         WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
                        {
                            b_map: mappingsJson,
                            b_sql: sqlQuery,
                            b_template: templateName || 'UNKNOWN',
                            b_mid: modelId,
                            b_ename: spec.name
                        }
                    );
                } else {
                    // Insert new
                    await connection.execute(
                        `INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME) 
                         VALUES (:b_mid, :b_ename, :b_map, :b_sql, :b_template)`,
                        {
                            b_mid: modelId,
                            b_ename: spec.name,
                            b_map: mappingsJson,
                            b_sql: sqlQuery,
                            b_template: templateName || 'UNKNOWN'
                        }
                    );
                }
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

app.post('/api/extraction/update', async (req, res) => {
    const { modelId, extractionName, columns, sqlQuery, templateName } = req.body;
    let connection;

    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        const mappingsJson = JSON.stringify(columns || []);

        const result = await connection.execute(
            `UPDATE XX_INTELLI_EXTRACTIONS 
             SET COLUMN_MAPPINGS = :b_map, EXTRACTION_SQL_QUERY = :b_sql, TEMPLATENAME = :b_template
             WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
            {
                b_map: mappingsJson,
                b_sql: sqlQuery || '',
                b_template: templateName || 'UNKNOWN',
                b_mid: modelId,
                b_ename: extractionName
            }
        );

        if (result.rowsAffected === 0) {
            // Try to insert if not found
            await connection.execute(
                `INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME) 
                 VALUES (:b_mid, :b_ename, :b_map, :b_sql, :b_template)`,
                {
                    b_mid: modelId,
                    b_ename: extractionName,
                    b_map: mappingsJson,
                    b_sql: sqlQuery || '',
                    b_template: templateName || 'UNKNOWN'
                }
            );
        }

        await connection.commit();
        res.json({ success: true, message: 'Extraction updated successfully' });

    } catch (err) {
        console.error('Update Extraction Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.get('/api/saved-models', async (req, res) => {
    let connection;
    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);
        const result = await connection.execute(
            `SELECT MODEL_ID, MODEL_NAME, TEMPLATENAME, USERNAME, USER_ID FROM XX_INTELLI_MODELS ORDER BY MODEL_ID DESC`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json({ success: true, models: result.rows });
    } catch (err) {
        console.error('Fetch Models Error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
});

app.get('/api/saved-model/:modelId', async (req, res) => {
    const { modelId } = req.params;
    let connection;
    try {
        const dbConfig = getDbConfig();
        connection = await oracledb.getConnection(dbConfig);

        // 1. Get Model Info
        const modelRes = await connection.execute(
            `SELECT MODEL_NAME, TEMPLATENAME FROM XX_INTELLI_MODELS WHERE MODEL_ID = :b_id`,
            { b_id: modelId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (modelRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Model not found' });
        }
        const model = modelRes.rows[0];

        // 2. Get Architecture
        const archRes = await connection.execute(
            `SELECT TABLES FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name`,
            { b_name: model.MODEL_NAME },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        let tablesCsv = '';
        if (archRes.rows && archRes.rows.length > 0) {
            const rawTables = archRes.rows[0].TABLES;
            if (rawTables) {
                // If it's a LOB object (older oracledb versions or specific settings), String() might not be enough
                // But with fetchAsString = [CLOB], it should be a string. Defensive check nonetheless.
                tablesCsv = typeof rawTables === 'string' ? rawTables : String(rawTables);
            }
        }

        const tableNames = tablesCsv.split(',').map(s => s.trim()).filter(Boolean);

        // 3. Reconstruct Object Schema for those tables
        const objects = [];
        for (const tableName of tableNames) {
            try {
                const columnsResult = await connection.execute(
                    `SELECT column_name, data_type FROM user_tab_columns WHERE table_name = UPPER(:tbl) ORDER BY column_id`,
                    [tableName]
                );

                if (columnsResult.rows && columnsResult.rows.length > 0) {
                    objects.push({
                        id: `obj_${tableName}`,
                        name: toTitleCase(tableName),
                        tableName: tableName,
                        fields: columnsResult.rows.map(row => ({
                            name: row[0],
                            type: mapOracleType(row[1]),
                            description: row[1]
                        }))
                    });
                }
            } catch (tblErr) {
                console.warn(`Could not fetch columns for table ${tableName}:`, tblErr.message);
            }
        }

        // 4. Get Extractions
        const specRes = await connection.execute(
            `SELECT ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME 
             FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :b_id`,
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

            return {
                id: `spec_db_${row.ID}`,
                name: row.EXTRACTION_NAME,
                version: 1.0, // Default for now
                objectGroupId: `grp_db_${modelId}`,
                columns: cols,
                filters: [], // Add if stored later
                format: row.TEMPLATENAME?.toLowerCase().includes('csv') ? 'csv' : 'fbdi',
                createdAt: new Date().toISOString()
            };
        });

        res.json({
            success: true,
            group: {
                id: `grp_db_${modelId}`,
                modelId: modelId,
                name: model.MODEL_NAME,
                databaseType: 'ORACLE',
                objects: objects,
                relationships: []
            },
            specifications: specifications
        });

    } catch (err) {
        console.error('Fetch Saved Model Detail Error:', err);
        res.status(500).json({ success: false, message: err.message });
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
