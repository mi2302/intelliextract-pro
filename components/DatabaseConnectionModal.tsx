
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
                className={`t-Button flex-1 ${config.type === 'POSTGRES' ? 't-Button--primary' : ''}`}
              >
                PostgreSQL
              </button>
              <button
                onClick={() => setConfig({ ...config, type: 'ORACLE', port: 1521 })}
                disabled={isLoading}
                className={`t-Button flex-1 ${config.type === 'ORACLE' ? 't-Button--primary' : ''}`}
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
            className="t-Button disabled:opacity-50 flex-1"
          >
            Cancel
          </button>
          <button
            onClick={() => onConnect(config)}
            disabled={isLoading}
            className="t-Button t-Button--primary flex-1 flex items-center justify-center gap-2 disabled:opacity-70"
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
