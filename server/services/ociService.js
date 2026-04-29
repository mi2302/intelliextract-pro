/* server/services/ociService.js */
const common = require("oci-common");
const genai = require("oci-generativeaiinference");
const os = require("oci-objectstorage");

const path = require('path');
const fs = require('fs');
const CONFIG_LOCATION = path.join(__dirname, '../oci_config');
const CONFIG_PROFILE = "DEFAULT";
const COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaalqcwboncf4xzqpfvtuygdriwomhjzrltllqnu63sflohbkirs5ia";
const ENDPOINT = "https://inference.generativeai.uk-london-1.oci.oraclecloud.com";
const MODEL_ID = "ocid1.generativeaimodel.oc1.uk-london-1.amaaaaaask7dceya6unpxszl2mdu5yhs7fos3mmyjp3xpw7kw2inpz2psdxq";
const EMBED_MODEL_ID = "cohere.embed-english-v3.0"; // Adjust based on availability

async function generateEmbeddingsWithOCI(inputTexts) {
    if (!inputTexts || inputTexts.length === 0) return [];

    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({
            authenticationDetailsProvider: provider
        });
        client.endpoint = ENDPOINT;

        // OCI limit is 96 inputs per request
        const MAX_BATCH_SIZE = 90; // Using 90 for safety
        const results = [];

        for (let i = 0; i < inputTexts.length; i += MAX_BATCH_SIZE) {
            const batch = inputTexts.slice(i, i + MAX_BATCH_SIZE);
            console.log(`[OCI] Generating embeddings for batch: ${i} to ${i + batch.length}...`);

            const embedTextDetails = {
                embedTextDetails: {
                    compartmentId: COMPARTMENT_ID,
                    servingMode: {
                        modelId: EMBED_MODEL_ID,
                        servingType: "ON_DEMAND"
                    },
                    inputs: batch,
                    inputType: "SEARCH_QUERY"
                }
            };

            const response = await client.embedText(embedTextDetails);
            if (response.embedTextResult && response.embedTextResult.embeddings) {
                results.push(...response.embedTextResult.embeddings);
            }
        }

        return results;
    } catch (error) {
        console.error("OCI Embedding Generation Failed:", error);
        return null;
    }
}

