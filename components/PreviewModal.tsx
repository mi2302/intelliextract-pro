import React, { useState } from 'react';
import { Icons } from '../constants'; // Assumes Icons are exported from constants
import { ColumnDefinition } from '../types';

interface PreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: any[];
    query: string;
    columns: ColumnDefinition[];
    isLoading: boolean;
    onApplySql?: (sql: string) => void;
}

const PreviewModal: React.FC<PreviewModalProps> = ({
    isOpen,
    onClose,
    data,
    query,
    columns,
    isLoading,
    onApplySql
}) => {
    const [activeTab, setActiveTab] = useState<'data' | 'query'>('data');
    const [editableQuery, setEditableQuery] = useState(query);

    // Sync editable query when prop changes
    React.useEffect(() => {
        setEditableQuery(query);
    }, [query]);

    if (!isOpen) return null;

    return (
        <div className="ml-64 fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-white">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-[#e5f1f8] flex items-center justify-center text-[#1e709a] border border-[#1e709a]/10">
                            <Icons.Brain className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-[#212121] tracking-tight uppercase tracking-wider">Data Preview & Validation</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose">Review extraction results and generated Oracle SQL</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-6 border-b border-slate-100 bg-white sticky top-0 z-10">
                    <button
                        onClick={() => setActiveTab('data')}
                        className={`px-6 py-4 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'data'
                            ? 'border-[#1e709a] text-[#1e709a]'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                    >
                        Dataset Preview ({data.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('query')}
                        className={`px-6 py-4 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'query'
                            ? 'border-[#1e709a] text-[#1e709a]'
                            : 'border-transparent text-slate-400 hover:text-slate-600'
                            }`}
                    >
                        Oracle SQL Statement
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto bg-slate-50 p-6">
                    {isLoading ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm font-bold">Fetching data...</p>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'data' && (
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                                    {data.length === 0 ? (
                                        <div className="p-12 text-center text-slate-400">
                                            <Icons.Database className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                            <p className="font-bold">No data returned.</p>
                                            <p className="text-xs mt-1">Try adjusting your filters or checking the SQL query.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-100">
                                                        {columns.map((col, idx) => (
                                                            <th key={col.id || idx} className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-[#212121] whitespace-nowrap border-r border-slate-100 last:border-0">
                                                                {col.targetName}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {data.map((row, rowIdx) => (
                                                        <tr key={rowIdx} className="hover:bg-[#e5f1f8]/30 transition-colors">
                                                            {columns.map((col, colIdx) => {
                                                                const val = row[col.targetName];
                                                                const isNull = val === null || val === undefined;
                                                                return (
                                                                    <td key={`${rowIdx}-${colIdx}`} className={`px-4 py-2.5 text-xs whitespace-nowrap font-medium ${isNull ? 'text-slate-300 italic' : 'text-slate-600'}`}>
                                                                        {isNull ? 'NULL' : val}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'query' && (
                                <div className="bg-[#1a1a1a] rounded-lg overflow-hidden shadow-lg border border-[#333] flex flex-col h-[60vh]">
                                    <div className="flex items-center justify-between px-4 py-3 bg-[#212121] border-b border-[#333]">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Oracle SQL Editor</span>
                                            <span className="text-[10px] text-[#1e709a] font-bold uppercase tracking-wider">AI Generated Dialect</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => navigator.clipboard.writeText(editableQuery)}
                                                className="px-3 py-1.5 bg-[#333] text-white hover:bg-[#444] rounded text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1.5"
                                            >
                                                <Icons.Copy className="w-3 h-3 text-slate-400" /> Copy Query
                                            </button>
                                            {onApplySql && (
                                                <button
                                                    onClick={() => onApplySql(editableQuery)}
                                                    className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 rounded text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1.5"
                                                >
                                                    <Icons.Brain className="w-3 h-3 text-[#1e709a]" /> Auto-Map Structure
                                                </button>

                                            )}
                                        </div>
                                    </div>
                                    <textarea
                                        value={editableQuery}
                                        onChange={(e) => setEditableQuery(e.target.value)}
                                        className="flex-1 w-full bg-[#1a1a1a] text-[#86e1fc] p-6 font-mono text-sm leading-relaxed outline-none resize-none custom-scrollbar"
                                        placeholder="SELECT column_name AS alias FROM table_name..."
                                        spellCheck="false"
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="t-Button t-Button--simple"
                    >
                        Close
                    </button>

                </div>
            </div>
        </div>
    );
};

export default PreviewModal;
