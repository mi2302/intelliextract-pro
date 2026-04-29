import React, { useState } from 'react';
import { DatabaseConfig, DBType } from '../types';
import { Icons } from '../constants';

interface DatabaseConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: DatabaseConfig) => void;
  isLoading?: boolean;
}

const DatabaseConnectionModal: React.FC<DatabaseConnectionModalProps> = ({ isOpen, onClose, onSave, isLoading = false }) => {
  const [config, setConfig] = useState<DatabaseConfig>({
    name: '',
    type: 'ORACLE',
    host: '',
    port: 1521,
    database: '',
    user: '',
    password: ''
  });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
        const res = await fetch('http://localhost:3006/api/db/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const result = await res.json();
        setTestResult(result);
    } catch (err: any) {
        setTestResult({ success: false, message: err.message });
    } finally {
        setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-3">
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-sm">← Back to Connections</button>
            </div>
            <Icons.X className="w-5 h-5 text-slate-300 hover:text-slate-500 cursor-pointer" onClick={onClose} />
        </div>

        <div className="p-8 space-y-8">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">New Connection</h2>

            <div className="space-y-6">
                {/* Connection Name */}
                <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Connection Name *</label>
                    <input
                        type="text"
                        placeholder="e.g. Production Oracle ADB, Dev PostgreSQL"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-[#1e709a]/20 outline-none transition-all"
                        value={config.name}
                        onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    />
                </div>

                {/* Database Type */}
                <div className="space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Database Type</label>
                    <div className="grid grid-cols-3 gap-4">
                        <TypeButton 
                            active={config.type === 'POSTGRES'} 
                            label="PostgreSQL" 
                            icon="🐘" 
                            onClick={() => setConfig({...config, type: 'POSTGRES', port: 5432})} 
                        />
                        <TypeButton 
                            active={config.type === 'ORACLE'} 
                            label="Oracle DBCS" 
                            icon="🔶" 
                            onClick={() => setConfig({...config, type: 'ORACLE', port: 1521})} 
                        />
                         <TypeButton 
                            active={config.type === 'ORACLE'} 
                            label="Oracle ADB" 
                            icon="☁️" 
                            onClick={() => setConfig({...config, type: 'ORACLE', port: 1521})} 
                        />
                    </div>
                </div>

                {/* Connection Details */}
                <div className="bg-[#f0f9ff]/50 rounded-2xl p-6 border border-blue-100/50 space-y-6">
                    <div className="flex items-center gap-2 text-[#1e709a] mb-2">
                        <Icons.Database className="w-4 h-4" />
                        <span className="text-xs font-black uppercase tracking-wider">{config.type} Details</span>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                        <div className="col-span-3 space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Host *</label>
                            <input
                                type="text"
                                placeholder="e.g. dpg-abc123.render.com"
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                value={config.host}
                                onChange={(e) => setConfig({ ...config, host: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Port *</label>
                            <input
                                type="number"
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                value={config.port}
                                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Database Name / Service Name *</label>
                        <input
                            type="text"
                            placeholder="e.g. replicationdb"
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                            value={config.database}
                            onChange={(e) => setConfig({ ...config, database: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Username *</label>
                            <input
                                type="text"
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                value={config.user}
                                onChange={(e) => setConfig({ ...config, user: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Password *</label>
                            <input
                                type="password"
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                value={config.password}
                                onChange={(e) => setConfig({ ...config, password: e.target.value })}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {testResult && (
                <div className={`p-4 rounded-xl text-xs font-bold border ${testResult.success ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${testResult.success ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        {testResult.message}
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center pt-4">
                <button 
                    onClick={handleTest}
                    disabled={isTesting || !config.host}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-bold disabled:opacity-50 transition-colors"
                >
                    <Icons.Activity className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
                    <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
                </button>

                <button
                    onClick={() => onSave(config)}
                    disabled={isLoading || !config.name || !config.host || !config.user}
                    className="bg-[#1e709a] hover:bg-[#165678] text-white px-8 py-3 rounded-xl font-black text-sm shadow-xl flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                    <Icons.File className="w-4 h-4" />
                    <span>{isLoading ? 'Saving...' : 'Save Connection'}</span>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

const TypeButton = ({ active, label, icon, onClick }: { active: boolean, label: string, icon: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`flex-1 flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${active ? 'border-[#10b981] bg-[#f0fdf4] shadow-sm' : 'border-slate-100 hover:border-slate-200 bg-white'}`}
    >
        <span className="text-xl">{icon}</span>
        <span className={`text-[10px] font-black uppercase tracking-wider ${active ? 'text-[#059669]' : 'text-slate-400'}`}>{label}</span>
    </button>
);

export default DatabaseConnectionModal;