async function analyzeFbdiWithOCI(metadata) {
    try {
        console.log("Initializing OCI Client...");
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);

        const client = new genai.GenerativeAiInferenceClient({
            authenticationDetailsProvider: provider
        });
        client.endpoint = ENDPOINT;

        const candidateGroupsText = (metadata.candidateGroups || []).join(', ');

        const sheetDetailsText = (metadata.sheetDetails || []).map(sd => {
            const headerReport = sd.headers.map((h, i) => `${h}${sd.headerInfos && sd.headerInfos[i] ? ` [${sd.headerInfos[i]}]` : ''}`).join(', ');
            return `Sheet: ${sd.name}\nHeaders & Metadata: ${headerReport}\nSample Data: ${JSON.stringify(sd.sampleRows || [])}`;
        }).join('\n\n');

        const prompt = `Analyze this Oracle FBDI Template to identify its position in the Oracle Fusion taxonomy.
        
        File Context:
        - File Name: ${metadata.fileName}
        - Subject/App Metadata: ${metadata.props.Subject || metadata.props.Application || 'N/A'}
        - Sheet Names: ${(metadata.sheetNames || []).join(', ')}
        - Instruction Text Snippet: "${(metadata.instructions || '').substring(0, 1500).replace(/\n/g, ' ')}"
        
        Detailed Sheet Info:
        ${sheetDetailsText}

        ${metadata.priorKnowledge ? `Prior Knowledge (from Knowledge Base):\n${metadata.priorKnowledge}` : ''}
        
        Candidate Group Names (from our Database):
        [${candidateGroupsText}]

        Your Goal:
        1. Identify the Primary Object Owner / Product Family (e.g., 'Procurement', 'Financials', 'Project Management').
        2. Identify the Target Module / Functional Area / Product. 
           CRITICAL: You MUST pick the best matching value from the 'Candidate Group Names' list provided above for the 'moduleName' field.
        3. Identify the Main Business Object (e.g., 'Project', 'Supplier', 'Invoice', 'Journal').
        4. Identify the specific Business Intent.
        
        CRITICAL INSTRUCTION:
        - The 'moduleName' field MUST contain exactly one value from the 'Candidate Group Names' list.
        - If your confidence is 'Medium' or 'Low', populate the 'possibleModules' array with other relevant group names from the candidate list that could also apply.
        - If 'High' confidence, 'possibleModules' can be just the same single value as 'moduleName'.

        Output JSON format (strictly valid JSON):
        {
           "productFamily": "Product Family",
           "moduleName": "Selected Group Name from candidates",
           "possibleModules": ["Secondary Group 1", "Secondary Group 2"],
           "mainObject": "Main Business Object Name",
           "intent": "string", 
           "confidence": "High" | "Medium" | "Low",
           "reasoning": "Brief explanation referencing the candidate list and template metadata."
        }`;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: {
                    modelId: MODEL_ID,
                    servingType: "ON_DEMAND"
                },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 800,
                    temperature: 0.1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                }
            }
        };

        console.log("Sending request to OCI GenAI for Module Identification...");
        const response = await client.chat(chatRequest);

        const text = response.chatResult?.chatResponse?.text;

        if (!text) {
            console.warn("OCI Response invalid structure:", JSON.stringify(response));
            throw new Error("Empty response from OCI GenAI");
        }

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonStart = cleanText.indexOf('{');
        const jsonEnd = cleanText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        const parsed = JSON.parse(cleanText);
        console.log(`AI identified Module: ${parsed.moduleName} (Confidence: ${parsed.confidence})`);
        return parsed;

    } catch (error) {
        console.error("OCI Analysis Failed:", error);
        return {
            moduleName: "Unknown",
            possibleModules: [],
            intent: "Unknown",
            confidence: "Low",
            reasoning: "OCI Error: " + error.message
        };
    }
}

