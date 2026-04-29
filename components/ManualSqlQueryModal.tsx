import React, { useState } from 'react';
import { Icons } from '../constants';

interface ManualSqlQueryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApplySqlMapping: (mappings: any[]) => void;
}

const ManualSqlQueryModal: React.FC<ManualSqlQueryModalProps> = ({
    isOpen,
    onClose,
    onApplySqlMapping
}) => {
    const [sql, setSql] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleApply = async () => {
        if (!sql.trim()) {
            alert("Please enter a SQL query.");
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch('http://localhost:3006/api/fbdi/sql-to-json-mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql })
            });
            const result = await response.json();
            if (result.success && result.mappings) {
                onApplySqlMapping(result.mappings);
                onClose();
            } else {
                alert("Failed to analyze SQL: " + (result.message || "Unknown error"));
            }
        } catch (err: any) {
            alert("Error: " + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-white">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-[#e5f1f8] flex items-center justify-center text-[#1e709a] border border-[#1e709a]/10">
                            <Icons.Code className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-[#212121] tracking-tight uppercase tracking-wider">Manual SQL Query</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-loose">Paste your Oracle SQL query to auto-map columns</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <Icons.X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 bg-slate-50">
                    <div className="bg-[#1a1a1a] rounded-lg overflow-hidden shadow-lg border border-[#333] flex flex-col h-[50vh]">
                        <div className="flex items-center justify-between px-4 py-3 bg-[#212121] border-b border-[#333]">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Oracle SQL Editor</span>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setSql('')}
                                    className="text-[10px] font-bold text-slate-500 hover:text-white uppercase transition-colors"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <textarea
                            value={sql}
                            onChange={(e) => setSql(e.target.value)}
                            className="flex-1 w-full bg-[#1a1a1a] text-[#86e1fc] p-6 font-mono text-sm leading-relaxed outline-none resize-none custom-scrollbar"
                            placeholder="SELECT FIRST_NAME AS &quot;First Name&quot;, LAST_NAME AS &quot;Last Name&quot; FROM EMPLOYEES..."
                            spellCheck="false"
                            autoFocus
                        />
                    </div>
                    
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                        <p className="text-xs text-blue-700 font-medium leading-relaxed">
                            <span className="font-bold">Tip:</span> Ensure each column in your SELECT statement has an alias (<code>AS "Alias Name"</code>) that matches the <span className="font-bold">Output Label Header</span> in the extraction mapping.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-slate-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="t-Button t-Button--simple"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={!sql.trim() || isProcessing}
                        className="t-Button t-Button--simple flex items-center gap-2 bg-[#1e709a] text-white hover:bg-[#165676] border-none disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Mapping Analysis...
                            </>
                        ) : (
                            <>
                                <Icons.Brain className="w-4 h-4" /> Auto-Map Structure
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ManualSqlQueryModal;
