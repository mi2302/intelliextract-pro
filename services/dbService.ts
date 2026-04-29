import { DatabaseConfig, ObjectGroup } from '../types';

const API_BASE_URL = 'http://localhost:3006/api/fbdi';

export async function connectAndIntrospect(config: DatabaseConfig): Promise<ObjectGroup> {
    try {
        // 1. Test Connection (Optional, handled by introspect usually but good for UX)
        // For now, directly calling introspect which uses the connection
        const response = await fetch(`${API_BASE_URL}/introspect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                user: config.user,
                password: config.password,
                connectString: `${config.host}:${config.port}/${config.database}`
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to connect to database');
        }

        const data = await response.json();
        if (data.success && data.group) {
            return data.group;
        } else {
            throw new Error('Invalid response from server');
        }

    } catch (error) {
        console.error("DB Service Error:", error);
        throw error;
    }
}

export async function fetchModuleSchema(config: DatabaseConfig | null, moduleName: string, sheetNames?: string[], analysisModuleName?: string | string[], unmappedHeaders?: string[] | Record<string, string[]>, instructions?: string, intent?: string, sheetDetails?: any[]): Promise<{ objects: any[], relationships: any[] }> {
    try {
        const body: any = { moduleName };
        if (sheetNames) body.sheetNames = sheetNames;
        if (analysisModuleName) body.analysisModuleName = analysisModuleName;
        if (unmappedHeaders) body.unmappedHeaders = unmappedHeaders;
        if (instructions) body.instructions = instructions;
        if (intent) body.intent = intent;
        if (sheetDetails) body.sheetDetails = sheetDetails;
        if (config) {
            body.user = config.user;
            body.password = config.password;
            body.connectString = `${config.host}:${config.port}/${config.database}`;
        }

        const response = await fetch(`${API_BASE_URL}/module-columns`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) return { objects: [], relationships: [] };

        const data = await response.json();
        if (data.success) {
            return {
                objects: data.objects || [],
                relationships: data.relationships || []
            };
        }
        return { objects: [], relationships: [] };
    } catch (error) {
        console.error("Fetch Module Error:", error);
        return { objects: [], relationships: [] };
    }
}
// ... existing code ...

export async function fetchFbdiMappings(config: DatabaseConfig | null, moduleName: string, sheetNames?: string[], analysisModuleName?: string | string[], unmappedHeaders?: string[] | Record<string, string[]>, instructions?: string, intent?: string, sheetDetails?: any[]): Promise<any[]> {
    try {
        const body: any = { moduleName };
        if (sheetNames) body.sheetNames = sheetNames;
        if (analysisModuleName) body.analysisModuleName = analysisModuleName;
        if (unmappedHeaders) body.unmappedHeaders = unmappedHeaders;
        if (instructions) body.instructions = instructions;
        if (intent) body.intent = intent;
        if (sheetDetails) body.sheetDetails = sheetDetails;
        if (config) {
            body.user = config.user;
            body.password = config.password;
            body.connectString = `${config.host}:${config.port}/${config.database}`;
        }

        const response = await fetch(`${API_BASE_URL}/fbdi-import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) return [];

        const data = await response.json();
        if (data.success && data.mappings) {
            return data.mappings;
        }
        return [];
    } catch (error) {
        console.error("Fetch Mappings Error:", error);
        return [];
    }
}

export async function fetchGroups(): Promise<string[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/modules`);
        if (!response.ok) {
            throw new Error(`Failed to fetch groups: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fetch Groups Error:", error);
        return [];
    }
}

export async function fetchSavedModels(): Promise<{ models: any[] }> {
    try {
        const response = await fetch(`${API_BASE_URL}/saved-models`);
        if (!response.ok) return { models: [] };
        const data = await response.json();
        return data.success ? { models: data.models } : { models: [] };
    } catch (error) {
        console.error("Fetch Saved Models Error:", error);
        return { models: [] };
    }
}

export async function fetchSavedModelsBulk(modelIds: (string | number)[]): Promise<any[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/saved-models-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelIds })
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.success ? data.details : [];
    } catch (error) {
        console.error("Fetch Saved Models Bulk Error:", error);
        return [];
    }
}

export async function fetchSavedModelDetail(modelId: string | number): Promise<{ group: ObjectGroup, specifications: any[] } | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/saved-model/${modelId}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.success ? { group: data.group, specifications: data.specifications } : null;
    } catch (error) {
        console.error("Fetch Saved Model Detail Error:", error);
        return null;
    }
}

export async function analyzeFbdiMetadata(metadata: {
    sheetNames: string[],
    instructions: string,
    props: Record<string, any>,
    fileName: string,
    sheetDetails?: { name: string, headers: string[], sampleRows?: any[][] }[]
}): Promise<any> {
    try {
        const response = await fetch(`${API_BASE_URL}/analyze-fbdi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(metadata)
        });

        if (!response.ok) {
            throw new Error(`Backend Analysis Failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("OCI Analysis Failed (Backend)", error);
        return {
            moduleName: "Unknown",
            intent: "Unknown",
            confidence: "Low",
            reasoning: "Connection Error: " + (error as Error).message
        };
    }
}

export async function enrichTemplateKnowledge(metadata: {
    templateName: string,
    productFamily?: string,
    moduleName?: string,
    intent?: string,
    instructions?: string,
    sheetDetails?: any[]
}): Promise<any> {
    try {
        const response = await fetch(`${API_BASE_URL}/knowledge/enrich-template`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
        return await response.json();
    } catch (error) {
        console.error("Enrichment call failed:", error);
        return { success: false, error: (error as Error).message };
    }
}
export async function bottomUpDiscovery(sheetName: string, headers: string[], headerInfos?: string[], moduleName?: string, intent?: string): Promise<any> {
    try {
        const response = await fetch(`${API_BASE_URL}/discovery/bottom-up-discovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetName, headers, headerInfos, moduleName, intent })
        });
        if (!response.ok) return { success: false, error: response.statusText };
        return await response.json();
    } catch (error) {
        console.error("Bottom-Up Discovery call failed:", error);
        return { success: false, error: (error as Error).message };
    }
}
