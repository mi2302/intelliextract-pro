import React, { useState, useRef, useEffect } from 'react';
import { Icons } from '../constants';
import * as XLSX from 'xlsx';
import { analyzeFbdiContent, AgentAnalysis } from '../utils/fbdiAnalysis';
import { analyzeFbdiMetadata } from '../services/geminiService';


interface FBDIImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (file: File, moduleNameOverride: string) => Promise<void>;
    isLoading: boolean;
}

const FBDIImportModal: React.FC<FBDIImportModalProps> = ({ isOpen, onClose, onImport, isLoading }) => {
    const [file, setFile] = useState<File | null>(null);
    const [moduleName, setModuleName] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const [agentAnalysis, setAgentAnalysis] = useState<AgentAnalysis | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) {
            setFile(null);
            setModuleName('');
            setAgentAnalysis(null);
            setIsAnalyzing(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }, [isOpen]);

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
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = async (file: File) => {
        setFile(file);
        setAgentAnalysis(null);
        setIsAnalyzing(true);
        console.log("Analyzing File:", file.name, file.size);

        try {
            const buffer = await file.arrayBuffer();
            const analysis = analyzeFbdiContent(buffer, file.name);
            setAgentAnalysis(analysis);

            if (analysis.rawMetadata && (analysis.confidence !== 'High' || analysis.moduleName.length < 3)) {
                try {
                    const aiResult = await analyzeFbdiMetadata({
                        fileName: file.name,
                        sheetNames: analysis.sheets,
                        instructions: analysis.rawMetadata.instructionText,
                        props: analysis.rawMetadata.props
                    });

                    if (aiResult.moduleName && aiResult.moduleName !== 'Unknown') {
                        setAgentAnalysis(prev => prev ? ({
                            ...prev,
                            productFamily: aiResult.productFamily,
                            moduleName: aiResult.moduleName,
                            possibleModules: aiResult.possibleModules,
                            mainObject: aiResult.mainObject,
                            intent: aiResult.intent,
                            confidence: 'High',
                            summary: `Identified: ${aiResult.intent} in ${aiResult.moduleName} (Family: ${aiResult.productFamily}). (Reason: ${aiResult.reasoning})`
                        }) : null);
                    }
                } catch (aiError) {
                    console.warn("Analysis failed, sticking to static result", aiError);
                }
            }
        } catch (e) {
            console.error("Agent Analysis Failed", e);
            alert("Analysis Failed: " + (e as any).message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSubmit = async () => {
        if (!file || !moduleName) return;
        await onImport(file, moduleName);
        setFile(null);
        setModuleName('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200">
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 tracking-tight">FBDI Import</h2>
                        <p className="text-xs font-medium text-slate-400 mt-1">Upload an Oracle FBDI Template to extract schema</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-600">
                        <Icons.Plus className="w-5 h-5 rotate-45" />
                    </button>
                </div>

                <div className="p-8 space-y-6">
                    {/* Module Selection */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Model Name</label>
                        <input
                            type="text"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-purple-500 transition-all hover:border-purple-300"
                            placeholder="Enter a name for this data model..."
                            value={moduleName}
                            onChange={(e) => setModuleName(e.target.value)}
                            required
                        />
                        <p className="text-[10px] text-slate-400 ml-1">This will be the unique identifier for your imported model</p>
                    </div>

                    {/* File Upload */}
                    <div
                        className={`border-2 border-dashed rounded-2xl p-8 transition-all text-center relative ${dragActive ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-purple-300 hover:bg-slate-50'}`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept=".xlsx,.xls,.csv"
                            onChange={handleChange}
                        />

                        {file ? (
                            <div className="flex flex-col items-center">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-green-600 mb-3">
                                    <Icons.File className="w-6 h-6" />
                                </div>
                                <p className="font-bold text-slate-700 text-sm">{file.name}</p>
                                <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                                    className="text-[10px] text-red-500 font-bold uppercase tracking-widest mt-4 hover:underline"
                                >
                                    Remove File
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600 mb-3">
                                    <Icons.Upload className="w-6 h-6" />
                                </div>
                                <p className="font-bold text-slate-600 text-sm">Click to upload FBDI template</p>
                                <p className="text-xs text-slate-400 mt-1">or drag and drop file here</p>
                            </div>
                        )}
                    </div>

                    {/* 🤖 Agent Insight Card */}
                    {!isAnalyzing && agentAnalysis && (
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center gap-3 mb-2">
                                <div>
                                </div>
                            </div>
                            <div className="space-y-1 pl-11">
                                <div className="text-sm font-medium text-slate-800">
                                    Product Family: <span className="text-indigo-600 font-bold">{agentAnalysis.productFamily || 'Oracle Fusion'}</span>
                                </div>
                                <div className="text-sm font-medium text-slate-800">
                                    Target Module: <span className="text-indigo-600">{agentAnalysis.moduleName}</span>
                                </div>
                                {agentAnalysis.mainObject && (
                                    <div className="text-sm text-slate-600">
                                        Main Object: <span className="font-semibold text-slate-700">{agentAnalysis.mainObject}</span>
                                    </div>
                                )}
                                {agentAnalysis.possibleModules && agentAnalysis.possibleModules.length > 1 && (
                                    <div className="text-xs text-slate-500">
                                        Possible alternative modules: {agentAnalysis.possibleModules.filter(m => m !== agentAnalysis.moduleName).join(', ')}
                                    </div>
                                )}
                                <div className="text-sm text-slate-600">
                                    Intent: {agentAnalysis.intent}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 pt-4">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!file || !moduleName || isLoading}
                            className="flex-1 py-3 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition-all disabled:opacity-50 shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Icons.Download className="w-4 h-4" />
                                    Import Model
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FBDIImportModal;
