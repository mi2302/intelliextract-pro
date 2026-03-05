
import React from 'react';
import { Icons } from '../constants';
import { FileSpecification, ExportFormat } from '../types';

interface ExtractionPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  sql: string;
  data: any[];
  format: ExportFormat;
  isLoading: boolean;
}

const ExtractionPreview: React.FC<ExtractionPreviewProps> = ({ isOpen, onClose, sql, data, format, isLoading }) => {
  if (!isOpen) return null;

  const formattedSample = () => {
    if (data.length === 0) return 'No sample data generated.';
    
    if (format === ExportFormat.CSV || format === ExportFormat.PIPE) {
      const sep = format === ExportFormat.CSV ? ',' : '|';
      const headers = Object.keys(data[0]).join(sep);
      const rows = data.map(row => Object.values(row).join(sep)).join('\n');
      return `${headers}\n${rows}`;
    }
    
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 p-2 rounded-lg text-green-600">
              <Icons.Brain className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Extraction Preview</h2>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">AI Generated Logic & Sample Output</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 rounded-xl border border-slate-100">
            <Icons.Plus className="w-5 h-5 rotate-45" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar bg-slate-50/30">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
              <p className="text-sm font-bold text-blue-600 animate-pulse uppercase tracking-widest">Simulating Extraction...</p>
            </div>
          ) : (
            <>
              {/* SQL Panel */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Generated SQL Query</h3>
                  <button onClick={() => navigator.clipboard.writeText(sql)} className="text-[10px] font-bold text-blue-600 hover:text-blue-700">Copy Code</button>
                </div>
                <div className="bg-slate-900 rounded-xl p-6 overflow-x-auto shadow-inner border border-slate-800">
                  <pre className="text-xs font-mono text-blue-300 leading-relaxed">
                    <code>{sql}</code>
                  </pre>
                </div>
              </div>

              {/* Data Preview Panel */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Sample Data Output ({format.toUpperCase()})</h3>
                  <button onClick={() => navigator.clipboard.writeText(formattedSample())} className="text-[10px] font-bold text-green-600 hover:text-green-700">Copy Output</button>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                   {format === ExportFormat.XLS || format === ExportFormat.CSV || format === ExportFormat.PIPE ? (
                     <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {data.length > 0 && Object.keys(data[0]).map(key => (
                                <th key={key} className="px-4 py-3 font-bold text-slate-600 uppercase tracking-wider">{key}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.map((row, i) => (
                              <tr key={i} className="hover:bg-slate-50 transition-colors">
                                {Object.values(row).map((val: any, j) => (
                                  <td key={j} className="px-4 py-3 text-slate-600 font-medium">{String(val)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                     </div>
                   ) : (
                     <div className="p-6 bg-slate-50">
                        <pre className="text-xs font-mono text-slate-700">
                          <code>{formattedSample()}</code>
                        </pre>
                     </div>
                   )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-white shrink-0 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExtractionPreview;
