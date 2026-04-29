const oracledb = require('oracledb');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

async function checkSchema() {
    let connection;
    try {
        const instantClientPath = path.join(__dirname, '../server/instantclient');
        if (fs.existsSync(instantClientPath)) {
            oracledb.initOracleClient({ libDir: instantClientPath });
        } else {
            oracledb.initOracleClient();
        }

        connection = await oracledb.getConnection({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD.replace(/^"|"$/g, ''),
            connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE_NAME}`
        });

        const res = await connection.execute("SELECT column_name, data_type FROM user_tab_columns WHERE table_name = 'INTELLI_FBDI_KNOWLEDGE_VECTOR'");
        console.log(JSON.stringify(res.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

checkSchema();
