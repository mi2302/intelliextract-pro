const oracledb = require('oracledb');

class FusionConfigService {
    async getConfigs(pool) {
        let connection;
        try {
            connection = await pool.getConnection();
            const sql = `SELECT env_id, env_name, fusion_url, username, password FROM XX_INTELLI_FUSION_DETAILS ORDER BY created_date DESC`;
            const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            
            return result.rows.map(row => ({
                id: row.ENV_ID,
                name: row.ENV_NAME,
                url: row.FUSION_URL,
                username: row.USERNAME,
                password: row.PASSWORD
            }));
        } catch (err) {
            console.error('Error fetching fusion configs:', err);
            throw err;
        } finally {
            if (connection) {
                try { await connection.close(); } catch (e) {}
            }
        }
    }

    async saveConfig(pool, config) {
        let connection;
        try {
            connection = await pool.getConnection();
            if (config.id) {
                // Update
                let sql = `
                    UPDATE XX_INTELLI_FUSION_DETAILS 
                    SET env_name = :name, fusion_url = :url, username = :username, updated_date = SYSDATE 
                `;
                const params = {
                    id: config.id,
                    name: config.name,
                    url: config.url,
                    username: config.username
                };

                if (config.password) {
                    sql += `, password = :password `;
                    params.password = config.password;
                }

                sql += ` WHERE env_id = :id`;
                
                await connection.execute(sql, params, { autoCommit: true });
            } else {
                // Insert
                const sql = `
                    INSERT INTO XX_INTELLI_FUSION_DETAILS (env_name, fusion_url, username, password) 
                    VALUES (:name, :url, :username, :password)
                `;
                await connection.execute(sql, {
                    name: config.name,
                    url: config.url,
                    username: config.username,
                    password: config.password
                }, { autoCommit: true });
            }
            return { success: true };
        } catch (err) {
            console.error('Error saving fusion config:', err);
            throw err;
        } finally {
            if (connection) {
                try { await connection.close(); } catch (e) {}
            }
        }
    }

    async deleteConfig(pool, id) {
        let connection;
        try {
            connection = await pool.getConnection();
            const sql = `DELETE FROM XX_INTELLI_FUSION_DETAILS WHERE env_id = :id`;
            await connection.execute(sql, { id }, { autoCommit: true });
            return { success: true };
        } catch (err) {
            console.error('Error deleting fusion config:', err);
            throw err;
        } finally {
            if (connection) {
                try { await connection.close(); } catch (e) {}
            }
        }
    }
}

module.exports = new FusionConfigService();
