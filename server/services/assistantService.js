/* server/services/assistantService.js */
const common = require("oci-common");
const genai = require("oci-generativeaiinference");
const path = require('path');
const fs = require('fs');
const { analyzeFbdiWithOCI, searchVectorKnowledge } = require('./ociService');

const CONFIG_LOCATION = path.join(__dirname, '../oci_config');
const CONFIG_PROFILE = "DEFAULT";
const COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaalqcwboncf4xzqpfvtuygdriwomhjzrltllqnu63sflohbkirs5ia";
const ENDPOINT = "https://inference.generativeai.uk-london-1.oci.oraclecloud.com";
const MODEL_ID = "ocid1.generativeaimodel.oc1.uk-london-1.amaaaaaask7dceya6unpxszl2mdu5yhs7fos3mmyjp3xpw7kw2inpz2psdxq";

/**
 * Processes a chat message using OCI Cohere with Oracle Fusion/EBS expertise.
 * @param {string} message - User's input message.
 * @param {object} context - Additional context (models, fileInfo, etc.).
 */
async function processAssistantChatOCI(message, history = [], context = {}) {
    try {
        const { models = [], fileInfo = null, fusionConfigs = [] } = context;
        const result = {
            reply: "",
            action_required: false,
            action_type: null,
            metadata: {},
            options: []
        };

        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
        client.endpoint = ENDPOINT;

        const modelContext = models.length > 0
            ? "DATABASE ENVIRONMENT - Available Data Models:\n" + models.map(m =>
                `### Model: ${m.MODEL_NAME}\n- Tables Involved: ${m.TABLES || 'N/A'}\n- Extraction Specifications: ${m.EXTRACTIONS || 'N/A'}\n- Filters per Specification: ${m.EXT_FILTERS || 'None defined'}`
            ).join('\n\n')
            : "No data models currently available.";

        let fileContext = "";
        let isFBDIFile = false;

        // Convert history to OCI format
        const ociHistory = history.map(msg => ({
            role: msg.sender === 'user' ? 'USER' : 'CHATBOT',
            message: msg.text
        })).slice(-10); // Last 10 messages for context

        // --- STATE DETECTION & REFINED FLOW ---
        const cleanMsg = (message || "").toLowerCase();
        const lastAssistantMsg = history.length > 0 ? history[history.length - 1] : null;

        // INFERRED MODEL NAME DETECTION
        let inferredModelName = null;
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            // If the assistant asked for a name in the past
            if (h.sender === 'assistant' && h.text.includes('unique data model name')) {
                // If the user replied after that question
                if (history[i + 1] && history[i + 1].sender === 'user') {
                    inferredModelName = history[i + 1].text.trim();
                    break;
                }
            }
        }

        // --- NEW: SYSTEM MESSAGE DETECTION & FOLLOW-UP LOGIC ---
        const lastMsgText = lastAssistantMsg?.text || "";
        const isImportCompletion = message.includes('[System: Import completed:');
        const isExtractionCompletion = message.includes('[System: Extraction completed:');

        if (isImportCompletion) {
            const match = message.match(/\[System: Import completed: (.*? master table.*?)?,? ?id: (.*?)\]/i) || message.match(/\[System: Import completed: (.*?), id: (.*?)\]/);
            const name = match ? match[1] : 'the model';
            const id = match ? match[2] : null;

            return {
                reply: `### Success: Model **${name}** is now imported!\n\nThe template structure has been fully analyzed and mapped to your database schema in the master table (**XX_INTELLI_MODEL_EXTRACTIONS**).\n\nHow would you like to proceed with the data extractions?`,
                options: [
                    { label: "Individual Extraction (Select Sheet)", value: "individual extraction" },
                    { label: "Batch Extraction (All Sheets)", value: "batch extraction" },
                    { label: "View Architecture & Relationships", value: `View ${name} architecture` }
                ],
                metadata: { modelName: name, modelId: id }
            };
        }

        if (isExtractionCompletion) {
            const match = message.match(/\[System: Extraction completed: (.*?)\]/);
            const filename = match ? match[1] : 'The file';
            return {
                reply: `Great! The extraction process is complete. Your file **${filename}** is ready. \n\nWould you like to proceed with **loading this file to the Oracle Fusion** process?`,
                options: [
                    { label: "YES, Start Fusion Load", value: "Yes, lead to fusion" },
                    { label: "NO, Not now", value: "No, not now" }
                ]
            };
        }

        const isInitiatingExtractions = cleanMsg.includes('proceed with extractions');
        const isChoosingIndividual = cleanMsg.includes('individual extraction');
        const isChoosingBatch = cleanMsg.includes('batch extraction');

        if (isInitiatingExtractions) {
            // Preserve model context from history
            let activeModelId = null;
            let activeModelName = null;
            for (let i = history.length - 1; i >= 0; i--) {
                const metadata = history[i].metadata || history[i].action?.metadata;
                if (metadata?.modelId) {
                    activeModelId = metadata.modelId;
                    activeModelName = metadata.modelName;
                    break;
                }
            }

            return {
                reply: "Understood. Performing extractions will generate the files needed for Oracle Fusion. \n\nShould I perform a **Batch Extraction** (all sheets) or an **Individual Extraction** (select specific sheets)?",
                options: [
                    { label: "Individual Extraction", value: "individual extraction" },
                    { label: "Batch Extraction (All Sheets)", value: "batch extraction" }
                ],
                metadata: { modelId: activeModelId, modelName: activeModelName }
            };
        }

        // --- Model Context Resolution ---
        let activeModelId = null;
        let activeModelName = null;

        for (let i = history.length - 1; i >= 0; i--) {
            const metadata = history[i].metadata || history[i].action?.metadata;
            if (metadata?.modelId) {
                activeModelId = metadata.modelId;
                activeModelName = metadata.modelName;
                break;
            }
        }

        if (isChoosingBatch) {
            return {
                reply: `Initiating **Batch Extraction** for all sheets in model **${activeModelName || 'Imported Model'}**...`,
                action_required: true,
                action_type: 'EXECUTE_BATCH_EXTRACTION',
                metadata: { modelId: activeModelId, modelName: activeModelName }
            };
        }

        if (isChoosingIndividual) {
            const model = models.find(m => String(m.MODEL_ID) === String(activeModelId));
            let extractions = model?.EXTRACTION_DETAILS || [];

            // FALLBACK: If extraction specs aren't found in DB yet, use the architecture metadata (TABLES/EXTRACTIONS)
            if (extractions.length === 0) {
                const legacySheets = (model?.EXTRACTIONS || model?.TABLES || "").split(',').map(s => s.trim()).filter(s => s);
                extractions = legacySheets.map(s => ({
                    id: 'new',
                    name: s,
                    version: '1.0',
                    filters: '[]',
                    sheetName: s
                }));
            }

            if (extractions.length === 0) {
                return {
                    reply: `I couldn't identify any sheet components for model **${activeModelName}**. \n\nPlease ensure your FBDI template has been correctly analyzed. You can try to **Refresh** or **Manual Search** for the model components.`,
                    options: [
                        { label: "Search Models", value: "view models" },
                        { label: "View Architecture", value: `View ${activeModelName} architecture` }
                    ],
                    metadata: { modelId: activeModelId, modelName: activeModelName }
                };
            }

            const extractionTable = `| Name | Ver | Mappings | ZIP Extraction | URL |\n|:---|:---|:---|:---|:---|\n` +
                extractions.map(e => {
                    const runCmd = `RUN_EXTRACTION@@${activeModelId}@@${e.name}@@${e.sheetName || e.name}`;
                    const dlUrl = `http://localhost:3006/api/fbdi/extraction/download-spec/${activeModelId}/${e.id}`;
                    const viewUrl = `http://localhost:3000/fbdi/models/grp_db_${activeModelId}/extractions/spec_db_${e.id}`;

                    return `| ${e.name} | ${e.version || '1.0'} | [Download Specs](${dlUrl}) | [Run ZIP](${runCmd}) | ${viewUrl} |`;
                }).join('\n');

            return {
                reply: `### Individual Extractions: ${activeModelName}\n\n` +
                    `Found **${extractions.length}** components. You can run individual ZIP extractions or export specifications directly from the table:\n\n` +
                    extractionTable + `\n\n` +
                    `Use **Batch Extraction** to zip all components together for a full load.`,
                options: [
                    { label: "Run Batch (All)", value: "batch extraction" },
                    { label: "Back to Model List", value: "view models" }
                ],
                metadata: { modelId: activeModelId, modelName: activeModelName }
            };
        }

        const individualSheetMatch = message.match(/Extract sheet: (.*)/i);
        if (individualSheetMatch) {
            const sheetName = individualSheetMatch[1].trim();

            return {
                reply: `Initiating **Individual Extraction** for sheet **${sheetName}**...`,
                action_required: true,
                action_type: 'EXECUTE_EXTRACTION',
                metadata: { modelId: activeModelId, modelName: activeModelName, sheetName: sheetName }
            };
        }


        // 1. Initial Import Request Detection
        const isImportInitiation = (cleanMsg.includes('import') && (cleanMsg.includes('template') || cleanMsg.includes('fbdi'))) ||
            cleanMsg.includes('help me upload') ||
            cleanMsg.includes('start import') ||
            cleanMsg.includes('new import') ||
            cleanMsg.includes('.xlsm') ||
            cleanMsg.includes('.xlsx');

        // 2. Naming Prompt State Detection (Last message was the initiation or name prompt)
        const isWaitingForName = lastAssistantMsg?.text.includes('unique data model name');

        // 3. File Upload Prompt State Detection (Last message was confirming the name)
        const isWaitingForUpload = lastAssistantMsg?.text.includes('upload your FBDI template file');

        if (isImportInitiation && !inferredModelName && !fileInfo) {
            return {
                reply: "Welcome to the FBDI Import Wizard. To begin, please provide a **unique data model name** for this template configuration.",
                action_required: false
            };
        }

        if (isWaitingForName && !fileInfo) {
            const modelName = message.trim();
            return {
                reply: `Great! I've set the model name as '**${modelName}**'. \n\nNow, please upload your FBDI template file (.xlsx or .xlsm) using the **upload icon** in the input bar below.`,
                action_required: false
            };
        }

        if (fileInfo && fileInfo.type === 'FBDI_TEMPLATE') {
            isFBDIFile = true;

            let groundedIntent = null;
            let groundedInstructions = "";
            let groundedSheets = "";

            try {
                const metadata = JSON.parse(fileInfo.content);
                const connection = context.connection;

                // REPLICATE CORE RAG FLOW
                let knowledgeText = "";
                if (connection) {
                    const queryText = `Analyze FBDI for: ${fileInfo.name} ${Object.keys(metadata.sheets || []).join(' ')}.`;
                    const knowledge = await searchVectorKnowledge(connection, queryText);
                    knowledgeText = knowledge.map(k => k.CONTENT_CHUNK).join('\n---\n');
                    console.log(`[Assistant] Integrated ${knowledge.length} knowledge snippets for grounded analysis.`);
                }

                // Convert sheets object to array for ociService
                const sheetDetails = Object.entries(metadata.sheets || {}).map(([name, s]) => ({
                    name,
                    headers: s.headers || [],
                    headerInfos: s.headers?.map(() => '') || [],
                    sampleRows: []
                }));

                // Call the core FBDI analysis function for grounded intent with PRIOR KNOWLEDGE
                const analysis = await analyzeFbdiWithOCI({
                    fileName: fileInfo.name,
                    props: metadata.vba || {},
                    sheetNames: Object.keys(metadata.sheets || {}),
                    instructions: metadata.interfaceTables?.join(', ') || '',
                    sheetDetails: sheetDetails,
                    candidateGroups: [],
                    priorKnowledge: knowledgeText
                });
                groundedIntent = analysis.intent;
                const groundedModule = analysis.moduleName;
                groundedInstructions = metadata.instructions || "N/A";
                groundedSheets = Object.keys(metadata.sheets || {}).join(', ');

                result.reply = `The technical objective for **${fileInfo.name}** is: ${groundedIntent || 'Technical summary analysis'}.\n\nMODULE: ${groundedModule}\n\nSheets: ${groundedSheets}\n\nWould you like to proceed with the import FBDI process for this template?`;

                result.options = [
                    { label: "Import Template", value: "Importing the template" },
                    { label: "Cancel", value: "Cancel import" }
                ];

                result.metadata = {
                    analysisModuleName: groundedModule,
                    intent: groundedIntent,
                    structure: metadata // Pass full metadata to the frontend
                };
                return result;
            } catch (err) {
                console.warn("[Assistant] Grounded analysis failed, falling back to LLM summary", err.message);
            }
        } else if (fileInfo && fileInfo.content) {
            fileContext = `\n\n[USER UPLOADED FILE: ${fileInfo.name}]\nFile Content (truncated):\n\`\`\`\n${fileInfo.content.substring(0, 2000)}\n\`\`\`\n`;
        }

        // Fix for empty messages (File only upload)
        const effectiveMessage = (message && message.trim()) ? message : (fileInfo ? "[System: Analyzing uploaded file]" : "Hello");

        const fusionContext = fusionConfigs.length > 0
            ? "FUSION ENVIRONMENTS - Configured instances:\n" + fusionConfigs.map(f =>
                `- ID: ${f.id}, Name: ${f.name}, URL: ${f.url}`
            ).join('\n')
            : "No Fusion environments currently configured.";

        const systemPrompt = `You are the FBDI Assistant for Oracle Fusion.

        ${modelContext}
        
        ${fusionContext}

        CORE FLOWS & INTENTS:
        1. "FBDI IMPORT": Handled when the user wants to upload, analyze, or import a template.
        2. "MODEL DISCOVERY": Handled when the user wants architectural details, table lists, or exploration of data models.
        3. "LOAD TO FUSION": Handled when the user wants to push data to Oracle Fusion (UCM, Interface).

        LOAD TO FUSION WIZARD RULES:
        - If the user intent is "LOAD TO FUSION":
            a. Check if the user specified an environment name in their prompt.
            b. If yes, check if it matches any of the names in {FUSION ENVIRONMENTS}.
            c. If a match is found, confirm the selection: "Selecting [Name] environment..." and ask the user to upload the ZIP file.
            d. If NO match or NO name mentioned, list ALL available environment names and ask the user to choose one.
        - After an environment is selected, wait for the user to upload a ".zip" file.
        - Once a ZIP is uploaded in the context of a Fusion Load, confirm staging and offer to start the loading process.

        Always provide a direct, helpful response and surface relevant buttons or links for these flows.`;

        // Check for specific intents
        const isConfirmingYes = cleanMsg === 'yes' || cleanMsg.includes('proceed with import') || cleanMsg.includes('importing the template');
        const isConfirmingNo = cleanMsg === 'no' || cleanMsg.includes('cancel import');

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: {
                    modelId: MODEL_ID,
                    servingType: "ON_DEMAND"
                },
                chatRequest: {
                    message: effectiveMessage,
                    chatHistory: ociHistory,
                    preambleOverride: systemPrompt + (fileInfo ? fileContext : ""),
                    apiFormat: "COHERE",
                    maxTokens: 1000,
                    temperature: 0.1
                }
            }
        };

        // Logic for Interactive Model Exploration (Local Metadata Lookup)
        const modelListKeywords = [
            'model details', 'show models', 'what models', 'model names',
            'list models', 'available models', 'get models', 'list of models', 'models', 'discovery',
            'architecture', 'entities', 'tables in'
        ];

        const fusionLoadKeywords = [
            'load to fusion', 'push to fusion', 'interface load', 'ess job', 'ucm upload', 'fusion load',
            'move to fusion', 'send to oracle', 'loading process', 'fusion', 'orchestration'
        ];

        const extractionKeywords = ['extraction', 'extractions', 'specification', 'specifications', 'sheets', 'list extractions', 'show extractions'];
        const specKeywords = ['mapping', 'mappings', 'specification', 'specifications', 'spec', 'field mapping', 'column mapping', 'specifications'];
        const filterKeywords = ['filter', 'filters', 'condition', 'conditions', 'criteria'];

        const isExtractionRequest = extractionKeywords.some(kw => cleanMsg.includes(kw));
        const isSpecRequest = specKeywords.some(kw => cleanMsg.includes(kw));
        const isFilterRequest = filterKeywords.some(kw => cleanMsg.includes(kw));

        // Helper for human-friendly name matching
        const normalize = (s) => s.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();

        const sortedModels = [...models].sort((a, b) => b.MODEL_NAME.length - a.MODEL_NAME.length);
        const normalizedMsg = normalize(cleanMsg);

        // Find if any specific model name is mentioned in the message
        const mentionedModel = sortedModels.find(m =>
            normalizedMsg.includes(normalize(m.MODEL_NAME))
        );

        const isModelListRequest = modelListKeywords.some(keyword => cleanMsg === keyword || cleanMsg.includes(keyword)) && !mentionedModel;
        const isFusionLoadRequest = fusionLoadKeywords.some(keyword => cleanMsg.includes(keyword));
        const selectedModelMatch = message.match(/View (.*?) architecture/i) || message.match(/Show details for (.*)/i);

        const selectedEnvMatch = message.match(/Select (.*?) for Fusion Load/i);
        const currentEnvMention = (fusionConfigs.find(f => normalize(cleanMsg).includes(normalize(f.name))));

        // --- 1. PRIORITY: FUSION LOAD ORCHESTRATION ---
        // Find most recent staged file and environment config from history
        const lastStagedState = history.slice().reverse().find(h => h.sender === 'assistant' && h.metadata?.fusionEnvId && h.metadata?.serverFilename);
        const lastEnvState = history.slice().reverse().find(h => h.sender === 'assistant' && h.metadata?.fusionEnvId);

        const isReInitiatingLoad = (cleanMsg.includes('load') || cleanMsg.includes('previous') || cleanMsg.includes('staged')) && lastStagedState;
        const isZipInRequest = fileInfo && (fileInfo.type === 'ZIP_ARCHIVE' || fileInfo.name.toLowerCase().endsWith('.zip'));
        const effectiveEnv = currentEnvMention || (lastEnvState ? fusionConfigs.find(f => f.id === lastEnvState.metadata.fusionEnvId) : null);
        const isNewZipStaging = isZipInRequest && effectiveEnv;

        if (isReInitiatingLoad || isNewZipStaging || isFusionLoadRequest || selectedEnvMatch) {

            // Handle Environment Selection (if no ZIP provided yet)
            if (!isZipInRequest && (selectedEnvMatch || (isFusionLoadRequest && !cleanMsg.includes('previous')))) {
                const envName = selectedEnvMatch ? selectedEnvMatch[1] : currentEnvMention?.name;
                const env = fusionConfigs.find(f => normalize(f.name) === normalize(envName || ""));

                if (env) {
                    result.reply = `Excellent! Target environment: **${env.name}**. \n\nPlease upload the **ZIP file** you wish to load to Fusion. I will ensure the exact file reference is preserved for safe orchestration.`;
                    result.metadata = { fusionEnvId: env.id, fusionEnvName: env.name };
                    return result;
                } else if (isFusionLoadRequest) {
                    // List environments as before
                    result.reply = "I'd be happy to help you load data to Oracle Fusion. First, please select the target environment for this operation:";
                    result.options = [
                        ...fusionConfigs.map(f => ({ label: f.name, value: `Select ${f.name} for Fusion Load` })),
                        { label: "Configure New Environment", value: "navigate to config", url: "http://localhost:3000/fbdi/env-config" }
                    ];
                    return result;
                }
            }

            // Handle File Staging / Re-initiation
            if (isReInitiatingLoad || isNewZipStaging) {
                const state = isReInitiatingLoad ? lastStagedState.metadata : {
                    fusionEnvId: effectiveEnv.id,
                    fusionEnvName: effectiveEnv.name,
                    stagedFileName: fileInfo.name,
                    serverFilename: fileInfo.serverFilename
                };

                result.reply = isReInitiatingLoad
                    ? `I've confirmed the exact file reference: **${state.stagedFileName}** (Ready for ${state.fusionEnvName}). \n\nShall we initiate the multi-stage loading process now?`
                    : `I've detected both the file **${fileInfo.name}** and the target environment **${effectiveEnv.name}**! Everything has been staged successfully. \n\nProceed with the loading sequence?`;

                result.options = [
                    { label: "Start Loading Process", value: "START_FUSION_LOAD_ORCHESTRATION" },
                    { label: "Cancel", value: "no" }
                ];
                result.metadata = state;
                return result;
            }
        }

        // --- 2. SECONDARY: MODEL DISCOVERY (Skipped if Fusion intent detected above) ---
        // Scenario 1: User asks for a broad list of models
        if (isModelListRequest && models.length > 0) {
            result.reply = "I've found the following data models in your environment. Which one would you like to explore in detail?";
            result.options = models.map(m => ({
                label: `${m.MODEL_NAME}`,
                value: `View ${m.MODEL_NAME} architecture`
            }));
            return result;
        }

        // Scenario 2: User mentions a specific model or clicks a button
        const modelToResolve = mentionedModel || (selectedModelMatch ? models.find(m =>
            m.MODEL_NAME.trim().toLowerCase() === selectedModelMatch[1].trim().toLowerCase()
        ) : null);

        if (modelToResolve) {
            // Find if a specific extraction within this model is mentioned
            const mentionedExtraction = modelToResolve.EXTRACTION_DETAILS?.find(e =>
                normalizedMsg.includes(normalize(e.name))
            );

            // Handle Filter Request
            if (isFilterRequest && modelToResolve.EXTRACTION_DETAILS && modelToResolve.EXTRACTION_DETAILS.length > 0) {
                const targetExt = mentionedExtraction || modelToResolve.EXTRACTION_DETAILS[0];
                let filterSummary = "No filters defined for this extraction.";

                try {
                    const filters = typeof targetExt.filters === 'string' ? JSON.parse(targetExt.filters) : targetExt.filters;
                    if (filters && filters.length > 0) {
                        filterSummary = `| Column | Operator | Value |\n|:---|:---|:---|\n` +
                            filters.map(f => `| ${f.field || f.column} | ${f.operator} | ${f.value} |`).join('\n');
                    }
                } catch (e) { console.error("Filter parse error", e); }

                result.reply = `### Data Filters: ${targetExt.name}\n\n` +
                    `Here are the active filters configured for this extraction spec:\n\n` +
                    filterSummary + `\n\n` +
                    `Would you like to see the field mappings or download the full specification and ZIP extraction?`;

                result.options = [
                    { label: "View Mappings", value: `Show mappings for ${targetExt.name}` },
                    { label: "Download Mappings (Excel)", url: `http://localhost:3006/api/fbdi/extraction/download-spec/${modelToResolve.MODEL_ID}/${targetExt.id}` },
                    { label: "Run & Download ZIP", value: `RUN_EXTRACTION|${modelToResolve.MODEL_ID}|${targetExt.name}|${targetExt.sheetName || targetExt.name}` },
                    { label: "View All Extractions", value: `Show extractions for ${modelToResolve.MODEL_NAME}` }
                ];
                return result;
            }

            // Handle Mapping/Specification Request
            if (isSpecRequest && modelToResolve.EXTRACTION_DETAILS && modelToResolve.EXTRACTION_DETAILS.length > 0) {
                const targetExt = mentionedExtraction || modelToResolve.EXTRACTION_DETAILS[0];
                let mappingSummary = "No mappings defined for this extraction.";

                try {
                    const mappings = typeof targetExt.mappings === 'string' ? JSON.parse(targetExt.mappings) : targetExt.mappings;
                    if (mappings && mappings.length > 0) {
                        mappingSummary = `| Target Header | Source Column / Rule |\n|:---|:---|\n` +
                            mappings.slice(0, 15).map(m => `| ${m.targetName || m.name} | ${m.sourceField || 'Literal/Transform'} |`).join('\n') +
                            (mappings.length > 15 ? `\n| ... | ... |` : '');
                    }
                } catch (e) { console.error("Mapping parse error", e); }

                result.reply = `### Field Mappings: ${targetExt.name}\n\n` +
                    `Here are the top field specifications for this extraction:\n\n` +
                    mappingSummary + `\n\n` +
                    `Full configuration: http://localhost:3000/fbdi/models/grp_db_${modelToResolve.MODEL_ID}/extractions/spec_db_${targetExt.id}`;

                result.options = [
                    { label: "View Filters", value: `Show filters for ${targetExt.name}` },
                    { label: "Download Mappings (Excel)", url: `http://localhost:3006/api/fbdi/extraction/download-spec/${modelToResolve.MODEL_ID}/${targetExt.id}` },
                    { label: "Run & Download ZIP", value: `RUN_EXTRACTION|${modelToResolve.MODEL_ID}|${targetExt.name}|${targetExt.sheetName || targetExt.name}` },
                    { label: "Open in Editor", url: `http://localhost:3000/fbdi/models/grp_db_${modelToResolve.MODEL_ID}/extractions/spec_db_${targetExt.id}` }
                ];
                return result;
            }

            // Handle General Extraction Listing
            if (isExtractionRequest && modelToResolve.EXTRACTION_DETAILS && modelToResolve.EXTRACTION_DETAILS.length > 0) {
                const extractionRows = modelToResolve.EXTRACTION_DETAILS.map(e => {
                    let fCount = 0;
                    try { fCount = (typeof e.filters === 'string' ? JSON.parse(e.filters) : (e.filters || [])).length; } catch (err) { }
                    const runCmd = `RUN_EXTRACTION@@${modelToResolve.MODEL_ID}@@${e.name}@@${e.sheetName || e.name}`;
                    const dlUrl = `http://localhost:3006/api/fbdi/extraction/download-spec/${modelToResolve.MODEL_ID}/${e.id}`;
                    const viewUrl = `http://localhost:3000/fbdi/models/grp_db_${modelToResolve.MODEL_ID}/extractions/spec_db_${e.id}`;

                    return `| ${e.name} | ${e.version} | [Run ZIP](${runCmd}) | [Download Specs](${dlUrl}) | ${fCount} | ${viewUrl} |`;
                }).join('\n');

                result.reply = `### Extraction Tasks: ${modelToResolve.MODEL_NAME}\n\n` +
                    `I've found the following extraction tasks configured for this model. You can run or export each one directly from the table below, or initiate a full **Batch Extraction**:\n\n` +
                    `| Name | Ver | ZIP Extraction | Mappings | Filters | URL |\n` +
                    `|:---|:---|:---|:---|:---|:---|\n` +
                    extractionRows + `\n\n` +
                    `You can also request **"filters for [name]"** to preview conditions.`;

                result.options = [
                    { label: "Run Batch Extraction (All)", value: "batch extraction" },
                    { label: "View All Models", value: "list models" }
                ];
                result.metadata = { modelId: modelToResolve.MODEL_ID, modelName: modelToResolve.MODEL_NAME };

                return result;
            }

            result.reply = `### Model Architecture: ${modelToResolve.MODEL_NAME}\n\n` +
                `| Tables Involved | Extraction Specifications |\n` +
                `|:---|:---|\n` +
                `| ${modelToResolve.TABLES || 'N/A'} | ${modelToResolve.EXTRACTIONS || 'N/A'} |\n\n` +
                `For more details please visit this URL: http://localhost:3000/fbdi/models/grp_db_${modelToResolve.MODEL_ID}\n\n` +
                `Would you like to see the **detailed list of extractions** or the filter configurations for this model?`;

            result.options = [
                { label: "View Detailed Extractions", value: `Show extractions for ${modelToResolve.MODEL_NAME}` },
                { label: "View Architecture", url: `http://localhost:3000/fbdi/models/grp_db_${modelToResolve.MODEL_ID}` }
            ];

            return result;
        }



        if (isConfirmingNo) {
            return {
                reply: "Understood. The process has been cancelled. Let me know if you'd like to try again or need help with anything else!",
                action_required: false
            };
        }

        // --- LLM CHAT (IF NO LOCAL SCENARIO MATCHED) ---
        const response = await client.chat(chatRequest);
        const reply = response.chatResult?.chatResponse?.text;

        if (!reply) {
            throw new Error("Empty response from OCI GenAI");
        }

        result.reply = reply;

        // --- REFLEXIVE ACTION INJECTION ---
        // If the LLM mentions Fusion Loading, ensure the button is available
        // GUARD: Don't show "Load to Fusion" buttons if the user is in the middle of a "Template Import" flow
        const isCurrentlyInImportWizard = isImportInitiation || isWaitingForName || isWaitingForUpload || fileInfo;

        if (!isCurrentlyInImportWizard && reply.toLowerCase().includes('fusion') && (reply.toLowerCase().includes('load') || reply.toLowerCase().includes('push'))) {
            if (!result.options.find(o => o.label.includes('Go to Load to Fusion'))) {
                result.options.push({ label: "Go to Load to Fusion", value: "navigate to load to fusion", url: "http://localhost:3000/fbdi/load-to-oracle" });
            }
        }

        // If the LLM mentions a specific model, inject the URL
        const mentionedInReply = sortedModels.find(m =>
            normalize(reply).includes(normalize(m.MODEL_NAME))
        );

        if (mentionedInReply && !result.reply.includes('http://localhost:3000/fbdi/models/')) {
            result.options.push({
                label: `View ${mentionedInReply.MODEL_NAME} Details`,
                url: `http://localhost:3000/fbdi/models/grp_db_${mentionedInReply.MODEL_ID}`
            });
        }

        if (reply.includes('Would you like to proceed with the import FBDI process')) {
            result.options.push({ label: "YES", value: "yes" });
            result.options.push({ label: "NO", value: "no" });
        }

        if (isConfirmingYes) {
            result.reply = ""; // Silence redundant reply box as executive logs will start
            // Find the most recent file analysis and model name in history
            let previousFile = 'Imported_Template';
            let previousIntent = 'Chatbot Automated Import';
            let previousModule = undefined;

            for (let i = history.length - 1; i >= 0; i--) {
                const h = history[i];
                if (h.sender === 'assistant' && h.text.includes('technical objective for')) {
                    const fileMatch = h.text.match(/\*\*(.*?)\*\*/);
                    if (fileMatch) previousFile = fileMatch[1];
                    const intentMatch = h.text.match(/is: (.*?)(?:\n|$)/);
                    if (intentMatch) previousIntent = intentMatch[1].trim();

                    // Extract moduleName from hidden tag if present
                    const moduleMatch = h.text.match(/\[MODULE: (.*?)\]/);
                    if (moduleMatch) previousModule = moduleMatch[1];

                    break;
                }
            }

            result.action_required = true;
            result.action_type = 'EXECUTE_FBDI_IMPORT';
            result.metadata = {
                modelName: inferredModelName || effectiveMessage,
                templateName: previousFile,
                intent: previousIntent,
                analysisModuleName: previousModule,
                structure: fileInfo?.content ? JSON.parse(fileInfo.content) : null
            };
        }

        return result;

    } catch (error) {
        console.error('[OCI Assistant] Error:', error);
        return {
            reply: "I'm sorry, I encountered an error while processing your request with OCI Cohere. Please ensure your OCI configuration is valid.",
            action_required: false,
            error: error.message
        };
    }
}

module.exports = {
    processAssistantChatOCI
};
