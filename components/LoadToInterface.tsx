import React, { useState, useRef, useEffect } from 'react';
import { Icons } from '../constants';
import { fetchFusionConfigs } from '../services/fusionService';
import { FusionConfig } from '../types';

const LoadToInterface: React.FC = () => {
    const [environments, setEnvironments] = useState<FusionConfig[]>([]);
    const [selectedEnvId, setSelectedEnvId] = useState<string>('');
    const [isLoadingEnvs, setIsLoadingEnvs] = useState(true);

    const [config, setConfig] = useState({
        url: '',
        username: '',
        password: ''
    });
    const [logs, setLogs] = useState<{ type: 'info' | 'error' | 'success', message: string, time: string }[]>([
        { type: 'info', message: 'System initialized. Ready for Oracle Fusion data load.', time: new Date().toLocaleTimeString() }
    ]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [serverFilename, setServerFilename] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const logBoxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        loadEnvironments();
    }, []);

    const loadEnvironments = async () => {
        setIsLoadingEnvs(true);
        try {
            const data = await fetchFusionConfigs();
            setEnvironments(data);
        } catch (err) {
            console.error("Failed to load environments:", err);
        } finally {
            setIsLoadingEnvs(false);
        }
    };

    const handleEnvChange = (envId: string) => {
        setSelectedEnvId(envId);
        const env = environments.find(e => String(e.id) === envId);
        if (env) {
            setConfig({
                url: env.url,
                username: env.username,
                password: env.password || ''
            });
            addLog(`[System] Switched to environment: ${env.name}`, 'info');
        } else {
            setConfig({ url: '', username: '', password: '' });
        }
    };

    const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
        setLogs(prev => [...prev, { type, message, time: new Date().toLocaleTimeString() }]);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            addLog(`[Upload] Preparing ${file.name}...`, 'info');

            const formData = new FormData();
            formData.append('file', file);

            setIsUploading(true);
            setUploadProgress(0);

            try {
                const response = await fetch('http://localhost:3006/api/fbdi/upload', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const result = await response.json();
                    setServerFilename(result.filename);
                    setUploadProgress(100);
                    addLog(`[Upload] Success: ${file.name} staged as ${result.filename}`, 'success');
                } else {
                    addLog(`[Upload] Failed: ${response.statusText}`, 'error');
                }
            } catch (error: any) {
                addLog(`[Upload] Error: ${error.message}`, 'error');
            } finally {
                setIsUploading(false);
            }
        }
    };

    const pollJobStatus = (jobId: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            setActiveJobId(jobId);
            const interval = setInterval(async () => {
                try {
                    const query = new URLSearchParams({
                        url: config.url,
                        username: config.username,
                        password: config.password
                    }).toString();

                    const response = await fetch(`http://localhost:3006/api/fusion/job-status/${jobId}?${query}`);
                    const result = await response.json();

                    if (result.success) {
                        const status = (result.status || 'UNKNOWN').toUpperCase();
                        addLog(`[Fusion Status] Job ${jobId} is currently: ${status}`, status === 'SUCCEEDED' ? 'success' : 'info');

                        if (['SUCCEEDED', 'ERROR', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
                            clearInterval(interval);
                            setActiveJobId(null);
                            resolve(status);
                        }
                    } else {
                        clearInterval(interval);
                        setActiveJobId(null);
                        reject(new Error(result.message || 'API status check failed.'));
                    }
                } catch (error: any) {
                    clearInterval(interval);
                    setActiveJobId(null);
                    reject(error);
                }
            }, 5000);
        });
    };

    const handleUCMUpload = async () => {
        if (!selectedFile || !serverFilename) {
            addLog('Error: No file staged on server for UCM upload.', 'error');
            return;
        }
        if (!config.url || !config.username || !config.password) {
            addLog('Error: Environment configuration is incomplete.', 'error');
            return;
        }

        // Clear logs for a fresh start
        setLogs([{ type: 'info', message: 'Initiating Unified Sequential Automation...', time: new Date().toLocaleTimeString() }]);

        try {
            // STAGE 1: UCM Upload
            addLog(`[STAGE 1] Uploading to UCM: ${selectedFile.name}...`, 'info');
            addLog(`[AUTH] Authenticating as ${config.username}...`, 'info');

            const ucmRes = await fetch('http://localhost:3006/api/fusion/upload-to-ucm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, fileName: serverFilename })
            });

            const ucmResult = await ucmRes.json();
            if (!ucmResult.success) {
                addLog(`[ERROR] Stage 1 (UCM) failed: ${ucmResult.message}`, 'error');
                return;
            }

            const docId = ucmResult.documentId;
            const resolvedJobName = ucmResult.jobName;
            addLog(`[SUCCESS] File uploaded to UCM. Document ID: ${docId}`, 'success');
            if (resolvedJobName) addLog(`[RESOLVE] Resolved Job Source: ${resolvedJobName}`, 'info');

            // STAGE 2: Get Metadata
            addLog(`[STAGE 2] Fetching Job Metadata for: ${resolvedJobName}...`, 'info');
            const metaQuery = new URLSearchParams({ jobName: resolvedJobName }).toString();
            const metaRes = await fetch(`http://localhost:3006/api/fusion/get-ess-metadata?${metaQuery}`);
            const metaResult = await metaRes.json();

            if (!metaResult.success) {
                addLog(`[ERROR] Stage 2 (Metadata) failed: ${metaResult.message}`, 'error');
                return;
            }
            const meta = metaResult.metadata;
            addLog(`[SUCCESS] Metadata retrieved successfully.`, 'success');

            // STAGE 3: Interface Load
            addLog(`[STAGE 3] Submitting Interface Load Job: ${meta.INTERFACE_JOBDEFNAME}...`, 'info');
            const intPayload = {
                OperationName: meta.INTERFACE_OPERATION_NAME || "submitESSJobRequest",
                JobPackageName: meta.INTERFACE_JOB_PACKAGE_NAME,
                JobDefName: meta.INTERFACE_JOBDEFNAME,
                ESSParameters: (meta.INTERFACE_ESS_PARAMETERS || "").replace("DDI", docId)
            };
            addLog(`[ESS_REQUEST_BODY] ${JSON.stringify(intPayload, null, 2)}`, 'info');

            const intRes = await fetch('http://localhost:3006/api/fusion/submit-ess-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, payload: intPayload })
            });
            const intResult = await intRes.json();

            if (!intResult.success) {
                addLog(`[ERROR] Stage 3 (Interface Load) submission failed: ${intResult.message}`, 'error');
                return;
            }

            const intJobId = intResult.result?.ReqstId || intResult.result?.result || intResult.result?.Result || intResult.result?.JobId || intResult.result?.jobId;
            addLog(`[ESS_JOB_ID] ${intJobId}`, 'success');
            addLog(`[STATUS] Monitoring Interface Load (5s intervals)...`, 'info');

            const intStatus = await pollJobStatus(intJobId);
            if (intStatus !== 'SUCCEEDED') {
                addLog(`[FAIL-FAST] Interface Job ended with ${intStatus}. Aborting sequence.`, 'error');
                return;
            }
            addLog(`[SUCCESS] Data moved to interface tables.`, 'success');

            // STAGE 4: Parameter Extraction
            addLog(`[STAGE 4] Extracting parameters from properties file...`, 'info');
            const paramQuery = new URLSearchParams({ fileName: serverFilename }).toString();
            const paramRes = await fetch(`http://localhost:3006/api/fusion/get-parameter-rows?${paramQuery}`);
            const paramResult = await paramRes.json();

            if (!paramResult.success) {
                addLog(`[ERROR] Stage 4 (Parameters) failed: ${paramResult.message}`, 'error');
                return;
            }
            const rows = paramResult.rows;
            addLog(`[SUCCESS] Found ${rows.length} parameter batches to process.`, 'success');

            // STAGE 5: Base Table Load (Iterative)
            addLog(`[STAGE 5] Triggering ${rows.length} Base Table Imports...`, 'info');
            for (let i = 0; i < rows.length; i++) {
                const batchNum = i + 1;
                const line = rows[i];
                addLog(`[BATCH ${batchNum}/${rows.length}] Initiating Import for: ${line}`, 'info');

                const basePayload = {
                    OperationName: meta.SUBMIT_ESS_OPERATION_NAME || "submitESSJobRequest",
                    DocumentId: docId,
                    JobPackageName: meta.SUBMIT_ESS_JOB_PACKAGE_NAME,
                    JobDefName: meta.SUBMIT_ESS_JOBDEFNAME,
                    ESSParameters: line.split(',').slice(3).join(',')
                };
                addLog(`[BATCH ${batchNum}] Request Payload: ${JSON.stringify(basePayload)}`, 'info');

                const baseRes = await fetch('http://localhost:3006/api/fusion/submit-ess-job', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...config, payload: basePayload })
                });
                const baseResult = await baseRes.json();

                if (!baseResult.success) {
                    addLog(`[ERROR] Batch ${batchNum} submission failed: ${baseResult.message}. Stopping sequence.`, 'error');
                    return;
                }

                const bJobId = baseResult.result?.ReqstId || baseResult.result?.result || baseResult.result?.Result || baseResult.result?.JobId || baseResult.result?.jobId;
                addLog(`[BASE_TABLE_JOB_ID] ${bJobId}`, 'success');
                addLog(`[STATUS] Monitoring Batch ${batchNum}...`, 'info');

                const bStatus = await pollJobStatus(bJobId);
                if (bStatus !== 'SUCCEEDED') {
                    addLog(`[FAIL-FAST] Batch ${batchNum} failed with ${bStatus}. Aborting remaining batches.`, 'error');
                    return;
                }
                addLog(`[BATCH ${batchNum}] Completed successfully.`, 'success');
            }

            addLog(`[COMPLETE] ALL AUTOMATION STAGES FINISHED SUCCESSFULLY.`, 'success');

        } catch (error: any) {
            addLog(`[EXCEPTION] ${error.message}`, 'error');
            console.error('Automation flow failed:', error);
        }
    };

    const handleLoad = async () => {
        if (!selectedFile) {
            addLog('Error: No file selected for loading.', 'error');
            return;
        }
        if (!config.url || !config.username || !config.password) {
            addLog('Error: Environment configuration is incomplete.', 'error');
            return;
        }

        addLog(`[FUSION] Initiating Load to Interface for ${selectedFile.name}...`, 'info');
        addLog(`[AUTH] Authenticating as ${config.username}...`, 'info');
        addLog(`Connecting to Oracle Fusion instance: ${config.url}`, 'info');

        try {
            const response = await fetch('http://localhost:3006/api/fusion/load-to-interface', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...config,
                    fileName: serverFilename || selectedFile.name,
                    jobName: "InterfaceLoaderController",
                    interfaceDetails: ""
                })
            });

            const result = await response.json();

            // Technical Logs
            if (result.jobName) addLog(`[RESOLVE] Job Name: ${result.jobName}`, 'info');
            if (result.fusionUrl) addLog(`[ENDPOINT] POST ${result.fusionUrl}`, 'info');
            if (result.payload) addLog(`[REQUEST_BODY] ${JSON.stringify(result.payload, null, 2)}`, 'info');

            if (result.success) {
                addLog(`[SUCCESS] ${result.message}`, 'success');
                addLog(`[JOB_ID] ${result.jobId}`, 'success');
                setActiveJobId(result.jobId);
                addLog(`[STATUS] Starting real-time monitoring...`, 'info');
                pollJobStatus(result.jobId).catch(err => {
                    addLog(`[POLLING_ERROR] ${err.message}`, 'error');
                });
            } else {
                addLog(`[ERROR] ${result.message}`, 'error');
                if (result.details) {
                    const detailStr = typeof result.details === 'object' ? JSON.stringify(result.details, null, 2) : result.details;
                    addLog(`[RESPONSE_BODY] ${detailStr}`, 'error');
                }
            }
        } catch (error: any) {
            addLog(`[NETWORK_ERROR] ${error.message}`, 'error');
        }
    };

    const handleTestConnection = async () => {
        if (!config.url || !config.username || !config.password) {
            addLog('Error: Environment configuration is incomplete for testing.', 'error');
            return;
        }

        setIsTesting(true);
        addLog(`[Fusion Auth] Testing connection for ${config.username}...`, 'info');

        try {
            const response = await fetch('http://localhost:3006/api/fusion/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();
            if (result.success) {
                addLog(`[Fusion Auth] Success: ${result.message}`, 'success');
            } else {
                addLog(`[Fusion Auth] Error: ${result.message}`, 'error');
            }
        } catch (error: any) {
            addLog(`[Fusion Auth] Request Failed: ${error.message}`, 'error');
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
            {/* Header Section */}
            <div className="flex items-center gap-3 px-2">
                <div className="w-10 h-10 rounded-xl bg-[#1e709a] flex items-center justify-center text-white shadow-lg border border-white/10">
                    <Icons.Globe className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-xl font-black text-slate-800">Load to Oracle Fusion</h2>
                    <p className="text-xs text-slate-500 font-bold opacity-70">ESS Job Interface & Data Staging</p>
                </div>
                {activeJobId && (
                    <div className="ml-auto flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl animate-in zoom-in duration-300">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Active Job: {activeJobId}</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
                {/* Environment Config - Left (40%) */}
                <div className="lg:col-span-4 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                        <Icons.Globe className="w-4 h-4 text-[#1e709a]" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Environment</span>
                    </div>
                    <div className="p-6 space-y-5 flex-1">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 tracking-widest">Select Target Environment</label>
                            <div className="relative">
                                <select
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pl-10 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#1e709a]/20 focus:border-[#1e709a]/40 outline-none transition-all appearance-none cursor-pointer"
                                    value={selectedEnvId}
                                    onChange={(e) => handleEnvChange(e.target.value)}
                                    disabled={isLoadingEnvs}
                                >
                                    <option value="" disabled>{isLoadingEnvs ? 'Loading environments...' : (environments.length === 0 ? 'No environments found' : 'Choose an environment...')}</option>
                                    {environments.map(env => (
                                        <option key={env.id} value={env.id}>{env.name}</option>
                                    ))}
                                    {environments.length === 0 && !isLoadingEnvs && (
                                        <option value="none" disabled>Please configure an environment first</option>
                                    )}
                                </select>
                                <div className="absolute left-3.5 top-3.5 text-[#1e709a]">
                                    <Icons.Database className="w-4 h-4" />
                                </div>
                                <div className="absolute right-4 top-4 text-slate-400 pointer-events-none">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {selectedEnvId && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="p-4 bg-[#e5f1f8]/40 border border-[#1e709a]/10 rounded-xl space-y-3">
                                    <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Endpoint</label>
                                        <div className="text-[11px] font-mono font-bold text-[#1e709a] truncate">{config.url}</div>
                                    </div>
                                    <div className="flex justify-between items-center pt-2 border-t border-[#1e709a]/5">
                                        <div>
                                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Connect As</label>
                                            <div className="text-xs font-black text-slate-700">{config.username}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Ready</span>
                                        </div>
                                    </div>
                                </div>
                                {/* <button
                                    onClick={handleTestConnection}
                                    disabled={isTesting}
                                    className="t-Button flex items-center gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
                                >

                                    <Icons.Activity className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                                    {isTesting ? 'Validating...' : 'Test Connection'}
                                </button> */}
                            </div>
                        )}

                        {!selectedEnvId && !isLoadingEnvs && (
                            <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed border-slate-100 rounded-2xl">
                                <Icons.Settings className="w-8 h-8 text-slate-200 mb-3" />
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center">
                                    {environments.length === 0
                                        ? "No fusion environments configured. Please go to Environment Config to get started."
                                        : "Select an environment from the dropdown above to begin the loading process."}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* File Upload - Right (60%) */}
                <div className="lg:col-span-6 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                        <Icons.Upload className="w-4 h-4 text-[#1e709a]" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data Staging & Upload</span>
                    </div>
                    <div className="p-6 flex-1 flex flex-col justify-center">
                        {!selectedFile ? (
                            <label className="border-2 border-dashed border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-[#1e709a]/40 hover:bg-[#e5f1f8]/20 transition-all group">
                                <input type="file" className="hidden" onChange={handleFileUpload} accept=".zip,.xlsm,.csv" />
                                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-[#1e709a] group-hover:text-white transition-all shadow-sm">
                                    <Icons.Upload className="w-8 h-8" />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-black text-slate-700">Click to upload FBDI Package</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Accepts .ZIP, .XLSM, or .CSV</p>
                                </div>
                            </label>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4 p-4 bg-[#e5f1f8]/40 border border-[#1e709a]/10 rounded-2xl">
                                    <div className="w-12 h-12 rounded-xl bg-[#1e709a] flex items-center justify-center text-white shadow-md">
                                        <Icons.File className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-black text-slate-800">{selectedFile.name}</p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{(selectedFile.size / 1024).toFixed(2)} KB • FBDI DATA PACKAGE</p>
                                    </div>
                                    <button onClick={() => setSelectedFile(null)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                                        <Icons.X className="w-5 h-5" />
                                    </button>
                                </div>

                                {isUploading && (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center px-1">
                                            <span className="text-[10px] font-black text-[#1e709a] uppercase tracking-widest">Transferring...</span>
                                            <span className="text-xs font-black text-[#1e709a]">{uploadProgress}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-[#1e709a] transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Action Buttons - Right Aligned */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={handleUCMUpload}
                    disabled={!selectedFile || !serverFilename || isUploading}
                    className="flex items-center gap-2 bg-white border border-slate-200 px-6 py-2.5 rounded text-sm hover:bg-slate-50 transition-all font-medium disabled:opacity-50"
                >
                    <Icons.Globe className="w-4 h-4" />
                    Upload to UCM
                </button>
                <button
                    onClick={handleLoad}
                    disabled={!selectedFile || !serverFilename || isUploading}
                    className="flex items-center gap-2 bg-white border border-slate-200 px-6 py-2.5 rounded text-sm hover:bg-slate-50 transition-all font-medium disabled:opacity-50"
                >
                    <Icons.Activity className="w-4 h-4" />
                    Load to Interface Table
                </button>
            </div>

            {/* Server Log Console - Bottom */}
            <div className="bg-[#1a1b1e] rounded-2xl shadow-2xl border border-white/5 overflow-hidden flex flex-col h-[400px]">
                <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Icons.Terminal className="w-4 h-4 text-emerald-400" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Load Execution Logs</span>
                    </div>
                    <button
                        onClick={() => setLogs([])}
                        className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-white transition-colors border border-white/10 px-3 py-1 rounded bg-white/5 hover:bg-white/10"
                    >
                        Clear
                    </button>
                    <div className="flex gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/50"></div>
                    </div>
                </div>
                <div ref={logBoxRef} className="p-6 overflow-y-auto flex-1 font-mono text-xs space-y-3 custom-scrollbar">
                    {logs.map((log, i) => (
                        <div key={i} className="flex gap-4 animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                            <span className={
                                log.type === 'error' ? 'text-red-400' :
                                    log.type === 'success' ? 'text-emerald-400' :
                                        'text-slate-300'
                            }>
                                <span className="font-bold mr-2">{log.type.toUpperCase()}:</span>
                                {log.message}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
                .bg-[#1a1b1e] .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
            `}} />
        </div>
    );
};

export default LoadToInterface;
