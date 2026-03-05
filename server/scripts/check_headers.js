const oracledb = require('oracledb');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
try {
    const instantClientPath = path.join(__dirname, '..', 'instantclient');
    if (fs.existsSync(instantClientPath)) {
        oracledb.initOracleClient({ libDir: instantClientPath });
    }
} catch (err) { }

async function run() {
    let conn;
    try {
        conn = await oracledb.getConnection({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE_NAME}`
        });

        await conn.execute("BEGIN xxdm1.xx_dbms_session(1000); END;");

        const objectsSql = `
            SELECT DATA_IDENTIFIER, TABLE_NAME, COLUMN_NAME, METADATA_COLUMN_HEADER
            FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING 
            WHERE DATA_IDENTIFIER = 'PozSupplierSitesInt'
            AND (
                UPPER(METADATA_COLUMN_HEADER) LIKE '%PURCHAS%' OR
                UPPER(METADATA_COLUMN_HEADER) LIKE '%PROCUREMENT CARD%' OR
                UPPER(METADATA_COLUMN_HEADER) LIKE '%PAY%'
            )
        `;

        const objectsResult = await conn.execute(objectsSql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Found ${objectsResult.rows.length} rows`);
        console.log(objectsResult.rows);

    } catch (e) {
        console.error(e);
    } finally {
        if (conn) await conn.close();
    }
}
run();
