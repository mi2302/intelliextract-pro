
import React, { useState, useRef } from 'react';
import { Icons } from '../constants';
import { SAMPLES } from '../sampleModels';
import { DBType } from '../types';

interface ImportModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (fileName: string, content: string, dialect: DBType, parsedGroup?: any) => void;
  isLoading: boolean;
}

const ImportModelModal: React.FC<ImportModelModalProps> = ({ isOpen, onClose, onImport, isLoading }) => {
  const [dragActive, setDragActive] = useState(false);
  const [targetDialect, setTargetDialect] = useState<DBType>('POSTGRES');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;

      // Check if it's our specific CSV template format
      if (content.includes('Module:') && content.includes('# SECTION:')) {
        try {
          const lines = content.split('\n').map(l => l.trim()).filter(l => l);
          const moduleName = lines.find(l => l.startsWith('Module:'))?.replace('Module:', '').replace(/,+$/, '').trim() || 'Imported Module';

          const objects = [];
          let currentTable = '';
          let hasColumns = false;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('# SECTION:')) {
              currentTable = line.replace('# SECTION:', '').replace(/,+$/, '').trim();
              hasColumns = false;
            } else if (currentTable && !hasColumns && !line.startsWith('Module:')) {
              // Found headers line immediately after section or next valid line
              const headers = line.split(',');
              const fields = headers.map(h => ({
                name: h.trim(),
                type: 'STRING', // Defaulting to STRING for now
                description: ''
              }));

              objects.push({
                id: currentTable,
                name: currentTable,
                tableName: currentTable,
                fields: fields
              });
              hasColumns = true;
            }
          }

          // Construct ObjectGroup
          const parsedGroup: any = {
            id: `grp_${Date.now()}`,
            name: moduleName,
            databaseType: 'CSV',
            objects: objects,
            relationships: []
          };

          onImport(file.name, content, targetDialect, parsedGroup);
          return; // Exit early as we have handled the import
        } catch (err) {
          console.error("CSV Parse Error", err);
        }
      }

      onImport(file.name, content, targetDialect);
    };
    reader.readAsText(file);
  };

  const handleSampleClick = (sample: typeof SAMPLES[0]) => {
    if (isLoading) return;
    onImport(sample.fileName, sample.content, targetDialect);
  };

  const downloadSample = (e: React.MouseEvent, sample: typeof SAMPLES[0]) => {
    e.stopPropagation(); // Prevent triggering the import click
    const element = document.createElement("a");
    const file = new Blob([sample.content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = sample.fileName;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-8 border border-slate-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-purple-100 p-2 rounded-lg text-purple-600">
              <Icons.Upload className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Import Model Architecture</h2>
          </div>
          <button onClick={onClose} className="t-Button t-Button--icon t-Button--noLabel t-Button--simple">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          Upload a file to build a new Data Model. AI will parse the structure based on your selected dialect.
        </p>

        <div className="mb-6">
          <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block tracking-widest">Target Database Dialect</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTargetDialect('POSTGRES')}
              className={`t-Button flex-1 flex items-center justify-center gap-2 ${targetDialect === 'POSTGRES' ? 't-Button--primary' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full ${targetDialect === 'POSTGRES' ? 'bg-white' : 'bg-blue-400'}`}></div>
              PostgreSQL
            </button>
            <button
              onClick={() => setTargetDialect('ORACLE')}
              className={`t-Button flex-1 flex items-center justify-center gap-2 ${targetDialect === 'ORACLE' ? 't-Button--primary' : ''}`}
            >
              <div className={`w-2 h-2 rounded-full ${targetDialect === 'ORACLE' ? 'bg-white' : 'bg-orange-400'}`}></div>
              Oracle ATP/DBCS
            </button>
          </div>
        </div>

        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all ${dragActive ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300 bg-slate-50'
            } ${isLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => !isLoading && fileInputRef.current?.click()}
        >
          {isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
              <span className="text-sm font-bold text-purple-600 animate-pulse uppercase tracking-wider text-center">AI Architecting Model...</span>
            </div>
          ) : (
            <>
              <Icons.Upload className="w-12 h-12 text-slate-300 mb-4" />
              <div className="text-sm font-medium text-slate-600 text-center">
                <span className="text-purple-600 font-bold">Click to upload</span> or drag and drop
              </div>
              <div className="text-xs text-slate-400 mt-2">SQL DDL, JSON Schemas, or sample data files</div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        <div className="mt-8">
          <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 tracking-widest">Quick Start: Try or Download Sample</h4>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((sample) => (
              <div
                key={sample.name}
                className="flex items-center bg-slate-100 rounded-full border border-slate-200 hover:border-purple-200 transition-all group overflow-hidden"
              >
                <button
                  onClick={() => handleSampleClick(sample)}
                  disabled={isLoading}
                  className="pl-3 pr-2 py-1.5 flex items-center gap-1.5 hover:bg-purple-50 hover:text-purple-700 text-slate-600 text-xs font-semibold transition-all disabled:opacity-50"
                  title="Import this sample model"
                >
                  <div className={`w-2 h-2 rounded-full ${sample.icon === 'sql' ? 'bg-blue-400' : sample.icon === 'json' ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                  {sample.name}
                </button>
                <button
                  onClick={(e) => downloadSample(e, sample)}
                  className="px-2 py-1.5 border-l border-slate-200 hover:bg-purple-100 text-slate-400 hover:text-purple-600 transition-all"
                  title={`Download ${sample.fileName}`}
                >
                  <Icons.Download className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100">
          <button
            disabled={isLoading}
            onClick={onClose}
            className="t-Button w-full disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportModelModal;
