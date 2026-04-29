/* server/scripts/vectorize-db.js */
const oracledb = require('oracledb');
const { generateEmbeddingsWithOCI } = require('../services/ociService');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Enable Thick Mode using the same logic as index.js
try {
    const instantClientPath = path.join(__dirname, '../instantclient');
    if (fs.existsSync(instantClientPath)) {
        oracledb.initOracleClient({ libDir: instantClientPath });
        console.log(`Oracle Client initialized in Thick Mode using: ${instantClientPath}`);
    } else {
        console.warn('Instant Client not found in server directory, relying on system PATH');
        oracledb.initOracleClient();
    }
} catch (err) {
    console.error("Failed to initialize Oracle Client:", err.message);
    // Continue anyway as it might be already initialized or not needed
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

async function vectorizeDatabaseMetadata() {
    let connection;
    try {
        const dbConfig = getDbConfig();
        console.log(`Connecting to Oracle Database at ${dbConfig.connectString}...`);
        connection = await oracledb.getConnection(dbConfig);
        console.log("Connected.");

        // 1. Fetch all tables and column comments from XXEA_MS schema
        console.log("Fetching DB Metadata (Tables & Columns)...");
        const sql = `
            SELECT 
        c.table_name, 
        c.column_name, 
        c.data_type, 
        cc.comments as col_comment,
        tc.comments as tab_comment
    FROM user_tab_columns c
    JOIN user_tables t ON t.table_name = c.table_name
    LEFT JOIN user_col_comments cc ON cc.table_name = c.table_name AND cc.column_name = c.column_name
    LEFT JOIN user_tab_comments tc ON tc.table_name = c.table_name
    WHERE t.table_name LIKE 'XXEA_MS%' and cc.comments is not null and tc.comments is not null -- ADJUST THIS FILTER TO YOUR NEEDS
    ORDER BY c.table_name, c.column_id;
        `;

        const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const metadata = result.rows;
        console.log(`Found ${metadata.length} columns to vectorize.`);

        // 2. Process in batches to avoid OCI rate limits
        const bSize = 100;
        for (let i = 0; i < metadata.length; i += bSize) {
            const batch = metadata.slice(i, i + bSize);
            console.log(`Processing batch ${Math.floor(i / bSize) + 1} of ${Math.ceil(metadata.length / bSize)}...`);

            // Sharp Metadata Chunking: Column-first, reduced noise
            const chunks = batch.map(row => {
                return `COLUMN: ${row.COLUMN_NAME} | TABLE: ${row.TABLE_NAME} | COMMENT: ${row.COL_COMMENT || 'N/A'} | TABLE ARCHITECTURE: ${row.TAB_COMMENT || 'N/A'}`;
            });

            // Generate Embeddings
            const embeddings = await generateEmbeddingsWithOCI(chunks);
            if (!embeddings || embeddings.length === 0) {
                console.error("Failed to generate embeddings for batch. Skipping...");
                continue;
            }

            console.log(`Generated embeddings with ${embeddings[0].length} dimensions.`);

            // Ingest into Vector Table
            for (let j = 0; j < batch.length; j++) {
                const row = batch[j];
                const vec = JSON.stringify(embeddings[j]);
                const insertSql = `
                    INSERT INTO INTELLI_FBDI_KNOWLEDGE_VECTOR_METADATA 
                    (ID, TEMPLATE_NAME, SHEET_NAME, SECTION_NAME, CONTENT_CHUNK, EMBEDDING, CREATED_AT)
                    VALUES (XX_INTELLI_MODEL_EXT_SEQ.NEXTVAL, 'ORACLE_FUSION_SCHEMA', :t, 'DB_METADATA', :c, VECTOR(:v), CURRENT_TIMESTAMP)
                `;

                try {
                    await connection.execute(insertSql, {
                        t: row.TABLE_NAME,
                        c: chunks[j],
                        v: vec
                    }, { autoCommit: true });
                } catch (e) {
                    if (e.message.includes('ORA-00001')) {
                        // Skip duplicates
                    } else {
                        console.warn(`Failed to insert vector for ${row.TABLE_NAME}.${row.COLUMN_NAME}:`, e.message);
                    }
                }
            }
        }

        console.log("Vectorization completed successfully!");

    } catch (err) {
        console.error("Vectorization Script Failed:", err);
    } finally {
        if (connection) {
            try { await connection.close(); } catch (e) { console.error(e); }
        }
    }
}

vectorizeDatabaseMetadata();
