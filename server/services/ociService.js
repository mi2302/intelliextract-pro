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

        const prompt = `Analyze this Oracle FBDI Template to identify its position in the Oracle Fusion taxonomy.
        
        File Context:
        - File Name: ${metadata.fileName}
        - Subject/App Metadata: ${metadata.props.Subject || metadata.props.Application || 'N/A'}
        - Sheet Names: ${(metadata.sheetNames || []).join(', ')}
        - Instruction Text Snippet: "${(metadata.instructions || '').substring(0, 1500).replace(/\n/g, ' ')}"
        
        Your Goal:
        1. Identify the Primary Object Owner / Product Family (e.g., 'Procurement', 'Financials', 'Project Management').
        2. Identify the Functional Area / Product (e.g., 'Suppliers', 'Payables', 'Fixed Assets', 'General Ledger').
        3. Identify the Main Business Object (e.g., 'Supplier', 'Invoice', 'Asset', 'Journal').
        4. Identify the specific Business Intent.
        
        Output JSON format (strictly valid JSON):
        {
           "productFamily": "string",
           "moduleName": "Functional Area Name",
           "possibleModules": ["Module 1", "Module 2"],
           "mainObject": "Main Business Object Name",
           "intent": "string", 
           "confidence": "High" | "Medium" | "Low",
           "reasoning": "Brief explanation referencing Oracle documentation where applicable."
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

        console.log("Sending request to OCI GenAI...");
        const response = await client.chat(chatRequest);

        // Cohere Response Extraction
        // Structure: response.chatResult?.chatResponse?.text
        const text = response.chatResult?.chatResponse?.text;

        if (!text) {
            console.warn("OCI Response invalid structure:", JSON.stringify(response));
            throw new Error("Empty response from OCI GenAI");
        }

        // Clean Markdown
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        // Remove conversational prefix if any
        const jsonStart = cleanText.indexOf('{');
        const jsonEnd = cleanText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
        }

        return JSON.parse(cleanText);

    } catch (error) {
        console.error("OCI Analysis Failed:", error);
        return {
            moduleName: "Unknown",
            intent: "Unknown",
            confidence: "Low",
            reasoning: "OCI Error: " + error.message
        };
    }
}

module.exports = { analyzeFbdiWithOCI };
