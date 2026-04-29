/* server/test_oci_assistant.js */
require('dotenv').config();
const { processAssistantChatOCI } = require('./services/assistantService');

async function testOciAssistant() {
    console.log('\n--- Testing OCI Cohere Assistant ---');
    const msg = "How can I help you with the FBDI assistant?";
    try {
        const result = await processAssistantChatOCI(msg, { models: [] });
        console.log('OCI Response:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('OCI Test Failed:', err);
    }
}

testOciAssistant();
