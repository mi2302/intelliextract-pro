import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icons } from '../constants';

interface SidebarProps {
  groups: any[]; // Kept for compatibility but not primary list here
  selectedGroupId: string | null;
  activeSpecId: string | null;
  onGroupSelect: (groupId: string) => void;
  onCreateSpec: (groupId: string) => void;
  onToggleAssistant: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onToggleAssistant }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const navItems = [
    { label: 'Home', icon: <Icons.Home className="w-4 h-4" />, path: '/' },
    { label: 'Dashboard', icon: <Icons.Activity className="w-4 h-4" />, path: '/fbdi' },
    { label: 'FBDI Import', icon: <Icons.Upload className="w-4 h-4" />, path: '/fbdi/fbdi-import' },
    { label: 'Load to Fusion', icon: <Icons.Play className="w-4 h-4" />, path: '/fbdi/load-to-oracle' },
    { label: 'Environment Configuration', icon: <Icons.File className="w-4 h-4" />, path: '/fbdi/env-config' },
    { label: 'Database Config', icon: <Icons.Database className="w-4 h-4" />, path: '/fbdi/database-config' },
  ];

  return (
    <div className="w-64 h-full bg-[#fbfbfb] border-r border-slate-200 flex flex-col z-[100] shadow-sm">
      {/* Brand Header (Dark themed per image) */}
      <div className="h-[70px] px-6 bg-[#212121] flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#1e709a] flex items-center justify-center text-white">
          <Icons.Database className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          {/* <span className="text-sm font-black text-white tracking-widest uppercase truncate uppercase">IntelliExtract</span>
           */}
          <span className="text-slate-800 font-black tracking-tight text-white">IntelliExtract <span className="text-[#1e709a]">Pro</span></span>
          {/* <span className="text-[9px] text-[#1e709a] font-bold uppercase tracking-widest leading-none">Pro v2.4</span> */}
        </div>
      </div>

      <nav className="flex-1 py-4 overflow-y-auto custom-scrollbar">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = path === item.path || (item.path === '/fbdi' && path.startsWith('/fbdi/models'));
            return (
              <div
                key={item.label}
                onClick={() => navigate(item.path)}
                className={`flex items-center gap-4 px-6 py-3 cursor-pointer transition-all duration-200 border-l-[3px] ${isActive
                  ? 'bg-[#e5f1f8] text-[#1e709a] border-[#1e709a] font-bold shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]'
                  : 'text-slate-500 border-transparent hover:bg-slate-50 hover:text-slate-800'
                  }`}
              >
                <div className={`${isActive ? 'text-[#1e709a]' : 'text-slate-400'}`}>
                  {item.icon}
                </div>
                <span className="text-[11px] uppercase tracking-wider font-medium truncate">{item.label}</span>
              </div>
            );
          })}
        </div>

        {/* Support Section */}
        <div className="mt-8 px-6">
          <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-4">Support & Tools</div>
          <div
            onClick={onToggleAssistant}
            className="flex items-center gap-4 py-2 cursor-pointer text-slate-400 hover:text-[#1e709a] transition-colors group"
          >
            <Icons.Brain className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[11px] uppercase tracking-wider font-bold">AI Assistant</span>
          </div>
        </div>
      </nav>

      {/* Profile Bar */}
      <div className="p-4 border-t border-slate-100 bg-white">
        <div className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:border-[#1e709a]/30 transition-all cursor-pointer bg-slate-50/50">
          <div className="w-8 h-8 rounded-lg bg-[#333] text-white flex items-center justify-center font-black text-[10px]">
            SA
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black text-slate-800 uppercase tracking-tight truncate">System Admin</div>
            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest truncate">Test-Env</div>
          </div>
          <Icons.Settings className="w-3.5 h-3.5 text-slate-300" />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