async function smartMapColumnsWithOCI(headers, candidates, moduleContext, learnedMappings = [], extraContext = {}) {
    try {
        console.log("Initializing OCI Client for Smart Mapping...");
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);

        const client = new genai.GenerativeAiInferenceClient({
            authenticationDetailsProvider: provider
        });
        client.endpoint = ENDPOINT;

        // Construct the context text with enriched metadata
        const candSummary = candidates.map(c =>
            `Group: "${c.GROUP_NAME}", Table: ${c.TABLE_NAME}, Column: ${c.COLUMN_NAME}, Type: ${c.DATA_TYPE || 'N/A'}, Required: ${c.IS_REQUIRED || 'N/A'}, BusinessName: "${c.METADATA_COLUMN_HEADER}", Description: "${c.COLUMN_DESCRIPTION || 'N/A'}", Table Context (Siblings): [${c.TABLE_CONTEXT || 'N/A'}]`
        ).join('\n');

        // Construct learned knowledge text
        let learnedContext = '';
        if (learnedMappings && learnedMappings.length > 0) {
            const learnedStr = learnedMappings.map(m => `Header: "${m.DATA_IDENTIFIER}" -> mapped to Table: ${m.TABLE_NAME}, Column: ${m.COLUMN_NAME}`).join('\n');
            learnedContext = `\nPrior Knowledge (Golden Mappings for this module):\n${learnedStr}\n`;
        }

        const headerListText = headers.map(h => {
            if (typeof h === 'object') {
                return `Header: "${h.header}"${h.info ? ` (Metadata: ${h.info})` : ''}`;
            }
            return h;
        }).join('\n');

        const prompt = `You are an expert Oracle Fusion/EBS Functional Consultant and Data Architect.
Your task is to create a "High-Fidelity" metadata configuration by identifying the **best-fit** Database Column for each Template Header.

Contextual Guidance (Target Module): \${moduleContext}\${learnedContext}

Template Context:
- Sheet Name: \${extraContext.currentSheet || 'N/A'}
- All Sheet Names: \${(extraContext.sheetNames || []).join(', ')}
- Template Instructions: "\${(extraContext.instructions || 'N/A').substring(0, 1000)}"

\${extraContext.priorKnowledge ? \`Prior Knowledge (from Knowledge Base):\n\${extraContext.priorKnowledge}\` : ''}

Template Headers to Map (with Source Descriptions):
\${headerListText}

Available Database Candidates (Enriched Metadata):
\${candSummary}

ADVANCED MAPPING RULES:
1.  **FUNCTIONAL MEANING IS KING**: Prioritize the **"Description"** (Column Comment) and **"Metadata"** (Source Description) over the literal column name. Oracle column names are often technical (e.g., SEGMENT1, ATTRIBUTE1); the description tells you what it actually is.
2.  **SEMANTIC SYNONYMS**: Align headers to columns based on functional purpose. 
    - "Supplier", "Vendor", and "Party" are often equivalent in specific contexts.
    - "Business Unit", "BU", and "Operating Unit" are equivalent.
    - "Address" is strongly related to "Site", "Location", "Party Site", and "Physical Address".
    - "Agent", "Buyer", and "Procurement Officer" are functional synonyms.
    - "Quantity", "Qty", "Amount", and "Volume" should be mapped based on context.
    - "Currency", "Curr", and "ISO Code" refer to the same concept.
    - "UOM", "Unit of Measure", and "Packaging Unit" are synonyms.
    - "Tax", "VAT", "GST", "Duty", and "Levy" are related.
    - "Item", "Product", "Part Number", "SKU", and "Material" refer to the same entity.
    - "Project", "Task", "Charge Account", and "Budget Line" often correlate in mapping.
    - The AI should proactively identify logical functional synonyms even if not listed here.
3.  **THE "INTERNAL COLUMN" HINT**: If the Header Info contains **"Internal Column: [NAME]"**, this is a direct directive from the template architect. You must prioritize mapping to a database column with that technical name if it exists in the candidates.
4.  **THE "GENERIC COLUMN" RULE**: If a Template Header name is generic (e.g., "Attribute 1", "Line Attribute 13"), YOU MUST rely 100% on the "Metadata" (Source Description/Bubble Text) provided in the header info.
5.  **THE "FLAG VS CODE" TRAP**: Be extremely careful with "FLAG" vs "CODE" or "NAME". Flags are usually 'Y'/'N'.
6.  **SIGNALS HIERARCHY**: Prioritize: Internal Column Hint -> Source Metadata (Comments/Row 3) -> DB Column Description -> Data Type -> Column Name.
7.  **DATATYPE GUARDRAIL**: Ensure the mapped column can logically store the source data.

Output your response as a raw JSON array of objects, including a confidence score (0-100) for each mapping:
[
  {
    "DATA_IDENTIFIER": "Template Header Name",
    "TABLE_NAME": "Selected Table Name",
    "COLUMN_NAME": "Selected Column Name",
    "METADATA_COLUMN_HEADER": "Original DB Business Name/Description Match",
    "CONFIDENCE_SCORE": 95,
    "REASONING": "Brief justification based on rules"
  }
]
`;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: {
                    modelId: MODEL_ID,
                    servingType: "ON_DEMAND"
                },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 1500,
                    temperature: 0.1,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                }
            }
        };

        console.log("Sending smart mapping request to OCI GenAI...");
        const response = await client.chat(chatRequest);

        let text = response.chatResult?.chatResponse?.text;
        if (!text) {
            throw new Error("Empty response from OCI GenAI");
        }

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        const mappedResult = JSON.parse(cleanText);
        return mappedResult;

    } catch (error) {
        console.error("OCI Smart Mapping Failed:", error);
        return null;
    }
}

