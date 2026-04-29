import React from 'react';
import { FusionConfig } from '../types';
import { Icons } from '../constants';

interface FusionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<FusionConfig>) => void;
  initialData?: FusionConfig | null;
}

const FusionConfigModal: React.FC<FusionConfigModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
  const [formData, setFormData] = React.useState<Partial<FusionConfig>>({
    name: '',
    url: '',
    username: '',
    password: '',
  });

  React.useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({
        name: '',
        url: '',
        username: '',
        password: '',
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl rounded-md shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">

        {/* Header (Matching Reference Image) */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <h2 className="text-m font-black text-slate-800 uppercase tracking-tight">
              {initialData ? 'Edit Environment' : 'Add Environment'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSave(formData)}
              className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              {initialData ? 'Update' : 'Create'}
            </button>
            <button
              onClick={onClose}
              className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8 overflow-y-auto max-h-[80vh] custom-scrollbar">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">

            {/* Environment Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.10em] pl-1">
                Environment Name
              </label>
              <input
                type="text"
                placeholder="e.g. Oracle Fusion Demo"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-4 focus:ring-[#1e709a]/5 focus:border-[#1e709a]/30 transition-all"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Cloud URL */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.10em] pl-1">
                Cloud URL
              </label>
              <input
                type="text"
                placeholder="https://fa-xxxx-dev.oraclecloud.com"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-[13px] font-mono outline-none focus:ring-4 focus:ring-[#1e709a]/5 focus:border-[#1e709a]/30 transition-all text-[#1e709a]"
                value={formData.url || ''}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              />
            </div>

            {/* Cloud Username */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.10em] pl-1">
                Cloud Username
              </label>
              <input
                type="text"
                placeholder="e.g. FUSION_USER"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-4 focus:ring-[#1e709a]/5 focus:border-[#1e709a]/30 transition-all font-bold"
                value={formData.username || ''}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>

            {/* Cloud Password */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.10em] pl-1">
                Cloud Password
              </label>
              <input
                type="password"
                placeholder={initialData ? "Leave blank to keep current" : "••••••••"}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-4 focus:ring-[#1e709a]/5 focus:border-[#1e709a]/30 transition-all"
                value={formData.password || ''}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
          </div>

          <div className="h-[1px] bg-slate-100 w-full"></div>

          {/* Additional placeholders to match screenshot visuals if desired, but user said "only these 4" */}
          {/* <div className="opacity-40 select-none pointer-events-none">
            <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-4">Advanced Configuration (Locked)</div>
            <div className="grid grid-cols-2 gap-8">
              <div className="h-10 bg-slate-50 rounded-lg"></div>
              <div className="h-10 bg-slate-50 rounded-lg"></div>
            </div>
          </div> */}
        </div>

      </div>
    </div>
  );
};

export default FusionConfigModal;
