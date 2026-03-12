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

let dbPool;

async function initializeDatabase() {
    try {
        const dbConfig = getDbConfig();
        dbPool = await oracledb.createPool({
            ...dbConfig,
            poolMin: 2,
            poolMax: 10,
            poolIncrement: 1
        });
        console.log('Oracle Connection Pool initialized');
    } catch (err) {
        console.error('Oracle DB Initialization Error:', err);
        process.exit(1);
    }
}

// Initialize DB on startup
initializeDatabase()
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

// Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', datetime: new Date().toISOString() });
});

// OCI Service Import
const { analyzeFbdiWithOCI, smartMapColumnsWithOCI, processNlQueryWithOCI } = require('./services/ociService');

app.post('/api/analyze-fbdi', async (req, res) => {
    let connection;
    try {
        console.log("Analyzing FBDI via OCI:", req.body.fileName);

        // 1. Fetch Candidate Group Names from metadata table
        connection = await dbPool.getConnection();
        const groupResult = await connection.execute(
            `SELECT DISTINCT GROUP_NAME FROM XXEA_DM_TABLE_COL_DEF ORDER BY GROUP_NAME`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const candidateGroups = groupResult.rows.map(r => r.GROUP_NAME);
        console.log(`Found ${candidateGroups.length} candidate groups from database.`);

        // 2. Pass metadata and candidates to OCI for matching
        const result = await analyzeFbdiWithOCI({ ...req.body, candidateGroups });
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

app.post('/api/nl-query', async (req, res) => {
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

app.get('/api/modules', async (req, res) => {
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

// Helper to fetch and filter mappings using the same logic for both endpoints

async function getDiscoveredJoins(connection, tables) {
    if (!tables || tables.length < 2) return [];

    try {
        console.log(`[Join Discovery] Checking for valid joins between: ${tables.join(', ')}`);

        const bindParams = {};
        const bindNames = tables.map((t, i) => {
            const key = `tbl${i}`;
            bindParams[key] = t.toUpperCase();
            return `:${key}`;
        }).join(', ');

        const joinSql = `
            SELECT DISTINCT
                SOURCE_TABLE_NAME,
                SOURCE_TABLE_JOIN_COLUMN1,
                TARGET_TABLE_NAME,
                TARGET_TABLE_JOIN_COLUMN1,
                SOURCE_TABLE_JOIN_COLUMN2,
                TARGET_TABLE_JOIN_COLUMN2,
                MATCH_TYPE,
                QUALIFIER
            FROM XXFW_DM_UPD_ROW_VALID_TAB
            WHERE SOURCE_TABLE_NAME IN (${bindNames})
              AND TARGET_TABLE_NAME IN (${bindNames})
              AND SOURCE_TABLE_NAME != TARGET_TABLE_NAME
        `;

        const result = await connection.execute(joinSql, bindParams, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        return result.rows.map(row => {
            const srcTbl = row.SOURCE_TABLE_NAME;
            const tgtTbl = row.TARGET_TABLE_NAME;
            const srcCol1 = row.SOURCE_TABLE_JOIN_COLUMN1;
            const tgtCol1 = row.TARGET_TABLE_JOIN_COLUMN1;
            const srcCol2 = row.SOURCE_TABLE_JOIN_COLUMN2;
            const tgtCol2 = row.TARGET_TABLE_JOIN_COLUMN2;
            const q = row.QUALIFIER;

            let condition = `${srcTbl}.${srcCol1} = ${tgtTbl}.${tgtCol1}`;
            if (srcCol2 && tgtCol2) {
                condition += ` AND ${srcTbl}.${srcCol2} = ${tgtTbl}.${tgtCol2}`;
            }
            if (q) {
                condition += ` AND (${q})`;
            }

            return {
                sourceTable: srcTbl,
                targetTable: tgtTbl,
                sourceColumn: srcCol1,
                targetColumn: tgtCol1,
                condition: condition,
                joinType: row.MATCH_TYPE || 'LEFT'
            };
        });
    } catch (err) {
        console.error('[Join Discovery] Error:', err.message);
        return [];
    }
}

async function getFilteredMappings(connection, { moduleName, sheetNames, analysisModuleName, unmappedHeaders }) {
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
        const searchTerm = `%${(moduleName || '').toUpperCase()}%`;
        const exactTerm = (moduleName || '').toUpperCase();
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
    let reconMappings = result.rows;
    let fallbackMappings = [];
    let allMappings = [...reconMappings];

    // GRANULAR FALLBACK: If specific sheets are missing, search xxfw_dm_objects_v
    if (sheetNames && sheetNames.length > 0) {
        const foundIdentifiers = new Set(reconMappings.map(m => (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));
        const missingSheets = sheetNames.filter(s => !foundIdentifiers.has(s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()));

        if (missingSheets.length > 0) {
            console.log(`[Fallback Mappings] Sheets missing from Recon Mapping: ${missingSheets.join(', ')}`);

            // Prepare Module Filter
            const modules = Array.isArray(analysisModuleName) ? analysisModuleName : (analysisModuleName ? [analysisModuleName] : (moduleName ? [moduleName] : []));
            const moduleBindNames = modules.map((_, i) => `:mod${i}`).join(', ');
            const moduleBinds = {};
            modules.forEach((m, i) => moduleBinds[`mod${i}`] = m.toUpperCase());

            for (const sheet of missingSheets) {
                console.log(`[Fallback] Searching for sheet '${sheet}' across modules: ${modules.join(', ')}`);
                let fbSql = `
                    SELECT DISTINCT
                        UPPER(:sheet) as DATA_IDENTIFIER, 
                        T.TABLE_NAME,
                        T.COLUMN_NAME,
                        T.BUSINESS_COLUMN_NAME as METADATA_COLUMN_HEADER,
                        C.COMMENTS as COLUMN_DESCRIPTION
                    FROM XXEA_DM_TABLE_COL_DEF T
                    LEFT JOIN ALL_COL_COMMENTS C ON T.TABLE_NAME = C.TABLE_NAME AND T.COLUMN_NAME = C.COLUMN_NAME AND C.OWNER = 'XX_FUSION_API'
                    WHERE T.TABLE_STORE = 'Master Data Store'
                `;

                if (modules.length > 0) {
                    fbSql += ` AND UPPER(T.GROUP_NAME) IN (${moduleBindNames})`;
                } else {
                    fbSql += ` AND UPPER(T.GROUP_NAME) = UPPER(:sheet)`;
                }

                const fbResult = await connection.execute(fbSql, {
                    sheet: sheet,
                    ...moduleBinds
                }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                if (fbResult.rows.length > 0) {
                    fallbackMappings = [...fallbackMappings, ...fbResult.rows];
                    allMappings = [...allMappings, ...fbResult.rows];
                }
            }
        }
    } else if (reconMappings.length === 0 && (moduleName || analysisModuleName)) {
        // General fallback
        const modules = Array.isArray(analysisModuleName) ? analysisModuleName : (analysisModuleName ? [analysisModuleName] : [moduleName]);
        const moduleBindNames = modules.map((_, i) => `:mod${i}`).join(', ');
        const moduleBinds = {};
        modules.forEach((m, i) => moduleBinds[`mod${i}`] = m.toUpperCase());

        console.log(`[General Fallback Mappings] Searching XXEA_DM_TABLE_COL_DEF for modules: ${modules.join(', ')}`);
        const fbSql = `
            SELECT DISTINCT 
                UPPER(T.GROUP_NAME) as DATA_IDENTIFIER, 
                T.TABLE_NAME,
                T.COLUMN_NAME,
                T.BUSINESS_COLUMN_NAME as METADATA_COLUMN_HEADER,
                C.COMMENTS as COLUMN_DESCRIPTION
            FROM XXEA_DM_TABLE_COL_DEF T
            LEFT JOIN ALL_COL_COMMENTS C ON T.TABLE_NAME = C.TABLE_NAME AND T.COLUMN_NAME = C.COLUMN_NAME AND C.OWNER = 'XX_FUSION_API'
            WHERE UPPER(T.GROUP_NAME) IN (${moduleBindNames})
            AND T.TABLE_STORE = 'Master Data Store'
        `;
        const fbResult = await connection.execute(fbSql, {
            ...moduleBinds
        }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        fallbackMappings = fbResult.rows;
        allMappings = [...allMappings, ...fbResult.rows];
    }

    // STEP 3: Header-Based Targeted Mapping Discovery
    const unmappedHeaderGroups = {};
    if (unmappedHeaders) {
        if (Array.isArray(unmappedHeaders)) {
            unmappedHeaderGroups['General'] = unmappedHeaders;
        } else {
            Object.assign(unmappedHeaderGroups, unmappedHeaders);
        }
    }

    for (const [sheet, headers] of Object.entries(unmappedHeaderGroups)) {
        console.log(`[Header Mappings Fallback] Searching mappings for ${headers.length} headers in sheet: ${sheet}`);
        for (const header of headers) {
            // 1. Clean header: Remove mandatory markers (*, **) and TRIM
            const hRaw = header.replace(/\*/g, '').trim();
            // 2. Exact alphanumeric match (no spaces)
            const hClean = hRaw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            // 3. Fuzzy pattern: "Remit To" -> "%REMIT%TO%"
            const hFuzzy = '%' + hRaw.replace(/[^a-zA-Z0-9]/g, ' ').trim().replace(/\s+/g, '%').toUpperCase() + '%';

            console.log(`[Phase 3 Discovery] Clean: ${hClean}, Fuzzy Pattern: ${hFuzzy}`);

            let hSqlBase = `
                SELECT DISTINCT
                    :header as DATA_IDENTIFIER, 
                    T.TABLE_NAME,
                    T.COLUMN_NAME,
                    T.BUSINESS_COLUMN_NAME as METADATA_COLUMN_HEADER,
                    C.COMMENTS as COLUMN_DESCRIPTION,
                    T.GROUP_NAME
                FROM XXEA_DM_TABLE_COL_DEF T
                LEFT JOIN ALL_COL_COMMENTS C ON T.TABLE_NAME = C.TABLE_NAME AND T.COLUMN_NAME = C.COLUMN_NAME AND C.OWNER = 'XX_FUSION_API'
                WHERE (
                    -- Exact Match on Business Name or Column Name
                    REPLACE(UPPER(T.BUSINESS_COLUMN_NAME), ' ', '') = :hClean
                    OR REPLACE(UPPER(T.COLUMN_NAME), '_', '') = :hClean
                    -- Smarter Fuzzy LIKE matching
                    OR UPPER(T.BUSINESS_COLUMN_NAME) LIKE :hFuzzy
                    OR UPPER(T.COLUMN_NAME) LIKE :hFuzzy
                    -- Multi-delimit removal match
                    OR REGEXP_REPLACE(UPPER(T.BUSINESS_COLUMN_NAME), '[^A-Z0-9]', '') = :hClean
                )
                  AND T.TABLE_STORE = 'Master Data Store'
            `;

            // If it's mandatory and we have a module context, start with those groups but fallback to global
            const modules = Array.isArray(analysisModuleName) ? analysisModuleName : (analysisModuleName ? [analysisModuleName] : (moduleName ? [moduleName] : []));
            if (modules.length > 0) {
                const moduleBindNames = modules.map((_, i) => `:mod${i}`).join(', ');
                const moduleBinds = {};
                modules.forEach((m, i) => moduleBinds[`mod${i}`] = m.toUpperCase());

                const hModuleSql = hSqlBase + ` AND UPPER(T.GROUP_NAME) IN (${moduleBindNames})`;
                const hModuleResult = await connection.execute(hModuleSql, {
                    header: header, hClean: hClean, hFuzzy: hFuzzy, ...moduleBinds
                }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

                if (hModuleResult.rows.length > 0) {
                    const enriched = hModuleResult.rows.map(r => ({ ...r, SHEET_CONTEXT: sheet }));
                    fallbackMappings = [...fallbackMappings, ...enriched];
                    allMappings = [...allMappings, ...enriched];
                    // Note: We don't 'continue' here anymore, we also allow global search 
                    // if it's a Phase 3 Global Discovery request to find the "best" table.
                    if (!unmappedHeaders) continue;
                }
            }

            // Global search for mandatory or if module search yielded nothing
            const hResult = await connection.execute(hSqlBase, {
                header: header, hClean: hClean, hFuzzy: hFuzzy
            }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

            if (hResult.rows.length > 0) {
                const enrichedResult = hResult.rows.map(r => ({ ...r, SHEET_CONTEXT: sheet }));
                fallbackMappings = [...fallbackMappings, ...enrichedResult];
                allMappings = [...allMappings, ...enrichedResult];
            } else if (isMandatory) {
                // If STILL nothing for mandatory, try searching by just the words
                console.log(`[Mandatory Fallback] Aggressive word search for: ${header}`);
                const words = header.replace(/[*)]/g, '').split(' ').filter(w => w.length > 3);
                if (words.length > 0) {
                    const wordSql = hSqlBase.replace(/= :hClean/g, 'IN (NULL)').replace(/LIKE :hLike/g, `LIKE '%${words[0].toUpperCase()}%'`);
                    const wordResult = await connection.execute(wordSql, { header: header }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
                    if (wordResult.rows.length > 0) {
                        const enriched = wordResult.rows.map(r => ({ ...r, SHEET_CONTEXT: sheet }));
                        fallbackMappings = [...fallbackMappings, ...enriched];
                        allMappings = [...allMappings, ...enriched];
                    }
                }
            }
        }
    }

    // --- STEP 4: LLM Generative Candidate Selection ---
    if (fallbackMappings.length > 0) {
        console.log(`[Phase 3 Discovery] Enriching ${fallbackMappings.length} candidates with table context...`);
        const uniqueTables = [...new Set(fallbackMappings.map(m => m.TABLE_NAME))].filter(Boolean);
        const tableSiblingsMap = {};

        // Fetch 3-5 sibling columns for functional context
        for (const tbl of uniqueTables) {
            try {
                const sibRes = await connection.execute(
                    `SELECT COLUMN_NAME FROM (SELECT COLUMN_NAME FROM user_tab_columns WHERE table_name = :tbl ORDER BY column_id) WHERE ROWNUM <= 5`,
                    [tbl]
                );
                tableSiblingsMap[tbl] = sibRes.rows.map(r => r[0]).join(', ');
            } catch (e) { console.warn(`Could not fetch siblings for ${tbl}`, e); }
        }

        // Tag mappings with context
        fallbackMappings = fallbackMappings.map(m => ({
            ...m,
            TABLE_CONTEXT: tableSiblingsMap[m.TABLE_NAME] || 'N/A'
        }));

        const modules = Array.isArray(analysisModuleName) ? analysisModuleName : (analysisModuleName ? [analysisModuleName] : (moduleName ? [moduleName] : ["Unknown Module"]));
        const targetModule = modules.join(', ');
        const reconHeaders = new Set(reconMappings.map(m => (m.DATA_IDENTIFIER || '').toUpperCase()));
        let finalSmartMappings = [];

        // Process AI mapping BY SHEET to maintain functional context
        for (const [sheet, headers] of Object.entries(unmappedHeaderGroups)) {
            const headersForAI = headers.filter(h => !reconHeaders.has((h || '').toUpperCase()));
            if (headersForAI.length === 0) continue;

            // Filter fallbacks to those relevant to this sheet or general
            const relevantFallbacks = fallbackMappings.filter(m => !m.SHEET_CONTEXT || m.SHEET_CONTEXT === sheet);

            console.log(`[Smart Mapping] Mapping ${headersForAI.length} headers for sheet '${sheet}' using ${relevantFallbacks.length} candidates...`);
            const sheetContext = `${targetModule} - Sheet: ${sheet}`;
            const smartMappings = await smartMapColumnsWithOCI(headersForAI, relevantFallbacks, sheetContext, reconMappings);

            if (smartMappings && smartMappings.length > 0) {
                finalSmartMappings = [...finalSmartMappings, ...smartMappings];
            }
        }

        if (finalSmartMappings.length > 0) {
            allMappings = [...reconMappings, ...finalSmartMappings];
        } else if (fallbackMappings.length > 0 && reconMappings.length === 0) {
            // Last resort: basic heuristic filter
            const filteredFallbacks = fallbackMappings.filter(m => {
                const hClean = (m.DATA_IDENTIFIER || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const cClean = (m.COLUMN_NAME || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                if (hClean.startsWith('ATTRIBUTE') && cClean.startsWith('ATTRIBUTE')) return hClean === cClean;
                return true;
            });
            allMappings = [...reconMappings, ...filteredFallbacks];
        }
    }
    return allMappings;
}

app.post('/api/module-columns', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName, unmappedHeaders } = req.body;
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

app.post('/api/fbdi-mappings', async (req, res) => {
    const { moduleName, sheetNames, analysisModuleName, unmappedHeaders } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();

        if (!moduleName && (!sheetNames || sheetNames.length === 0)) {
            return res.status(400).json({ success: false, message: 'Module name or sheet names are required' });
        }

        // Reuse identical mapping logic to limit the searched tables
        let allMappings = await getFilteredMappings(connection, req.body);

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

app.get('/api/tables', async (req, res) => {
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
app.post('/api/upload-template', upload.single('template'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    res.json({ success: true, filename: req.file.filename });
});

app.post('/api/extract-batch', async (req, res) => {
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
                    data: result.rows
                };
            } finally {
                if (specConnection) await specConnection.close();
            }
        }));

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
            colExpr = `XX_FUSION_API.${quoteIdentifier(c.table)}.${quoteIdentifier(c.column)}`;
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

    const tables = [...new Set(columns.filter(c => c && c.table).map(c => c.table))];
    if (tables.length === 0) {
        query += ' FROM DUAL';
    } else {
        // DISCOVER JOINS IF MORE THAN ONE TABLE
        let finalJoins = joins || [];
        if (tables.length > 1) {
            let discovered;
            const cacheKey = [...tables].sort().join(',');

            if (discoveredJoinsCache && discoveredJoinsCache.has(cacheKey)) {
                discovered = discoveredJoinsCache.get(cacheKey);
            } else {
                discovered = await getDiscoveredJoins(connection, tables);
                if (discoveredJoinsCache) discoveredJoinsCache.set(cacheKey, discovered);
            }

            discovered.forEach(dj => {
                const alreadyExists = finalJoins.some(fj =>
                    ((fj.leftTable || '').toUpperCase() === dj.sourceTable && (fj.rightTable || '').toUpperCase() === dj.targetTable) ||
                    ((fj.leftTable || '').toUpperCase() === dj.targetTable && (fj.rightTable || '').toUpperCase() === dj.sourceTable)
                );
                if (!alreadyExists) {
                    finalJoins.push({
                        leftTable: dj.sourceTable,
                        rightTable: dj.targetTable,
                        condition: dj.condition,
                        type: dj.joinType || 'INNER'
                    });
                }
            });
        }

        // IMPLICIT JOIN SYNTAX
        query += ` FROM ${tables.map(t => `XX_FUSION_API.${quoteIdentifier(t)}`).join(', ')}`;

        const tablesWithVersion = preFetchedVersions || new Set();
        const allConditions = [];

        // 1. Join Conditions
        finalJoins.forEach(j => {
            if (j.condition) {
                // Prepend schema to simple join conditions (e.g., T1.ID = T2.ID -> XX_FUSION_API.T1.ID = XX_FUSION_API.T2.ID)
                let condition = j.condition;
                tables.forEach(t => {
                    const regex = new RegExp(`\\b${t}\\b`, 'g');
                    condition = condition.replace(regex, `XX_FUSION_API.${t}`);
                });
                allConditions.push(condition);
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
                    return `XX_FUSION_API.${quoteIdentifier(table)}.${quoteIdentifier(col)} ${f.operator} ${valExpr}`;
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
        if (!preFetchedVersions && tables.length > 0) {
            try {
                const binds = {};
                const bindNames = tables.map((_, i) => `:tbl${i}`).join(', ');
                tables.forEach((tbl, i) => { binds[`tbl${i}`] = tbl; });

                const versionCheckSql = `
                    SELECT table_name 
                    FROM all_tab_columns 
                    WHERE owner = 'XX_FUSION_API'
                      AND column_name = 'XX_VERSION' 
                      AND table_name IN (${bindNames})
                `;
                const versionResult = await connection.execute(versionCheckSql, binds);
                versionResult.rows.forEach(row => tablesWithVersion.add(row[0]));
            } catch (err) {
                console.warn("Bulk XX_VERSION check failed:", err.message);
            }
        }

        // 3. Version Conditions
        tables.forEach(t => {
            if (tablesWithVersion.has(t.toUpperCase())) {
                allConditions.push(`XX_FUSION_API.${quoteIdentifier(t)}.XX_VERSION = (SELECT MAX(XX_VERSION) FROM XX_FUSION_API.${quoteIdentifier(t)})`);
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
app.post('/api/generate-sql', async (req, res) => {
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

// Extraction Engine (Single)

// Extraction Engine (Single)
app.post('/api/extract', async (req, res) => {
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
        connection = await dbPool.getConnection();

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

        // 3. Persist Individual Extractions into XX_INTELLI_EXTRACTIONS
        if (specs && Array.isArray(specs)) {
            console.log(`Persisting ${specs.length} extraction specs into XX_INTELLI_EXTRACTIONS for Model ID: ${modelId}`);

            for (const spec of specs) {
                const mappingsJson = JSON.stringify(spec.columns || []);
                const filtersJson = JSON.stringify(spec.filters || []);
                const sqlQuery = spec.sqlQuery || '';

                // Get max version for this extraction
                const versionRes = await connection.execute(
                    `SELECT MAX(VERSION) as MAX_VER FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
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
                    `INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS) 
                     VALUES (:b_mid, :b_ename, :b_map, :b_sql, :b_template, :b_ver, :b_filters)`,
                    {
                        b_mid: modelId,
                        b_ename: spec.name,
                        b_map: mappingsJson,
                        b_sql: sqlQuery,
                        b_template: templateName || 'UNKNOWN',
                        b_ver: nextVersion,
                        b_filters: filtersJson
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

app.post('/api/model/update-architecture', async (req, res) => {
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

app.post('/api/extraction/update', async (req, res) => {
    const { modelId, extractionName, columns, filters, sqlQuery, templateName, isClone, version, sheetName } = req.body;
    let connection;

    try {
        connection = await dbPool.getConnection();
        const mappingsJson = JSON.stringify(columns || []);
        const filtersJson = JSON.stringify(filters || []);

        if (isClone) {
            // Get max version for this extraction
            const versionRes = await connection.execute(
                `SELECT MAX(VERSION) as MAX_VER FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :b_mid AND EXTRACTION_NAME = :b_ename`,
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
                `INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME) 
                 VALUES (:b_mid, :b_ename, :b_map, :b_sql, :b_template, :b_ver, :b_filters, :b_sheet)`,
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
                `UPDATE XX_INTELLI_EXTRACTIONS 
                 SET COLUMN_MAPPINGS = :b_map, EXTRACTION_SQL_QUERY = :b_sql, TEMPLATENAME = :b_template, DATA_FILTERS = :b_filters, SHEET_NAME = :b_sheet
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
                    `INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME) 
                     VALUES (:b_mid, :b_ename, :b_map, :b_sql, :b_template, '1.0', :b_filters, :b_sheet)`,
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

app.get('/api/saved-models', async (req, res) => {
    let connection;
    try {
        connection = await dbPool.getConnection();
        const result = await connection.execute(
            `SELECT MODEL_ID, MODEL_NAME, TEMPLATENAME, USERNAME, USER_ID FROM XX_INTELLI_MODELS ORDER BY MODEL_ID DESC`,
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const models = result.rows;
        let latestModelDetail = null;

        if (models.length > 0) {
            try {
                const latestId = models[0].MODEL_ID;
                latestModelDetail = await getSavedModelDetailInternal(connection, latestId);
            } catch (detailErr) {
                console.error("Failed to eagerly load latest model detail:", detailErr);
            }
        }

        res.json({
            success: true,
            models: models,
            latestModelDetail: latestModelDetail
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
        `SELECT TABLES, RELATIONSHIPS FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name`,
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
        `SELECT ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME 
         FROM XX_INTELLI_EXTRACTIONS e 
         WHERE MODEL_ID = :b_id 
         AND VERSION = (
             SELECT MAX(VERSION) FROM XX_INTELLI_EXTRACTIONS e2 
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
            sheetName: row.SHEET_NAME,
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
            databaseType: 'ORACLE',
            objects: objects,
            relationships: relationships
        },
        specifications: specifications
    };
}

app.get('/api/saved-model/:modelId', async (req, res) => {
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