async function processNlQueryWithOCI(query, metadata) {
    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
        client.endpoint = ENDPOINT;

        const prompt = `The user wants to generate a file. Query: "${query}". 
        Based on this metadata: ${JSON.stringify(metadata)}, determine:
        1. Which Object Group (objectGroupId) they refer to.
        2. Which columns (sourceField as 'Object.Field', targetName as Header) they likely need.
        3. Desired export format (xls, csv, pipe, psv).
        
        Output Strictly JSON:
        {
          "objectGroupId": "string",
          "specName": "string",
          "format": "string",
          "columns": [
            { "sourceField": "Object.Field", "targetName": "Header" }
          ]
        }`;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: { modelId: MODEL_ID, servingType: "ON_DEMAND" },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 1000,
                    temperature: 0.1
                }
            }
        };

        const response = await client.chat(chatRequest);
        const text = response.chatResult?.chatResponse?.text;
        if (!text) throw new Error("Empty response from OCI");

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonStart = cleanText.indexOf('{');
        const jsonEnd = cleanText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(cleanText);
    } catch (error) {
        console.error("OCI NL Query Failed:", error);
        return { objectGroupId: null };
    }
}

async function rankTablesWithOCI(businessIntent, tables, extraContext = {}) {
    try {
        console.log("Initializing OCI Client for Table Ranking...");
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
        client.endpoint = ENDPOINT;

        // Limiting the number of tables to avoid token limits, ideally we should pre-filter or batch
        const tableSummary = tables.slice(0, 200).map(t =>
            `Table: ${t.tableName}, Comment: "${t.comments}"`
        ).join('\n');

        const prompt = `You are an expert Oracle Fusion Data Architect. 
        Current GLOBAL TEMPLATE Intent: "${extraContext.globalIntent || 'N/A'}"
        Current SPECIFIC SHEET Intent: "${businessIntent}"
        
        Template Context:
        - Sheet Names: ${(extraContext.sheetNames || []).join(', ')}
        - Instruction Snippet: "${(extraContext.instructions || 'N/A').substring(0, 1000)}"
        
        ${extraContext.priorKnowledge ? `Prior Knowledge (from Knowledge Base):\n${extraContext.priorKnowledge}` : ''}
        
        CRITICAL TARGET TABLE PATTERN: "${extraContext.coreTablePattern || 'N/A'}"
        INTENT REASONING: "${extraContext.reasoning || 'N/A'}"
        (Note: If a pattern or reasoning is provided, you should STRONGLY PRIORITIZE tables that match or contain this string, as it has been functionally verified through deep header analysis).
        
        Database Tables (Oracle Fusion XXEA_MS Master Tables):
        ${tableSummary}
        
        Your Critical Tasks:
        1. DECODE TECHNICAL NAMES: Many Oracle sheets use interface table names (e.g., PO_LINE_LOCATIONS_INTERFACE). You must realize this refers to "Purchase Order Shipments".
        2. FUNCTIONAL ALIGNMENT: Identify ALL database tables that are functionally relevant to this specific business object (Shipments, Invoices, Suppliers, etc.).
        3. SUB-OBJECT ALIGNMENT: If the sub-intent is "${extraContext.subObjectType || 'N/A'}" (e.g., Shipment, Distribution, Header, Site, Address), the #1 ranked table MUST functionally match this exact purpose. For example, on an "Addresses" sheet, the Address table MUST be ranked above the Header table.
        4. MASTER OBJECT PRIORITIZATION: Prioritize the main "ALL" or "MASTER" tables that store the data for the **SPECIFIC SHEET INTENT**.
        5. ORACLE TRAP RULES: 
           - "LINE_LOCATION" or "SHIPMENT" = Business Object: Shipment / Table Pattern: PO_LINE_LOCATIONS_ALL.
           - "DISTRIBUTION" = Business Object: Distribution / Table Pattern: PO_DISTRIBUTIONS_ALL.
           - "LINE" (without 'LOCATION' or 'DIST') = Business Object: Line / Table Pattern: PO_LINES_ALL.
        6. ASSIGNMENT VS MASTER: In Oracle Fusion, "Assignment" or "Child" tables (e.g., SITE_ASSIGNMENTS) should always be ranked lower than the "Master" table for that specific sheet (e.g., SUPPLIER_SITES).
        7. AGGRESSIVE MODULE FILTERING: Use the **GLOBAL TEMPLATE Intent** to define the primary module. If the template is "Purchase Order", do NOT include Supplier or Project tables in your top rankings unless they are critical bridge tables. 
        7.5 MANDATORY SUPPLIER CANDIDATES: If the intent is related to "Suppliers", consider these tables, but **re-rank them** based on the specific sheet (e.g., if the sheet is Addresses, then XXEA_MS_SUPPLIER_ADDRESSES must be #1): 
           - XXEA_MS_SUPPLIER_HEADERS
           - XXEA_MS_SUPPLIER_ADDRESSES
           - XXEA_MS_SUPPLIER_SITES
           - XXEA_MS_SITE_ASSIGNMENTS
           - XXEA_MS_AP_SUPP_BANK_ACCTS (Bank accounts Sheet and template)
           - XXEA_MS_AP_SUPP_CONTACTS ( Supplier contact)
        8. SHEET-SPECIFIC OVERRIDE: Always consider to give priority to the table name which is positively corelated to the specific sheet intent FIRST, then the template level master SECOND.
            -(e.g If sheet is for "Supplier Addresses", then the Addresses table is #1, and the Headers table is #2 or #3).
        


        
        Output Strictly JSON array of table names (Ranked by relevance, max 6):
        ["TABLE_NAME_1", "TABLE_NAME_2", ...]
        `;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: { modelId: MODEL_ID, servingType: "ON_DEMAND" },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 800,
                    temperature: 0.1
                }
            }
        };

        const response = await client.chat(chatRequest);
        const text = response.chatResult?.chatResponse?.text;
        if (!text) throw new Error("Empty response from OCI");

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        let rankedTables = [];
        try {
            rankedTables = JSON.parse(cleanText);
        } catch (parseErr) {
            console.error(`[AI Ranking] JSON Parse Error. Raw text snippet: ${text.substring(0, 500)}`);
            // Attempt secondary recovery if it's a list with conversational fluff
            const match = text.match(/\[\s*".*?"\s*\]/s);
            if (match) {
                try {
                    rankedTables = JSON.parse(match[0]);
                    console.log("[AI Ranking] Recovered from loose JSON format.");
                } catch (recErr) {
                    throw new Error("Failed to parse AI response as JSON array.");
                }
            } else {
                throw new Error("AI response did not contain a valid JSON array of table names.");
            }
        }

        console.log(`[AI Ranking] Identified ${rankedTables.length} tables for intent: ${businessIntent}`);
        return rankedTables;
    } catch (error) {
        console.error("OCI Table Ranking Failed:", error.message);
        return [];
    }
}

