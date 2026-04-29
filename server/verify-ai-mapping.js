const oracledb = require('oracledb');
require('dotenv').config();
const { rankTablesWithOCI } = require('./services/ociService');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE_NAME}`
};

async function fetchLocalTableMetadata(connection) {
    console.log("[Metadata] Fetching all tables and comments...");
    const sql = `
        SELECT t.table_name, tc.comments
        FROM user_tables t
        LEFT JOIN user_tab_comments tc ON tc.table_name = t.table_name
        WHERE t.table_name LIKE 'XXEA_MS%'
        FETCH FIRST 200 ROWS ONLY
    `;
    const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows.map(r => ({
        tableName: r.TABLE_NAME,
        comments: r.COMMENTS || ''
    }));
}

async function verify() {
    let connection;
    try {
        console.log("Connecting to database...");
        connection = await oracledb.getConnection(dbConfig);
        console.log("Connected successfully.");

        // 1. Test Metadata Fetching
        const tables = await fetchLocalTableMetadata(connection);
        console.log(`Fetched ${tables.length} tables.`);
        console.log("Sample Table Info:", tables.slice(0, 3));

        // 2. Test AI Ranking
        const intent = "Payables Invoices and Suppliers";
        console.log(`Ranking tables for intent: "${intent}"...`);
        const rankedTables = await rankTablesWithOCI(intent, tables);
        console.log("Ranked Tables:", rankedTables);

        if (rankedTables.length > 0) {
            console.log("AI Identification Success!");
        } else {
            console.warn("AI Identification returned no results. Check OCI logs.");
        }

    } catch (err) {
        console.error("Verification failed:", err);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

verify();
