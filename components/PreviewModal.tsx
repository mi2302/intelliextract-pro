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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100">
                            <Icons.Brain className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 tracking-tight">Data Preview</h2>
                            <p className="text-xs text-slate-500 font-medium">Review extraction results and generated SQL</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-6 border-b border-slate-100 bg-white sticky top-0 z-10">
                    <button
                        onClick={() => setActiveTab('data')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${activeTab === 'data'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        Data Preview ({data.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('query')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${activeTab === 'query'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        Generated SQL
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
                                            <table className="t-Report-report w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-200">
                                                        {columns.map((col, idx) => (
                                                            <th key={col.id || idx} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                                                                {col.targetName}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {data.map((row, rowIdx) => (
                                                        <tr key={rowIdx} className="hover:bg-blue-50/50 transition-colors">
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
                                <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-800 flex flex-col h-[60vh]">
                                    <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">SQL Editor</span>
                                            <span className="text-xs text-blue-400 italic">Paste your query to auto-map columns</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => navigator.clipboard.writeText(editableQuery)}
                                                className="t-Button t-Button--simple flex items-center gap-1"
                                            >
                                                <Icons.Copy className="w-3 h-3" /> Copy
                                            </button>
                                            {onApplySql && (
                                                <button
                                                    onClick={() => onApplySql(editableQuery)}
                                                    className="t-Button t-Button--primary flex items-center gap-1"
                                                >
                                                    <Icons.Brain className="w-3 h-3" /> Auto-Map from SQL
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <textarea
                                        value={editableQuery}
                                        onChange={(e) => setEditableQuery(e.target.value)}
                                        className="flex-1 w-full bg-slate-900 text-green-400 p-4 font-mono text-sm leading-relaxed outline-none resize-none custom-scrollbar"
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
                        className="t-Button"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PreviewModal;
