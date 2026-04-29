import { FusionConfig } from '../types';

const API_BASE_URL = 'http://localhost:3006/api/fusion';

export async function fetchFusionConfigs(): Promise<FusionConfig[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/configs`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.success ? data.configs : [];
    } catch (error) {
        console.error("Fetch Fusion Configs Error:", error);
        return [];
    }
}

export async function saveFusionConfig(config: Partial<FusionConfig>): Promise<{ success: boolean, message?: string }> {
    try {
        const response = await fetch(`${API_BASE_URL}/configs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        return await response.json();
    } catch (error) {
        console.error("Save Fusion Config Error:", error);
        return { success: false, message: (error as Error).message };
    }
}

export async function deleteFusionConfig(id: string | number): Promise<{ success: boolean, message?: string }> {
    try {
        const response = await fetch(`${API_BASE_URL}/configs/${id}`, {
            method: 'DELETE'
        });
        return await response.json();
    } catch (error) {
        console.error("Delete Fusion Config Error:", error);
        return { success: false, message: (error as Error).message };
    }
}
