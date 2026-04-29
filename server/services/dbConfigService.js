const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');

const CONFIG_FILE = path.join(__dirname, '../db_configs.json');

class DbConfigService {
    constructor() {
        this.activePool = null;
        this.activeConfigId = null;
    }

    getConfigs() {
        if (!fs.existsSync(CONFIG_FILE)) {
            // Seed with current environment variables as default
            const defaultConfig = {
                id: 'default-env',
                name: 'Environment Default',
                type: 'ORACLE',
                host: (process.env.DB_HOST || '').trim(),
                port: parseInt(process.env.DB_PORT || '1521'),
                database: (process.env.DB_SERVICE_NAME || '').trim(),
                user: (process.env.DB_USER || '').trim(),
                password: (process.env.DB_PASSWORD || '').trim().replace(/^"|"$/g, ''),
                isActive: true
            };
            const data = {
                activeConfigId: 'default-env',
                configs: [defaultConfig]
            };
            this.saveAll(data);
            return data;
        }
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }

    saveAll(data) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
    }

    async saveConfig(config) {
        const data = this.getConfigs();
        const index = data.configs.findIndex(c => c.id === config.id);
        
        if (index !== -1) {
            data.configs[index] = { ...data.configs[index], ...config };
        } else {
            data.configs.push({
                ...config,
                id: config.id || `db_${Date.now()}`
            });
        }
        
        this.saveAll(data);
        return data;
    }

    async deleteConfig(id) {
        const data = this.getConfigs();
        data.configs = data.configs.filter(c => c.id !== id);
        if (data.activeConfigId === id) {
            data.activeConfigId = data.configs.length > 0 ? data.configs[0].id : null;
        }
        this.saveAll(data);
        return data;
    }

    async testConnection(config) {
        let connection;
        try {
            const connectString = `${config.host}:${config.port}/${config.database}`;
            connection = await oracledb.getConnection({
                user: config.user,
                password: config.password,
                connectString: connectString
            });
            return { success: true, message: "Connection successful!" };
        } catch (err) {
            return { success: false, message: err.message };
        } finally {
            if (connection) {
                try { await connection.close(); } catch (e) {}
            }
        }
    }

    async activateConfig(id, existingPool) {
        const data = this.getConfigs();
        const config = data.configs.find(c => c.id === id);
        if (!config) throw new Error("Configuration not found");

        // Close existing pool if any
        if (existingPool) {
            try { await existingPool.close(10); } catch (e) { console.warn("Error closing pool:", e.message); }
        }

        const connectString = `${config.host}:${config.port}/${config.database}`;
        const newPool = await oracledb.createPool({
            user: config.user,
            password: config.password,
            connectString: connectString,
            poolMin: 2,
            poolMax: 10,
            poolIncrement: 1,
            homogeneous: false
        });

        data.activeConfigId = id;
        this.saveAll(data);

        return { pool: newPool, config };
    }
}

module.exports = new DbConfigService();
