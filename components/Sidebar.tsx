
import React from 'react';
import { ObjectGroup } from '../types';
import { Icons } from '../constants';

interface SidebarProps {
  groups: ObjectGroup[];
  selectedGroupId: string | null;
  activeSpecId: string | null;
  onGroupSelect: (groupId: string) => void;
  onCreateSpec: (groupId: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  groups,
  selectedGroupId,
  activeSpecId,
  onGroupSelect,
  onCreateSpec
}) => {
  return (
    <div className="t-Region redwood-sidebar w-80 h-full flex flex-col shadow-2xl z-20">
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <div className="bg-blue-600 p-2 rounded-lg shadow-lg">
          <Icons.Database className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight">IntelliExtract</h1>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
        <div className="px-3 mb-2 flex justify-between items-center">
          <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Connected Models</h2>
          <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700">{groups.length}</span>
        </div>
        {groups.map((group) => {
          const isGroupSelected = selectedGroupId === group.id;
          const isOracle = group.databaseType === 'ORACLE';

          return (
            <div key={group.id} className="space-y-1">
              <div
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl transition-all cursor-pointer ${isGroupSelected && !activeSpecId ? 'bg-blue-600/10 border border-blue-500/30' :
                  isGroupSelected && activeSpecId ? 'bg-slate-900 border border-slate-800' :
                    'hover:bg-slate-900'
                  }`}
                onClick={() => onGroupSelect(group.id)}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className={`shrink-0 w-1.5 h-1.5 rounded-full ${isGroupSelected ? (isOracle ? 'bg-orange-500' : 'bg-blue-400') : 'bg-slate-700'}`}></div>
                  <div className="flex flex-col min-w-0">
                    <span className={`truncate text-sm font-bold ${isGroupSelected ? 'text-slate-100' : 'text-slate-400 group-hover:text-slate-200'}`}>
                      {group.name}
                    </span>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${isOracle ? 'text-orange-400' : 'text-blue-200'}`}>
                      {group.databaseType === 'ORACLE' ? 'Oracle ATP' : 'PostgreSQL'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateSpec(group.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:bg-blue-600 hover:text-white rounded-lg transition-all"
                  title="Quick Extract"
                >
                  <Icons.Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 bg-black/20 border-t border-white/5">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/10">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-600 to-orange-500 flex items-center justify-center font-bold text-white text-xs shadow-inner">SA</div>
          <div className="text-[10px] flex-1">
            <div className="text-slate-200 font-bold">System Admin</div>
            <div className="text-slate-400 font-medium">Enterprise Tier</div>
          </div>
          <Icons.Settings className="w-3.5 h-3.5 text-slate-400 hover:text-white cursor-pointer" />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
