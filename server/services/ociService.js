/* server/services/ociService.js */
const common = require("oci-common");
const genai = require("oci-generativeaiinference");

// OCI Configuration (Local Override)
const path = require('path');
const CONFIG_LOCATION = path.join(__dirname, '../oci_config');
const CONFIG_PROFILE = "DEFAULT";
const COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaalqcwboncf4xzqpfvtuygdriwomhjzrltllqnu63sflohbkirs5ia";
const ENDPOINT = "https://inference.generativeai.uk-london-1.oci.oraclecloud.com";
const MODEL_ID = "ocid1.generativeaimodel.oc1.uk-london-1.amaaaaaask7dceya6unpxszl2mdu5yhs7fos3mmyjp3xpw7kw2inpz2psdxq";

async function analyzeFbdiWithOCI(metadata) {
    try {
        console.log("Initializing OCI Client...");
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);

        const client = new genai.GenerativeAiInferenceClient({
            authenticationDetailsProvider: provider
        });
        client.endpoint = ENDPOINT;

        const candidateGroupsText = (metadata.candidateGroups || []).join(', ');

        const prompt = `Analyze this Oracle FBDI Template to identify its position in the Oracle Fusion taxonomy.
        
        File Context:
        - File Name: ${metadata.fileName}
        - Subject/App Metadata: ${metadata.props.Subject || metadata.props.Application || 'N/A'}
        - Sheet Names: ${(metadata.sheetNames || []).join(', ')}
        - Instruction Text Snippet: "${(metadata.instructions || '').substring(0, 1500).replace(/\n/g, ' ')}"
        
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

async function smartMapColumnsWithOCI(headers, candidates, moduleContext, learnedMappings = []) {
    try {
        console.log("Initializing OCI Client for Smart Mapping...");
        const provider = new common.ConfigFileAuthenticationDetailsProvider(CONFIG_LOCATION, CONFIG_PROFILE);

        const client = new genai.GenerativeAiInferenceClient({
            authenticationDetailsProvider: provider
        });
        client.endpoint = ENDPOINT;

        // Construct the context text with enriched metadata
        const candSummary = candidates.map(c =>
            `Group: "${c.GROUP_NAME}", Table: ${c.TABLE_NAME}, Column: ${c.COLUMN_NAME}, BusinessName: "${c.METADATA_COLUMN_HEADER}", Description: "${c.COLUMN_DESCRIPTION || 'N/A'}", Table Context (Siblings): [${c.TABLE_CONTEXT || 'N/A'}]`
        ).join('\n');

        // Construct learned knowledge text
        let learnedContext = '';
        if (learnedMappings && learnedMappings.length > 0) {
            const learnedStr = learnedMappings.map(m => `Header: "${m.DATA_IDENTIFIER}" -> mapped to Table: ${m.TABLE_NAME}, Column: ${m.COLUMN_NAME}`).join('\n');
            learnedContext = `\nPrior Knowledge (Golden Mappings for this module):\n${learnedStr}\n`;
        }

        const prompt = `You are an expert Oracle Fusion/EBS Functional Consultant and Data Architect.
Your task is to create a "High-Fidelity" metadata configuration by mapping Template Headers to Database Columns.

Contextual Guidance (Target Module): ${moduleContext}${learnedContext}

Template Headers to Map (Intent Group):
${headers.join(', ')}

Available Database Candidates (Enriched Metadata):
${candSummary}

ADVANCED MAPPING RULES:
1. SEMANTIC INTENT (PRIMARY): Prioritize the "Description" (Column Comments) and "BusinessName" fields.
2. MODULE AFFINITY (CRITICAL): Favor tables where the "Group" matches the "Target Module" provided above. If no direct group match, use the "Table Context (Siblings)" to pick the table that functionally belongs to that module (e.g. an Invoice table should have siblings like INVOICE_ID, VENDOR_ID).
3. GROUP CONTEXT: For Global Discovery (Pass 3), use "Table Context" to ensure the table's "flavor" matches the header's intent.
4. MANDATORY FIELDS FIRST: Headers starting with '*' or '**' are mandatory. You MUST find a mapping for these.
5. NO HALLUCINATION: Only map what is provided in the candidate list.

Output your response as a raw JSON array of objects:
[
  {
    "DATA_IDENTIFIER": "Template Header Name",
    "TABLE_NAME": "Selected Table Name",
    "COLUMN_NAME": "Selected Column Name",
    "METADATA_COLUMN_HEADER": "Original DB Business Name/Description Match"
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

module.exports = { analyzeFbdiWithOCI, smartMapColumnsWithOCI, processNlQueryWithOCI };

