import React, { useState, useMemo } from 'react';
import { Icons } from '../constants';
import { ObjectGroup, FileSpecification } from '../types';

interface DashboardViewProps {
  groups: ObjectGroup[];
  specifications: FileSpecification[];
  onModelSelect: (id: string) => void;
  onNewImport: () => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({ groups, specifications, onModelSelect, onNewImport }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Fixed Filter Logic: Memoized for performance and accuracy
  const filteredGroups = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return groups;

    return groups.filter(g =>
      g.name.toLowerCase().includes(term) ||
      (g.templateName || '').toLowerCase().includes(term) ||
      g.objects.some(obj => obj.tableName.toLowerCase().includes(term))
    );
  }, [groups, searchTerm]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER SECTION (MATCHING REFERENCE IMAGE) */}
      <div className="flex flex-col md:flex-row md:items-end justify-between items-start gap-4 mb-2">
        <div className="space-y-1">
          <h1 className="text-[22px] font-[800] text-[#1a2b3c] tracking-tight leading-none">Dashboard</h1>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em]">MODEL REGISTRY</p>
        </div>

        <div className="flex items-center gap-2 flex-1 md:justify-end">
          {/* SEARCH BAR (INTEGRATED) */}
          <div className="relative w-full max-w-xs group">
            <Icons.Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none group-focus-within:text-[#1e709a]" />
            <input
              type="text"
              placeholder="Filter models..."
              className="w-full pl-11 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#1e709a]/5 focus:border-[#1e709a]/30 transition-all font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
              >
                <Icons.Plus className="w-3 h-3 rotate-45 stroke-[3px]" />
              </button>
            )}
          </div>

          <button
            onClick={onNewImport}
            className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <Icons.Plus className="w-4 h-4 stroke-[2px]" />
            New Import (FBDI)
          </button>
        </div>
      </div>

      <div className="h-[1px] bg-slate-200 w-full opacity-60"></div>

      {/* COMPACT CARD GRID (THEMED & ENHANCED) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
        {filteredGroups.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white rounded-2xl border-2 border-dashed border-slate-200">
            <Icons.Database className="w-12 h-12 mx-auto mb-4 text-slate-200" />
            <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No matching models found</p>
          </div>
        ) : filteredGroups.map((group) => {
          const tableCount = group.objects.length;
          const extractionCount = specifications.filter(s => s.objectGroupId === group.id).length;

          return (
            <div
              key={group.id}
              onClick={() => onModelSelect(group.id)}
              className="hover-div group flex flex-col justify-between"
              style={{ minHeight: '220px' }}
            >
              <div className="flex items-start justify-between w-full mb-4">
                {/* ID/Initials Badge */}
                <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center text-[#1e709a] border border-slate-100 font-black text-xs group-hover:bg-[#1e709a] group-hover:text-white transition-all duration-300 shadow-sm">
                  {group.name.substring(0, 2).toUpperCase()}
                </div>

                <div className="flex items-center gap-3">
                  {/* Styled Database Type Badge */}
                  <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter border ${group.databaseType === 'ORACLE'
                    ? 'bg-blue-50 text-blue-600 border-blue-100'
                    : 'bg-[#1e709a]/5 text-[#1e709a] border-[#1e709a]/10'
                    }`}>
                    {group.databaseType}
                  </div>

                  {/* Options Menu */}
                  <div className="options" onClick={(e) => e.stopPropagation()}>
                    <div className="fa fa-ellipsis-h text-slate-300 hover:text-[#1e709a] transition-colors"></div>
                    <div className="menu-options shadow-xl border border-slate-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2 text-slate-600 hover:text-[#1e709a]" onClick={() => alert('Copying feature coming soon.')}>
                        <span className="fa fa-clone"></span> Copy
                      </div>
                      <div className="h-[1px] bg-slate-100"></div>
                      <div className="px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2 text-slate-600 hover:text-[#1e709a]" onClick={() => onModelSelect(group.id)}>
                        <span className="fa fa-eye"></span> View
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="sub_class mt-2">
                <div className="select_card text-[#1e709a] mb-2 text-m" title={group.name}>
                  {group.name}
                </div>
                <div className="space-y-1">
                  {/* <div className="content text-xs text-slate-600">
                    <span className="content-label text-slate-400 font-bold uppercase tracking-tighter" style={{ width: '100px' }}>Database</span>: {group.databaseType}
                  </div> */}
                  <div className="content text-xs text-slate-600">
                    <span className="content-label text-slate-400 font-bold uppercase tracking-tighter" style={{ width: '100px' }}>Tables</span>: {tableCount}
                  </div>
                  <div className="content text-xs text-slate-600">
                    <span className="content-label text-slate-400 font-bold uppercase tracking-tighter" style={{ width: '100px' }}>Extractions</span>: {extractionCount}
                  </div>
                </div>
              </div>

              {/* The "Cool" Arrow */}
              <div className="flex justify-end mt-4">
                <svg className="w-5 h-5 text-slate-300 group-hover:text-[#1e709a] group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>

              {/* Subtle Accent Bar */}
              <div className="absolute top-0 left-0 w-full h-[3px] bg-slate-50 group-hover:bg-[#1e709a] transition-colors"></div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardView;