async function analyzeSheetIntentWithOCI(sheetName, headers, moduleContext = '') {
    try {
        console.log(`[OCI Intent] Analyzing functional role of sheet: ${sheetName}`);
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
        client.endpoint = ENDPOINT;

        const prompt = `As an Oracle Fusion Data Architect, analyze the following technical sheet name and headers to determine its functional role.
        
        Technical Sheet Name: "${sheetName}"
        Sample Headers: [${(headers || []).slice(0, 20).join(', ')}]
        Module Context: "${moduleContext}"
        
        Task:
        1. Identify exactly what business object this sheet represents (e.g., "Purchase Order Shipments", "Supplier Bank Accounts", "Supplier Contacts", "AP Invoice Lines").
        2. Identify the core "Master" table name pattern associated with this role (e.g., "PO_LINE_LOCATIONS_ALL", "IBY_EXT_BANK_ACCOUNTS", "OKC_CONTRACTS_ALL", "POZ_SUPPLIER_CONTACTS").
        3. ORACLE TRAP RULES: 
           - Any sheet name containing "LINE_LOCATION" refers to a **Shipment**, not a Line.
           - Any sheet name containing "DISTRIBUTION" refers to a **Distribution**.
           - Only use "Line" if the name does not contain "Location" or "Distribution".
           - "Bank Account" sheets should map to **IBY_EXT_BANK_ACCOUNTS** or **XXEA_MS_SUPPLIER_BANK_ACCOUNTS**.
           - "Contact" sheets should map to **POZ_SUPPLIER_CONTACTS** or **XXEA_MS_SUPPLIER_CONTACTS**.
           - "Contract" sheets should map to **OKC_CONTRACTS_ALL**.
        4. SUB-OBJECT TYPE: Identify the specific level of the record (e.g., "Header", "Line", "Shipment", "Distribution", "Assignment", "Site", "Bank Account", "Contact").
        5. MASTER VS ASSIGMENT: Be extremely careful not to suggest an "Assignment" or "Detail" table (like SITE_ASSIGNMENTS) if the sheet name implies a Master record (like SUPPLIER_SITES or BANK_ACCOUNTS).
        6. SEPARATION OF CONCERNS: Be extremely strict. If the sheet is for "Contacts", do NOT suggest an "Address" table. If it's for "Bank Accounts", do NOT suggest an "Address" table.



        
        {
          "functionalRole": "string description",
          "businessObject": "string object name",
          "subObjectType": "Header | Line | Shipment | Distribution | Assignment | Site | Other",
          "coreTablePattern": "string table name pattern",
          "reasoning": "string brief reasoning"
        }`;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: { modelId: MODEL_ID, servingType: "ON_DEMAND" },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 500,
                    temperature: 0.1
                }
            }
        };

        const response = await client.chat(chatRequest);
        const text = response.chatResult?.chatResponse?.text;
        if (!text) throw new Error("Empty response from OCI");

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        let analysis = null;
        try {
            analysis = JSON.parse(cleanText);
        } catch (parseErr) {
            console.error(`[OCI Intent] JSON Parse Error. Raw text snippet: ${text.substring(0, 500)}`);
            const match = text.match(/\{.*?\}/s);
            if (match) {
                try {
                    analysis = JSON.parse(match[0]);
                    console.log("[OCI Intent] Recovered from loose JSON format.");
                } catch (recErr) {
                    throw new Error("Failed to parse intent analysis as JSON.");
                }
            } else {
                throw new Error("AI response did not contain a valid JSON object for intent analysis.");
            }
        }

        return analysis;
    } catch (error) {
        console.error("OCI Intent Analysis Failed:", error.message);
        return {
            functionalRole: sheetName,
            businessObject: "Unknown",
            coreTablePattern: "",
            reasoning: "Analysis failed: " + error.message
        };
    }
}

