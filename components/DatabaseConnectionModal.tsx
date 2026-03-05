
import React, { useState } from 'react';
import { DatabaseConfig } from '../types';
import { Icons } from '../constants';

interface DatabaseConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: DatabaseConfig) => void;
  isLoading?: boolean;
}

const DatabaseConnectionModal: React.FC<DatabaseConnectionModalProps> = ({ isOpen, onClose, onConnect, isLoading = false }) => {
  const [config, setConfig] = useState<DatabaseConfig>({
    type: 'ORACLE',
    host: '10.0.0.27',
    port: 1521,
    database: 'DMOne_DEV.sub11061030120.eappsysvcn1.oraclevcn.com',
    user: 'DMCDATA',
    password: 'DMC@data#*27'
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8 border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
            <Icons.Database className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Database Connection</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Engine Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfig({ ...config, type: 'POSTGRES', port: 5432 })}
                disabled={isLoading}
                className={`py-2 px-4 rounded-lg text-sm font-medium border transition-all ${config.type === 'POSTGRES' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                PostgreSQL
              </button>
              <button
                onClick={() => setConfig({ ...config, type: 'ORACLE', port: 1521 })}
                disabled={isLoading}
                className={`py-2 px-4 rounded-lg text-sm font-medium border transition-all ${config.type === 'ORACLE' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                Oracle DB
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Host</label>
              <input
                type="text"
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                value={config.host}
                onChange={(e) => setConfig({ ...config, host: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Port</label>
              <input
                type="number"
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                value={config.port}
                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Database Name</label>
            <input
              type="text"
              disabled={isLoading}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              value={config.database}
              onChange={(e) => setConfig({ ...config, database: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Username</label>
              <input
                type="text"
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                value={config.user}
                onChange={(e) => setConfig({ ...config, user: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase block mb-1">Password</label>
              <input
                type="password"
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConnect(config)}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-blue-600 rounded-xl text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Connecting...</span>
              </>
            ) : (
              'Connect & Introspect'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatabaseConnectionModal;
