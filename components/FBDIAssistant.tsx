import React, { useState, useEffect, useRef } from 'react';
import { ObjectGroup, FileSpecification, ColumnDefinition, FusionConfig } from '../types';
import { Icons as BaseIcons } from '../constants';

const InternalIcons = {
    ...BaseIcons,
    ChevronRight: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
    ),
    Link: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
        </svg>
    ),
    Unlock: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
    ),
    File: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
    ),
    Send: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
    ),
    Minimize: (props: any) => (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
        </svg>
    )
};


interface Message {
    id: string;
    text: string;
    sender: 'user' | 'assistant';
    timestamp: Date;
    sources?: { template: string; sheet: string }[];
    action?: {
        type: string;
        metadata: any;
    };
    options?: { label: string; value: string; url?: string }[];
    metadata?: any;
}
interface FBDIAssistantProps {
    isFullPage?: boolean;
    onFbdiSubmit?: (file: File, moduleName: string, options?: { silent?: boolean, onProgress?: (msg: string, isMajor?: boolean) => void }) => Promise<any>;
    isOpen?: boolean;
    onClose?: () => void;
    onToggleMode?: () => void;
    fusionConfigs?: FusionConfig[];
    onRunExtraction?: (targetSpec?: FileSpecification, formatOverride?: any, options?: { silent?: boolean; onProgress?: (msg: string) => void; onComplete?: (filename: string) => void }) => Promise<void>;
    onRunBatchExtraction?: (format: any, options?: { silent?: boolean; onProgress?: (msg: string) => void; onComplete?: (filename: string) => void }) => Promise<void>;
    models?: ObjectGroup[];
}