async function suggestTransformationsWithOCI(columnName, sourceField, dataType, moduleContext) {
    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
        client.endpoint = ENDPOINT;

        const prompt = `You are a data transformation expert.
        Suggest the most relevant data transformations for the following field:
        - Column Header: "${columnName}"
        - Source Field: "${sourceField}"
        - Data Type: "${dataType}"
        - Module Context: "${moduleContext}"

        Available Transformation Types:
        - UPPERCASE (String only)
        - LOWERCASE (String only)
        - TRIM (String only)
        - AI_SUMMARY (String only)
        - DATE_FORMAT (Date only - Requires "format" parameter like 'YYYY/MM/DD' or 'DD-MON-YYYY')
        - REGEX_REPLACE (String only - Requires "pattern" and "replace")
        - LOOKUP (Reference data)
        - AGGREGATE_SUM (Number only)
        - CONDITIONAL_LOGIC (Any)
        - PHONE_FORMAT (String)
        - MASK_DATA (String - e.g. 'X-XXX-XXX')
        - SUBSTRING (String - Requires "start" and "length")
        - COALESCE (Any - Falls back to a value if null)
        - MULTIPLY (Number - Requires "factor")
        - MAP_VALUE (Any - Simple replacement mapping)

        CRITICAL RULES:
        1. If the Data Type is "NUMBER", DO NOT suggest UPPERCASE, LOWERCASE, TRIM, or AI_SUMMARY.
        2. If the Data Type is "DATE", always suggest DATE_FORMAT. **You MUST provide a likely format string in the params (e.g., 'YYYY/MM/DD' or 'DD-MON-YYYY' based on Oracle/Fusion standards).**
        3. For REGEX_REPLACE, provide likely pattern/replace params if obvious.
        4. For MULTIPLY, if it's a currency or unit field, suggest a factor if relevant.

        Output ONLY a JSON array of transformation objects:
        [
          { "type": "TYPE1", "params": { "key": "value" } },
          { "type": "DATE_FORMAT", "params": { "format": "YYYY/MM/DD" } }
        ]`;

        const chatRequest = {
            chatDetails: {
                compartmentId: COMPARTMENT_ID,
                servingMode: { modelId: MODEL_ID, servingType: "ON_DEMAND" },
                chatRequest: {
                    message: prompt,
                    apiFormat: "COHERE",
                    maxTokens: 1000,
                    temperature: 0.1
                }
            }
        };

        const response = await client.chat(chatRequest);
        const text = response.chatResult?.chatResponse?.text;
        if (!text) return [];

        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(cleanText);
    } catch (error) {
        console.error("OCI Suggest Transformations Failed:", error);
        return [];
    }
}

