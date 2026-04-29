import React, { useState, useEffect } from 'react';
import { FusionConfig } from '../types';
import { Icons } from '../constants';
import FusionConfigModal from './FusionConfigModal';
import { fetchFusionConfigs, saveFusionConfig, deleteFusionConfig } from '../services/fusionService';

const FusionConfigPage: React.FC = () => {
    const [configs, setConfigs] = useState<FusionConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedConfig, setSelectedConfig] = useState<FusionConfig | null>(null);

    useEffect(() => {
        loadConfigs();
    }, []);

    const loadConfigs = async () => {
        setIsLoading(true);
        try {
            const data = await fetchFusionConfigs();
            setConfigs(data);
        } catch (err) {
            console.error("Failed to load configs:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async (data: Partial<FusionConfig>) => {
        try {
            const result = await saveFusionConfig(data);
            if (result.success) {
                await loadConfigs();
                setIsModalOpen(false);
                setSelectedConfig(null);
            }
        } catch (err) {
            alert("Failed to save configuration.");
        }
    };

    const handleEdit = (config: FusionConfig) => {
        setSelectedConfig(config);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (confirm("Delete this environment configuration?")) {
            try {
                await deleteFusionConfig(id);
                await loadConfigs();
            } catch (err) {
                alert("Failed to delete configuration.");
            }
        }
    };

    return (
        <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-y-auto custom-scrollbar">
            <div className="p-8 max-w-6xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">

                {/* Header matching Image 1 */}
                <div className="flex justify-between items-center bg-blue p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div>
                        <h1 className="text-2m font-black text-[#1a2b3c]">Environment Configuration</h1>
                        <p className="text-[11px] text-blue-600 font-bold mt-1">Manage Cloud Instances & Credentials</p>
                    </div>

                    <button
                        onClick={() => { setSelectedConfig(null); setIsModalOpen(true); }}
                        className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
                    >
                        <Icons.Plus className="w-4 h-4 stroke-[3px] group-hover:rotate-90 transition-transform" />
                        <span>Add Environment</span>
                    </button>
                </div>

                {/* Configurations List */}
                <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                    {isLoading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="hover-div animate-pulse h-[180px] bg-white border border-slate-100 shadow-sm opacity-50"></div>
                        ))
                    ) : (
                        configs.map((config) => (
                            <div
                                key={config.id}
                                onClick={() => handleEdit(config)}
                                className="hover-div group flex flex-col justify-between"
                            >
                                {/* Subtle Accent Bar */}
                                <div className={`absolute top-0 left-0 w-full h-[3px] ${config.isActive ? 'bg-blue' : 'bg-slate-50'} group-hover:bg-[#1e709a] transition-colors`}></div>

                                {/* Card Header */}
                                <div className="flex items-start justify-between w-full mb-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center text-[#1e709a] border border-slate-100 font-black text-xs group-hover:bg-[#1e709a] group-hover:text-white transition-all duration-300 shadow-sm">
                                            <Icons.Settings className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="select_card text-[#1e709a] mb-0.5" title={config.name}>
                                                {config.name}
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(config.id); }}
                                        className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    >
                                        <Icons.X className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Card Content (Matching Dashboard style) */}
                                <div className="space-y-1.5 mt-2">
                                    <div className="content text-xs text-slate-600">
                                        <span className="content-label text-slate-400 font-bold uppercase tracking-tighter" style={{ width: '100px' }}>Cloud URL</span>:
                                        <span className="truncate ml-1 font-bold text-[12px] text-[#black]">{config.url}</span>
                                    </div>
                                    <div className="content text-xs text-slate-600">
                                        <span className="content-label text-slate-400 font-bold uppercase" style={{ width: '100px' }}>Username</span>:
                                        <span className="font-bold ml-1">{config.username}</span>
                                    </div>
                                </div>

                                {/* The "Cool" Arrow */}
                                <div className="flex justify-end mt-4">
                                    <svg className="w-5 h-5 text-slate-300 group-hover:text-[#1e709a] group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                </div>
                            </div>
                        ))
                    )}

                    {!isLoading && configs.length === 0 && (
                        <div className="col-span-full py-20 text-center bg-white rounded-2xl border-2 border-dashed border-slate-200">
                            <Icons.Globe className="w-12 h-12 mx-auto mb-4 text-slate-200" />
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No environments configured yet</p>
                        </div>
                    )}
                </div>
            </div>

            <FusionConfigModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                initialData={selectedConfig}
            />
        </div>
    );
};

const DetailItem = ({ label, value, isMono = false, isAccent = false }: { label: string, value: string, isMono?: boolean, isAccent?: boolean }) => (
    <div className="space-y-1.5 min-w-0">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {label}
        </div>
        <div className={`text-sm font-bold truncate ${isMono ? 'font-mono text-xs text-[#1e709a]' : 'text-slate-700'} ${isAccent ? 'text-[#10b981]' : ''}`}>
            {value}
        </div>
    </div>
);

export default FusionConfigPage;
