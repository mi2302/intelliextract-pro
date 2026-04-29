/* server/services/claudeService.js */
const Anthropic = require('@anthropic-ai/sdk');
const { searchTemplates } = require('./templateScraper');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Processes a chat message using Claude with Tool Use capabilities.
 * @param {string} message - User's input message.
 * @param {object} context - Additional context (models, current state).
 */
async function processAssistantChat(message, context = {}) {
    try {
        const { models = [], fileInfo = null } = context;
        
        const modelContext = models.length > 0 
            ? "Available Data Models in the system:\n" + models.map(m => `- ${m.MODEL_NAME} (ID: ${m.MODEL_ID})`).join('\n')
            : "No data models currently available.";

        let fileContext = "";
        if (fileInfo) {
            fileContext = `\n\n[USER UPLOADED FILE: ${fileInfo.name}]\nFile Content (truncated if too large):\n\`\`\`\n${fileInfo.content}\n\`\`\`\n`;
        }

        const systemPrompt = `You are the FBDI Assistant, a premium AI expert specializing in Oracle Fusion Data Migration.
        
        ${modelContext}

        You have access to the following tools:
        1. 'search_fbdi_templates': Search Oracle documentation for .xlsm templates.
        2. 'search_models': Search the local database for uploaded data models.
        3. 'get_model_architecture': Retrieve tables and relationships for a model ID.
        4. 'get_table_columns': List columns for a database table.
        5. 'get_model_extractions': List saved extractions (specs) and their versions for a specific model ID.

        GUIDELINES FOR LINKS & ENDPOINTS:
        - When a user asks for "endpoint info" or "links" related to a model or extraction, provide them as 'options' in the response.
        - UI Link for Model: /models/{modelId}
        - API Endpoint for Model Detail: http://localhost:3006/api/fbdi/saved-model/{modelId}
        - API Endpoint for Extraction: http://localhost:3006/api/fbdi/extraction/run/{specId} (Hypothetical run link)

        Always prioritize giving the user a direct "button" (option) to the UI or API rather than just dumping raw JSON text.
        
        Tone: Professional, expert, and premium.`;

        console.log(`[Claude] Sending message to Claude (Model: claude-opus-4-6): ${message.substring(0, 50)}...`);
        
        const response = await anthropic.messages.create({
            model: "claude-opus-4-6",
            max_tokens: 2000,
            temperature: 0,
            system: systemPrompt,
            messages: [
                { role: "user", content: fileContext + message }
            ],
            tools: [
                {
                    name: "search_fbdi_templates",
                    description: "Search Oracle Cloud Applications documentation for FBDI templates (.xlsm).",
                    input_schema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Functional object name" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "search_models",
                    description: "Search the local database for uploaded data models by name.",
                    input_schema: {
                        type: "object",
                        properties: {
                            searchTerm: { type: "string", description: "Part of the model name to search for" }
                        },
                        required: ["searchTerm"]
                    }
                },
                {
                    name: "get_model_architecture",
                    description: "Retrieve the list of tables and relationships for a specific model ID.",
                    input_schema: {
                        type: "object",
                        properties: {
                            modelId: { type: "string", description: "The ID of the model" }
                        },
                        required: ["modelId"]
                    }
                },
                {
                    name: "get_table_columns",
                    description: "List all columns and data types for a specific database table.",
                    input_schema: {
                        type: "object",
                        properties: {
                            tableName: { type: "string", description: "The technical table name" }
                        },
                        required: ["tableName"]
                    }
                },
                {
                    name: "get_model_extractions",
                    description: "List saved extractions (specs) and their versions for a specific model ID.",
                    input_schema: {
                        type: "object",
                        properties: {
                            modelId: { type: "string", description: "The ID of the model" }
                        },
                        required: ["modelId"]
                    }
                }
            ]
        });

        // Handle tool calls
        let finalReply = "";
        let actionRequired = false;
        let actionType = null;
        let metadata = {};
        let options = [];

        // Note: For now we handle one tool call per turn for simplicity in the integration
        // We can loop if we want multi-step reasoning
        for (const block of response.content) {
            if (block.type === 'text') {
                finalReply += block.text;
            } else if (block.type === 'tool_use') {
                const toolName = block.name;
                const toolInput = block.input;
                console.log(`[Claude] Tool Use: ${toolName}`, toolInput);

                if (toolName === 'search_fbdi_templates') {
                    const templates = await searchTemplates(toolInput.query);
                    actionRequired = true;
                    actionType = 'SCRAPE_TEMPLATE';
                    metadata = { templates, searchQuery: toolInput.query };
                    
                    if (templates.length > 0) {
                        finalReply += `\n\nI've found these templates:`;
                        options = templates.map(t => ({
                            label: `Download ${t.name}`,
                            value: 'download',
                            url: t.downloadUrl || t.fullUrl
                        }));
                    }
                } else if (toolName === 'search_models') {
                    return { tool_use: block };
                } else if (toolName === 'get_model_architecture') {
                    return { tool_use: block };
                } else if (toolName === 'get_table_columns') {
                    return { tool_use: block };
                } else if (toolName === 'get_model_extractions') {
                    return { tool_use: block };
                }
            }
        }

        // If no text was returned but tool was used, we still need a reply
        if (!finalReply && actionRequired) {
            finalReply = "I've searched for the templates you requested.";
        }

        return {
            reply: finalReply,
            action_required: actionRequired,
            action_type: actionType,
            metadata: metadata,
            options: options
        };

    } catch (error) {
        console.error('[Claude] Assistant Chat Error:', error);
        return {
            reply: "I'm sorry, I encountered an error. The model ID 'claude-opus-4-6' might not be recognized by the API yet or the key is invalid.",
            action_required: false,
            error: error.message
        };
    }
}

module.exports = {
    processAssistantChat
};