const FBDIAssistant: React.FC<FBDIAssistantProps> = ({
    isFullPage = false,
    onFbdiSubmit,
    isOpen: externalIsOpen,
    onClose,
    onToggleMode,
    fusionConfigs = [],
    models = [],
    onRunExtraction,
    onRunBatchExtraction
}) => {
    const [internalIsOpen, setInternalIsOpen] = useState(isFullPage);
    const [isMinimized, setIsMinimized] = useState(false);

    // Sync internal state with prop if controlled
    useEffect(() => {
        if (externalIsOpen !== undefined) {
            setInternalIsOpen(externalIsOpen);
            if (externalIsOpen) setIsMinimized(false); // Open fully when triggered from sidebar
        }
    }, [externalIsOpen]);

    const handleOptionClick = (option: any) => {
        if (option.url) {
            window.open(option.url, '_blank');
            return;
        }

        // Support both old '|' and new '@@' command separators
        if (typeof option.value === 'string' && (option.value.includes('RUN_EXTRACTION@@') || option.value.startsWith('RUN_EXTRACTION|'))) {
            const separator = option.value.includes('@@') ? '@@' : '|';
            const [, modelId, modelName, sheetName] = option.value.split(separator);
            executeExtractionWithLogs({ modelId, modelName, sheetName });
            return;
        }

        if (option.value === 'START_FUSION_LOAD_ORCHESTRATION') {
            const metadata = messages.slice().reverse().find(m => m.metadata?.fusionEnvId)?.metadata;
            if (metadata) {
                executeFusionLoadOrchestration(metadata);
            } else {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    text: "Error: Could not retrieve environment metadata for the load operation.",
                    sender: 'assistant',
                    timestamp: new Date()
                }]);
            }
            return;
        }

        setInputValue(option.value);
        // Auto-send if it's a value-based option
        setTimeout(() => handleSendMessage(option.value), 10);
    };

    const handleClose = () => {
        if (onClose) {
            onClose();
        } else {
            setInternalIsOpen(false);
        }
    };
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            text: "How can I help you with the FBDI assistant?",
            sender: 'assistant',
            timestamp: new Date()
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [stagedFile, setStagedFile] = useState<File | null>(null);
    const [stagedStructure, setStagedStructure] = useState<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const linkify = (text: string) => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);
        return parts.map((part, i) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066b1] hover:underline font-semibold break-all"
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    const renderCustomContent = (text: string) => {
        if (text.includes('|')) {
            const lines = text.trim().split('\n');
            const tableLines = lines.filter(line => line.includes('|'));
            const textLines = lines.filter(line => !line.includes('|'));

            let tableElement = null;
            if (tableLines.length >= 2) {
                let headers = tableLines[0].split('|').filter(h => h.trim() !== '').map(h => h.trim());
                let rows = tableLines.slice(2).map(line =>
                    line.split('|').filter(c => c.trim() !== '').map(c => c.trim())
                );

                // Filter out ID columns for clean UI
                const idIndices = headers.reduce((acc: number[], h, i) => {
                    if (h.toUpperCase().includes('ID') && headers.length > 1) acc.push(i);
                    return acc;
                }, []);

                if (idIndices.length > 0) {
                    headers = headers.filter((_, i) => !idIndices.includes(i));
                    rows = rows.map(row => row.filter((_, i) => !idIndices.includes(i)));
                }

                tableElement = (
                    <div className="my-3 overflow-x-auto border border-slate-200 rounded animate-in fade-in duration-500">
                        <table className="min-w-full text-[11px] text-left border-collapse">
                            <thead className="bg-[#f2f2f2] border-b border-slate-200">
                                <tr>
                                    {headers.map((h, i) => (
                                        <th key={i} className="px-3 py-2 font-bold text-slate-700">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => (
                                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f9f9f9]"}>
                                        {row.map((cell, j) => {
                                            // Detect Action Command Pattern: [Label](COMMAND|...) or [Label](URL)
                                            const actionMatch = cell.match(/\[(.*?)\]\((.*?)\)/);
                                            if (actionMatch) {
                                                const [, label, value] = actionMatch;
                                                
                                                // If it's a URL, render as a HYPERLINK
                                                if (value.startsWith('http')) {
                                                    return (
                                                        <td key={j} className="px-3 py-2 border-t border-slate-200">
                                                            <a
                                                                href={value}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-[#0066b1] hover:underline transition-all"
                                                            >
                                                                {label}
                                                            </a>
                                                        </td>
                                                    );
                                                }

                                                // If it's a command, render as a BUTTON
                                                return (
                                                    <td key={j} className="px-3 py-2 border-t border-slate-200">
                                                        <button
                                                            onClick={() => handleOptionClick({ label, value })}
                                                            className="bg-[#0066b1] hover:bg-[#004a80] text-white px-3 py-1 rounded text-[10px] font-bold shadow-sm transition-all"
                                                        >
                                                            {label}
                                                        </button>
                                                    </td>
                                                );
                                            }
                                            return <td key={j} className="px-3 py-2 border-t border-slate-200 text-slate-600 font-medium">{cell}</td>;
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }

            return (
                <div>
                    {textLines.map((line, i) => (
                        <div key={i} className="mb-1">{linkify(line)}</div>
                    ))}
                    {tableElement}
                </div>
            );
        }
        return <div>{linkify(text)}</div>;
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const quickActions = [
        { label: "Importing the template", query: "I need help with importing the template" },
        { label: "View the model details", query: "I want to view the model details" },
        { label: "Load to fusion", query: "How do I load data to Fusion?" }
    ];

    const handleClearChat = () => {
        if (confirm("Are you sure you want to clear the chat history?")) {
            setMessages([
                {
                    id: 'welcome',
                    text: "How can I help you with the FBDI assistant?",
                    sender: 'assistant',
                    timestamp: new Date()
                }
            ]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const triggerFileUpload = () => {
        fileInputRef.current?.click();
    };

    const executeImportWithLogs = async (metadata: any) => {
        const logId = `runtime-log-${Date.now()}`;
        const modelName = metadata.modelName;
        const templateName = metadata.templateName;

        let logLines: string[] = [
            `[IMPORT INITIATED]`,
            `● Process Target: ${modelName}`,
            `● Template Source: ${templateName}`,
            ""
        ];

        setMessages(prev => [...prev, {
            id: logId,
            text: logLines.join('\n'),
            sender: 'assistant',
            timestamp: new Date()
        }]);

        const updateLog = async (msg: string, isMajor = false) => {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const line = `[${timestamp}] ${isMajor ? '🚀 ' : '  ○ '}${msg}`;
            logLines.push(line);

            setMessages(prev => prev.map(m => m.id === logId ? { ...m, text: logLines.join('\n') } : m));
            await new Promise(r => setTimeout(r, 600));
        };

        try {
            await updateLog(`All checkpoints passed. Initiating FBDI Import...`, true);

            if (onFbdiSubmit && stagedFile) {
                const result = await onFbdiSubmit(stagedFile, modelName, {
                    silent: true,
                    onProgress: (msg: string, isMajor: boolean) => updateLog(msg, isMajor)
                });

                if (result && result.success) {
                    await updateLog(`Success: Model '${modelName}' is now Imported.`, true);
                    await updateLog(`Click on the link below to explore the Imported model:`);
                    await updateLog(`For more details please visit this URL: http://localhost:3000/fbdi/models/grp_db_${result.modelId}`);

                    // Signal assistant to offer extractions
                    setTimeout(() => {
                        handleSendMessage(`[System: Import completed: ${modelName}, id: ${result.modelId}]`);
                    }, 1000);
                } else {
                    throw new Error(result?.message || "FBDI Engine failed to persist model.");
                }
            } else {
                throw new Error(onFbdiSubmit ? "Template file reference lost. Please re-upload." : "FBDI Engine (onFbdiSubmit) not available in this context.");
            }

        } catch (err) {
            console.error("Assistant Import Error:", err);
            await updateLog(`[ABORTED] ${err instanceof Error ? err.message : 'Unknown failure'}`);
        } finally {
            setStagedFile(null);
        }
    };

    const executeFusionLoadOrchestration = async (metadata: any) => {
        const logId = `fusion-log-${Date.now()}`;
        const envId = metadata.fusionEnvId;
        const serverFilename = metadata.serverFilename;
        const originalFileName = metadata.stagedFileName;
        const config = fusionConfigs.find(f => f.id === envId);

        if (!config) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: `Error: Configuration for environment ID ${envId} not found.`,
                sender: 'assistant',
                timestamp: new Date()
            }]);
            return;
        }

        let logLines: string[] = [
            `[FUSION LOAD INITIATED]`,
            `● Target: ${config.name}`,
            `● File: ${originalFileName}`,
            ""
        ];

        setMessages(prev => [...prev, {
            id: logId,
            text: logLines.join('\n'),
            sender: 'assistant',
            timestamp: new Date()
        }]);

        const updateLog = async (msg: string, isMajor = false, type: 'info' | 'success' | 'error' = 'info') => {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const icon = type === 'success' ? '✅ ' : (type === 'error' ? '❌ ' : (isMajor ? '🚀 ' : '  ○ '));
            const line = `[${timestamp}] ${icon}${msg}`;
            logLines.push(line);

            setMessages(prev => prev.map(m => m.id === logId ? { ...m, text: logLines.join('\n') } : m));
            await new Promise(r => setTimeout(r, 400));
        };

        const pollJobStatus = async (jobId: string): Promise<string> => {
            while (true) {
                try {
                    const res = await fetch(`http://localhost:3006/api/fusion/job-status/${jobId}?url=${encodeURIComponent(config.url)}&username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`);
                    const data = await res.json();
                    const status = data.status || 'UNKNOWN';

                    if (['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'ERROR', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
                        return status;
                    }
                    await updateLog(`Polling status for ${jobId}: ${status}...`);
                } catch (e) {
                    console.error("Polling error", e);
                }
                await new Promise(r => setTimeout(r, 5000));
            }
        };

        try {
            // STAGE 1: UCM Upload
            await updateLog(`[STAGE 1] Uploading to UCM...`, true);
            const ucmRes = await fetch('http://localhost:3006/api/fusion/upload-to-ucm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, fileName: serverFilename })
            });
            const ucmResult = await ucmRes.json();
            if (!ucmResult.success) throw new Error(`UCM Upload failed: ${ucmResult.message}`);

            const docId = ucmResult.documentId;
            const resolvedJobName = ucmResult.jobName;
            await updateLog(`Uploaded to UCM. DocID: ${docId}`, false, 'success');

            // STAGE 2: Get Metadata
            await updateLog(`[STAGE 2] Fetching Job Metadata...`, true);
            const metaRes = await fetch(`http://localhost:3006/api/fusion/get-ess-metadata?jobName=${resolvedJobName}`);
            const metaResult = await metaRes.json();
            if (!metaResult.success) throw new Error(`Metadata fetch failed: ${metaResult.message}`);
            const meta = metaResult.metadata;
            await updateLog(`Metadata retrieved.`, false, 'success');

            // STAGE 3: Interface Load
            await updateLog(`[STAGE 3] Submitting Interface Load...`, true);
            const intPayload = {
                OperationName: meta.INTERFACE_OPERATION_NAME || "submitESSJobRequest",
                JobPackageName: meta.INTERFACE_JOB_PACKAGE_NAME,
                JobDefName: meta.INTERFACE_JOBDEFNAME,
                ESSParameters: (meta.INTERFACE_ESS_PARAMETERS || "").replace("DDI", docId)
            };
            const intRes = await fetch('http://localhost:3006/api/fusion/submit-ess-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, payload: intPayload })
            });
            const intResult = await intRes.json();
            if (!intResult.success) throw new Error(`Interface Load submission failed: ${intResult.message}`);
            const intJobId = intResult.result?.ReqstId || intResult.result?.result || intResult.result?.Result || intResult.result?.JobId || intResult.result?.jobId;
            await updateLog(`Interface Load Job Submitted (ID: ${intJobId})`, false, 'success');

            const intStatus = await pollJobStatus(intJobId);
            if (intStatus !== 'SUCCEEDED') throw new Error(`Interface Job ended with ${intStatus}`);
            await updateLog(`Interface Load Completed.`, false, 'success');

            // STAGE 4: Parameter Extraction
            await updateLog(`[STAGE 4] Identifying Base Table Batches...`, true);
            const paramRes = await fetch(`http://localhost:3006/api/fusion/get-parameter-rows?fileName=${serverFilename}`);
            const paramResult = await paramRes.json();
            if (!paramResult.success) throw new Error(`Parameter extraction failed: ${paramResult.message}`);
            const rows = paramResult.rows;
            await updateLog(`Found ${rows.length} batches.`, false, 'success');

            // STAGE 5: Base Table Load
            await updateLog(`[STAGE 5] Loading Base Tables...`, true);
            for (let i = 0; i < rows.length; i++) {
                const batchNum = i + 1;
                const line = rows[i];
                await updateLog(`Batch ${batchNum}/${rows.length} starting...`);
                const basePayload = {
                    OperationName: meta.SUBMIT_ESS_OPERATION_NAME || "submitESSJobRequest",
                    DocumentId: docId,
                    JobPackageName: meta.SUBMIT_ESS_JOB_PACKAGE_NAME,
                    JobDefName: meta.SUBMIT_ESS_JOBDEFNAME,
                    ESSParameters: line.split(',').slice(3).join(',')
                };
                const baseRes = await fetch('http://localhost:3006/api/fusion/submit-ess-job', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...config, payload: basePayload })
                });
                const baseResult = await baseRes.json();
                if (!baseResult.success) throw new Error(`Batch ${batchNum} submission failed: ${baseResult.message}`);
                const bJobId = baseResult.result?.ReqstId || baseResult.result?.result || baseResult.result?.Result || baseResult.result?.JobId || baseResult.result?.jobId;
                const bStatus = await pollJobStatus(bJobId);
                if (bStatus !== 'SUCCEEDED') throw new Error(`Batch ${batchNum} failed with ${bStatus}`);
                await updateLog(`Batch ${batchNum} completed.`, false, 'success');
            }

            await updateLog(`[COMPLETE] Fusion Load Sequence Finished Successfully!`, true, 'success');

        } catch (err: any) {
            console.error("Fusion Load Orchestration Error:", err);
            await updateLog(`[FAILED] ${err.message}`, false, 'error');
        }
    };

    const executeExtractionWithLogs = async (metadata: any) => {
        const logId = `extraction-log-${Date.now()}`;
        const { modelId, modelName, sheetName } = metadata;

        let logLines = [
            `[EXTRACTION INITIATED]`,
            `● Target Model: ${modelName}`,
            `● Target Sheet: ${sheetName}`,
            ""
        ];

        setMessages(prev => [...prev, {
            id: logId,
            text: logLines.join('\n'),
            sender: 'assistant',
            timestamp: new Date()
        }]);

        const updateLog = async (msg: string, isMajor = false) => {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const line = `[${timestamp}] ${isMajor ? '🚀 ' : '  ○ '}${msg}`;
            logLines.push(line);
            setMessages(prev => prev.map(m => m.id === logId ? { ...m, text: logLines.join('\n') } : m));
            await new Promise(r => setTimeout(r, 400));
        };

        try {
            if (!onRunExtraction) throw new Error("Extraction handler not found.");

            // Wait for spec to be fetched from backend
            await updateLog(`Fetching extraction details...`, true);
            const modelRes = await fetch(`http://localhost:3006/api/fbdi/saved-model/${modelId}`);
            const modelData = await modelRes.json();
            const spec = modelData.specifications.find((s: any) => s.sheetName === sheetName || s.name === sheetName);

            if (!spec) throw new Error(`Could not find extraction specification for sheet: ${sheetName}`);

            await onRunExtraction(spec, 'FBDI-ZIP', {
                silent: true,
                onProgress: (msg) => updateLog(msg),
                onComplete: (filename) => {
                    updateLog(`Success: File downloaded as ${filename}`, true);
                    setTimeout(() => {
                        handleSendMessage(`[System: Extraction completed: ${filename}]`);
                    }, 1000);
                }
            });

        } catch (err: any) {
            console.error("Extraction Error:", err);
            await updateLog(`[FAILED] ${err.message}`);
        }
    };

    const executeBatchExtractionWithLogs = async (metadata: any) => {
        const logId = `batch-log-${Date.now()}`;
        const { modelId, modelName } = metadata;

        let logLines = [
            `[BATCH EXTRACTION INITIATED]`,
            `● Target Model: ${modelName}`,
            `● Scope: ALL SHEETS`,
            ""
        ];

        setMessages(prev => [...prev, {
            id: logId,
            text: logLines.join('\n'),
            sender: 'assistant',
            timestamp: new Date()
        }]);

        const updateLog = async (msg: string, isMajor = false) => {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const line = `[${timestamp}] ${isMajor ? '🚀 ' : '  ○ '}${msg}`;
            logLines.push(line);
            setMessages(prev => prev.map(m => m.id === logId ? { ...m, text: logLines.join('\n') } : m));
            await new Promise(r => setTimeout(r, 400));
        };

        try {
            if (!onRunBatchExtraction) throw new Error("Batch extraction handler not found.");

            await onRunBatchExtraction('FBDI-ZIP', {
                silent: true,
                onProgress: (msg) => updateLog(msg),
                onComplete: (filename) => {
                    updateLog(`Success: Consolidated ZIP downloaded as ${filename}`, true);
                    setTimeout(() => {
                        handleSendMessage(`[System: Extraction completed: ${filename}]`);
                    }, 1000);
                }
            });

        } catch (err: any) {
            console.error("Batch Extraction Error:", err);
            await updateLog(`[FAILED] ${err.message}`);
        }
    };

    const handleSendMessage = async (textOverride?: string) => {
        const messageText = textOverride || inputValue;
        if (!messageText.trim() && !selectedFile || isLoading) return;

        // Delegate initiation to backend for consistent state management

        const userMessage: Message = {
            id: Date.now().toString(),
            text: messageText + (selectedFile ? `\n\n[Uploaded File: ${selectedFile.name}]` : ''),
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('message', messageText);
            formData.append('history', JSON.stringify(messages));
            formData.append('fusionConfigs', JSON.stringify(fusionConfigs));
            if (selectedFile) {
                formData.append('file', selectedFile);
                setStagedFile(selectedFile); // Preserve for the final import step
            }

            const response = await fetch('http://localhost:3006/api/assistant/chat', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';

            // Cache structure if provided in metadata (e.g., during analysis response)
            if (data.metadata?.structure) {
                setStagedStructure(data.metadata.structure);
            }

            // Handle Immediate Actions
            if (data.action_required) {
                if (data.action_type === 'NAVIGATE' && data.metadata?.url) {
                    window.location.href = '#' + data.metadata.url;
                }

                if (data.action_type === 'EXECUTE_FBDI_IMPORT') {
                    console.log("[Assistant] Starting FBDI Import Execution...");
                    // Merge staged structure if the action metadata doesn't have it
                    const importMetadata = {
                        ...data.metadata,
                        structure: data.metadata?.structure || stagedStructure
                    };
                    executeImportWithLogs(importMetadata);
                }

                if (data.action_type === 'EXECUTE_EXTRACTION') {
                    executeExtractionWithLogs(data.metadata);
                }

                if (data.action_type === 'EXECUTE_BATCH_EXTRACTION') {
                    executeBatchExtractionWithLogs(data.metadata);
                }
            }

            if (data.reply) {
                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    text: data.reply,
                    sender: 'assistant',
                    timestamp: new Date(),
                    sources: data.sources,
                    action: data.action_required ? {
                        type: data.action_type,
                        metadata: data.metadata
                    } : undefined,
                    options: data.options,
                    metadata: data.metadata
                };

                if (data.options) {
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        text: data.reply,
                        sender: 'assistant',
                        timestamp: new Date(),
                        options: data.options,
                        metadata: data.metadata
                    }]);
                } else {
                    setMessages(prev => [...prev, assistantMessage]);
                }
            }
        } catch (error) {
            console.error('FBDI Assistant Connection Error:', error);
            setMessages(prev => [...prev, {
                id: 'error',
                text: `I'm having trouble connecting to my brain. Please ensure the Node.js backend is running.`,
                sender: 'assistant',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={isFullPage
            ? "fixed left-[276px] top-[90px] right-5 bottom-5 bg-white z-[9999] flex flex-col rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-500"
            : "fixed bottom-2 right-4 z-[9999] flex flex-col items-end"}>

            {/* State: Open & Maximized */}
            {internalIsOpen && !isMinimized && (
                <div className={isFullPage
                    ? "w-full h-full flex flex-col overflow-hidden"
                    : "mb-4 w-[420px] h-[calc(100vh-120px)] max-h-[550px] bg-white rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-slate-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-300"}>

                    {/* Header - FUSION STYLE (Light Toned) */}
                    <div className="bg-[#f3f4f6] p-4 flex items-center justify-between border-b border-slate-200">
                        <div className="flex items-center gap-3">
                            <div className="bg-white p-1.5 rounded border border-slate-200 shadow-sm">
                                <InternalIcons.Brain className="w-5 h-5 text-[#0066b1]" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-700 tracking-tight uppercase">FBDI Assistant</h3>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                                    {/* <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">OCI Cohere Active</span> */}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleClearChat}
                                className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-rose-500 transition-colors bg-white px-2 py-1 rounded border border-slate-200"
                                title="Clear History"
                            >
                                <InternalIcons.Plus className="w-3 h-3 rotate-45" />
                                CLEAR
                            </button>
                            <div className="h-4 w-[1px] bg-slate-200 mx-1"></div>
                            <button
                                onClick={onToggleMode}
                                className="text-slate-400 hover:text-[#1e709a] transition-all p-1.5 hover:bg-slate-200 rounded"
                                title={isFullPage ? "Exit Full Screen" : "Expand to Full Page"}
                            >
                                {isFullPage ? <InternalIcons.Minimize className="w-5 h-5" /> : <InternalIcons.Maximize className="w-5 h-5" />}
                            </button>
                            <div className="h-4 w-[1px] bg-slate-200 mx-1"></div>
                            {!isFullPage && (
                                <button
                                    onClick={() => setIsMinimized(true)}
                                    className="text-slate-400 hover:text-slate-600 transition-all p-1.5 hover:bg-slate-200 rounded"
                                    title="Minimize"
                                >
                                    <InternalIcons.Minus className="w-5 h-5" />
                                </button>
                            )}
                            <button
                                onClick={handleClose}
                                className="text-slate-400 hover:text-rose-500 transition-all p-1.5 hover:bg-slate-200 rounded"
                                title="Close"
                            >
                                <InternalIcons.X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-6 bg-slate-50/50">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-400`}
                            >
                                <div className={`max-w-[88%] rounded-lg p-3 text-sm shadow-sm border ${msg.sender === 'user'
                                    ? 'bg-[#004a80] text-white border-[#003366]'
                                    : 'bg-[#f0f8ff] text-slate-800 border-slate-300'
                                    }`}>
                                    <div className="prose prose-sm max-w-none">
                                        <div className="whitespace-pre-wrap leading-relaxed opacity-95 text-inherit">
                                            {msg.text.includes('|') ? renderCustomContent(msg.text) : linkify(msg.text)}
                                        </div>
                                    </div>

                                    {/* Action Buttons & Options */}
                                    {msg.options && msg.options.length > 0 && (
                                        <div className="mt-4 flex flex-wrap gap-2 animate-in zoom-in-95 duration-300">
                                            {msg.options.map((option, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleOptionClick(option)}
                                                    className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
                                                >
                                                    <span>{option.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="mt-4 pt-3 border-t border-slate-100/60 flex flex-wrap gap-2">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest w-full mb-1">Authenticated Sources</span>
                                            {msg.sources.map((s, i) => (
                                                <div key={i} className="text-[10px] bg-slate-100 text-[#1e709a] px-2.5 py-1 rounded-full border border-slate-200 font-bold flex items-center gap-1">
                                                    <InternalIcons.Link className="w-2.5 h-2.5" />
                                                    {s.template}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className={`text-[10px] mt-2 opacity-40 font-medium ${msg.sender === 'user' ? 'text-white' : 'text-slate-500'}`}>
                                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Quick Actions at the very start */}
                        {messages.length === 1 && !isLoading && (
                            <div className="flex flex-wrap gap-2 mt-4 animate-in fade-in slide-in-from-top-4 duration-500">
                                {quickActions.map((action, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSendMessage(action.query)}
                                        className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-sm transition-all"
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-[#f0f8ff] border border-slate-300 rounded-lg p-3 shadow-sm flex items-center gap-3">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 bg-[#0066b1] rounded-full animate-bounce [animation-duration:0.6s]"></div>
                                        <div className="w-1.5 h-1.5 bg-[#0066b1] rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.1s]"></div>
                                        <div className="w-1.5 h-1.5 bg-[#0066b1] rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.2s]"></div>
                                    </div>
                                    <span className="text-[10px] font-bold text-[#0066b1] tracking-tight uppercase">Processing...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-5 bg-white border-t border-slate-100 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
                        {selectedFile && (
                            <div className="mb-3 flex items-center justify-between bg-slate-100 p-2 px-3 rounded-xl border border-slate-200 animate-in slide-in-from-bottom-2">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <InternalIcons.File className="w-4 h-4 text-[#1e709a] shrink-0" />
                                    <span className="text-xs font-semibold text-slate-600 truncate">{selectedFile.name}</span>
                                </div>
                                <button
                                    onClick={() => setSelectedFile(null)}
                                    className="p-1 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    <InternalIcons.X className="w-3.5 h-3.5 text-slate-400" />
                                </button>
                            </div>
                        )}
                        <div className="relative flex items-center gap-3">
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <button
                                onClick={() => {
                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                    triggerFileUpload();
                                }}
                                className="p-3 bg-white text-slate-600 rounded border border-slate-300 hover:bg-slate-50 transition-all active:bg-slate-100 shadow-sm"
                                title="Upload Context File"
                            >
                                <InternalIcons.Upload className="w-5 h-5" />
                            </button>
                            <div className="flex-1 relative">
                                <input
                                    type="text"
                                    placeholder="Enter natural language query..."
                                    className="w-full bg-white border border-slate-300 rounded px-4 py-3 text-sm outline-none focus:border-[#0066b1] transition-all text-slate-700 placeholder:text-slate-400"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                />
                                {inputValue && (
                                    <button
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600"
                                        onClick={() => setInputValue('')}
                                    >
                                        <InternalIcons.X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => handleSendMessage()}
                                disabled={(!inputValue.trim() && !selectedFile) || isLoading}
                                className="px-6 py-3 bg-[#0066b1] text-white rounded font-bold text-xs hover:bg-[#004a80] transition-all disabled:opacity-50 active:translate-y-px shadow-sm uppercase tracking-wider"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* State: Open & Minimized (Dark Bar) */}
            {internalIsOpen && isMinimized && (
                <div className="fixed bottom-6 right-6 z-[10000] flex items-center gap-4 bg-[#1a1a1a] text-white p-3 px-5 rounded-xl shadow-2xl border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="bg-white/10 p-1.5 rounded border border-white/10 shadow-sm">
                        <InternalIcons.Brain className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold tracking-tight pr-5 border-r border-white/10 whitespace-nowrap">FBDI Assistant</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsMinimized(false)}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors text-slate-400 hover:text-white"
                            title="Maximize"
                        >
                            <InternalIcons.Maximize className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleClose}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors text-slate-400 hover:text-rose-400"
                            title="Close"
                        >
                            <InternalIcons.X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* State: Closed (Bottom Toggle Button - Hidden as we use Sidebar) */}
            {!internalIsOpen && !isFullPage && (
                null
            )}
        </div>
    );
};

export default FBDIAssistant;
