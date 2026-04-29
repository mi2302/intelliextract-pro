import React, { useState, useEffect } from 'react';
import { DatabaseConfig, DatabaseConfigData } from '../types';
import { Icons } from '../constants';

const DatabaseConfigPage: React.FC = () => {
    const [configData, setConfigData] = useState<DatabaseConfigData>({ activeConfigId: null, configs: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [activeConfig, setActiveConfig] = useState<DatabaseConfig | null>(null);

    const fetchConfigs = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('http://localhost:3006/api/db/configs');
            const data = await res.json();
            setConfigData(data);
            const active = data.configs.find((c: DatabaseConfig) => c.id === data.activeConfigId);
            setActiveConfig(active || null);
        } catch (err) {
            console.error("Failed to fetch configs", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchConfigs();
    }, []);

    const handleActivate = async (id: string) => {
        try {
            const res = await fetch('http://localhost:3006/api/db/configs/activate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                await fetchConfigs();
            }
        } catch (err) {
            console.error("Failed to activate config", err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this connection?")) return;
        try {
            const res = await fetch(`http://localhost:3006/api/db/configs/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                await fetchConfigs();
            }
        } catch (err) {
            console.error("Failed to delete config", err);
        }
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-4 border-[#1e709a]/20 border-t-[#1e709a] rounded-full animate-spin"></div>
                    <span className="text-sm font-bold text-slate-400">Loading Configuration...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-y-auto custom-scrollbar">
            <div className="p-8 max-w-6xl mx-auto w-full space-y-8">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Database Config</h1>
                        <p className="text-sm text-slate-500 font-medium">Manage and switch between your enterprise data environments.</p>
                    </div>
                    <button 
                        className="bg-[#1e709a] hover:bg-[#165678] text-white px-4 py-2 rounded-lg font-bold text-sm shadow-lg flex items-center gap-2 transition-all active:scale-95"
                        onClick={() => {/* Trigger New Connection Modal */ window.dispatchEvent(new CustomEvent('open-db-modal')) }}
                    >
                        <Icons.Plus className="w-4 h-4" />
                        <span>Add Connection</span>
                    </button>
                </div>

                {/* Active Database Card */}
                <div className="bg-white rounded-2xl border-2 border-[#10b981]/20 shadow-sm overflow-hidden p-6 relative">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#10b981]"></div>
                    <div className="flex items-start gap-6">
                        <div className="bg-[#10b981]/10 p-4 rounded-xl text-[#059669]">
                            <Icons.Database className="w-8 h-8" />
                        </div>
                        <div className="flex-1 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-lg font-black text-slate-800">Active Database</h2>
                                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-[#10b981]/10 text-[#059669] text-[10px] font-black uppercase rounded-full border border-[#10b981]/20">
                                        <div className="w-1.5 h-1.5 bg-[#10b981] rounded-full"></div>
                                        Connected
                                    </span>
                                    {activeConfig?.type === 'ORACLE' && (
                                        <span className="px-2.5 py-1 bg-purple-100 text-purple-600 text-[10px] font-black uppercase rounded-full border border-purple-200">
                                            Oracle ADB
                                        </span>
                                    )}
                                </div>
                                <button onClick={() => fetchConfigs()} className="text-slate-400 hover:text-[#1e709a] transition-colors">
                                    <Icons.Activity className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <DetailItem label="Host" value={activeConfig?.host || 'N/A'} icon={<Icons.Globe className="w-3.5 h-3.5" />} />
                                <DetailItem label="Port" value={activeConfig?.port?.toString() || 'N/A'} icon={<Icons.Terminal className="w-3.5 h-3.5" />} />
                                <DetailItem label="Service" value={activeConfig?.database || 'N/A'} icon={<Icons.File className="w-3.5 h-3.5" />} />
                                <DetailItem label="User" value={activeConfig?.user || 'N/A'} icon={<Icons.Brain className="w-3.5 h-3.5" />} />
                            </div>

                            <div className="pt-4 border-t border-slate-100">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-1.5 h-1.5 bg-[#10b981] rounded-full"></div>
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Schema Status:</span>
                                    <span className="text-[11px] font-bold text-[#10b981]">All tables present</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {['OIC_INT_DETAILS_TAB', 'DS_ETL_LOAD_XREF_MS', 'JOB_REQUESTS', 'JOB_REQUEST_LINES', 'PVO_DETAILS'].map(tag => (
                                        <span key={tag} className="px-2 py-0.5 bg-slate-50 text-slate-500 text-[9px] font-bold rounded border border-slate-200">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Saved Connections */}
                <div className="space-y-4">
                    <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Saved Connections</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {configData.configs.map((config) => (
                            <ConnectionCard 
                                key={config.id} 
                                config={config} 
                                isActive={config.id === configData.activeConfigId}
                                onActivate={() => handleActivate(config.id!)}
                                onDelete={() => handleDelete(config.id!)}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailItem = ({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) => (
    <div className="space-y-1">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            {icon}
            {label}
        </label>
        <div className="text-xs font-bold text-slate-700 truncate">{value}</div>
    </div>
);

const ConnectionCard = ({ config, isActive, onActivate, onDelete }: { config: DatabaseConfig, isActive: boolean, onActivate: () => void, onDelete: () => void }) => (
    <div className={`bg-white rounded-2xl border-2 p-5 space-y-4 transition-all ${isActive ? 'border-[#1e709a] shadow-md ring-1 ring-[#1e709a]' : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'}`}>
        <div className="flex justify-between items-start">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${config.type === 'ORACLE' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        {config.type === 'ORACLE' ? 'Oracle ADB' : 'PostgreSQL'}
                    </span>
                    {isActive && (
                        <span className="flex items-center gap-1 text-[9px] font-black text-[#10b981] uppercase">
                             <div className="w-1 h-1 bg-[#10b981] rounded-full"></div>
                             Active
                        </span>
                    )}
                </div>
                <h4 className="text-sm font-black text-slate-800 truncate pr-4">{config.name}</h4>
                <div className="text-[10px] text-slate-400 font-bold truncate">{config.user}@{config.database}</div>
            </div>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-[#1e709a] text-white' : 'bg-slate-50 text-slate-400'}`}>
                <Icons.Database className="w-4 h-4" />
            </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
            {!isActive ? (
                <button 
                    onClick={onActivate}
                    className="flex-1 bg-slate-50 hover:bg-[#e5f1f8] text-slate-600 hover:text-[#1e709a] py-1.5 rounded-lg text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 border border-slate-100 hover:border-[#1e709a]/30"
                >
                    <Icons.Activity className="w-3 h-3" />
                    Activate
                </button>
            ) : (
                <div className="flex-1 bg-[#e5f1f8] text-[#1e709a] py-1.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-2 border border-[#1e709a]">
                    <Icons.Activity className="w-3 h-3" />
                    Active
                </div>
            )}
            <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors" title="Edit">
                <Icons.File className="w-3.5 h-3.5" />
            </button>
            {!isActive && (
                <button 
                    onClick={onDelete}
                    className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors" 
                    title="Delete"
                >
                    <Icons.X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    </div>
);

export default DatabaseConfigPage;