// Object Storage Operations
async function uploadTemplateToOCI(localPath, objectName) {
    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

        const namespace = process.env.OCI_NAMESPACE;
        const bucketName = process.env.OCI_BUCKET_NAME;

        console.log(`[OCI Storage] Uploading ${objectName} to bucket ${bucketName}...`);

        const stats = await fs.promises.stat(localPath);
        const nodeStream = fs.createReadStream(localPath);

        const putObjectRequest = {
            namespaceName: namespace,
            bucketName: bucketName,
            putObjectBody: nodeStream,
            objectName: objectName,
            contentLength: stats.size
        };

        await client.putObject(putObjectRequest);
        console.log(`[OCI Storage] Upload successful: ${objectName}`);
        return true;
    } catch (error) {
        console.error("[OCI Storage] Upload failed:", error);
        throw error;
    }
}

async function downloadTemplateFromOCI(objectName, localPath) {
    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

        const namespace = process.env.OCI_NAMESPACE;
        const bucketName = process.env.OCI_BUCKET_NAME;

        console.log(`[OCI Storage] Downloading ${objectName} from bucket ${bucketName}...`);

        const getObjectRequest = {
            objectName: objectName,
            namespaceName: namespace,
            bucketName: bucketName
        };

        const response = await client.getObject(getObjectRequest);

        // Ensure directory exists
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        let stream = response.value;

        // Node.js v22 supports fromWeb, but let's check for it
        const { Readable } = require('stream');
        if (stream && typeof stream.getReader === 'function' && typeof stream.pipe !== 'function') {
            console.log("[OCI Storage] Converting Web Stream to Node Stream...");
            stream = Readable.fromWeb(stream);
        }

        if (stream && typeof stream.pipe === 'function') {
            const writer = fs.createWriteStream(localPath);
            stream.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`[OCI Storage] Download successful (stream): ${localPath}`);
                    resolve(true);
                });
                writer.on('error', (err) => {
                    console.error("[OCI Storage] Write stream error:", err);
                    reject(err);
                });
            });
        } else if (stream instanceof Uint8Array || Buffer.isBuffer(stream)) {
            // If it's already a buffer/array, write it directly
            fs.writeFileSync(localPath, stream);
            console.log(`[OCI Storage] Download successful (buffer): ${localPath}`);
            return true;
        } else {
            console.error("[OCI Storage] Unexpected response value type:", typeof stream);
            throw new Error(`OCI getObject returned a non-stream value (${typeof stream})`);
        }
    } catch (error) {
        console.error("[OCI Storage] Download failed:", error);
        throw error;
    }
}

async function listTemplatesInOCI() {
    try {
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);
        const client = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

        const namespace = process.env.OCI_NAMESPACE;
        const bucketName = process.env.OCI_BUCKET_NAME;

        const listObjectsRequest = {
            namespaceName: namespace,
            bucketName: bucketName
        };

        const response = await client.listObjects(listObjectsRequest);
        return response.listObjects.objects.map(obj => obj.name);
    } catch (error) {
        console.error("[OCI Storage] Listing failed:", error);
        return [];
    }
}

module.exports = {
    analyzeFbdiWithOCI,
    smartMapColumnsWithOCI,
    processNlQueryWithOCI,
    rankTablesWithOCI,
    generateEmbeddingsWithOCI,
    suggestTransformationsWithOCI,
    analyzeSheetIntentWithOCI,
    uploadTemplateToOCI,
    downloadTemplateFromOCI,
    listTemplatesInOCI
};

