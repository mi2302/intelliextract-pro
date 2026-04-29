/* server/test_assistant.js */
require('dotenv').config();
const { processAssistantChat } = require('./services/claudeService');
const { searchTemplates } = require('./services/templateScraper');

async function testScraper() {
    console.log('--- Testing Scraper ---');
    const results = await searchTemplates('Journal');
    console.log('Scrape Results:', JSON.stringify(results, null, 2));
}

async function testClaude() {
    console.log('\n--- Testing Claude Assistant ---');
    const msg = "Find the Supplier Import template";
    const result = await processAssistantChat(msg, { models: [] });
    console.log('Claude Response:', JSON.stringify(result, null, 2));
}

async function runTests() {
    try {
        await testScraper();
        await testClaude();
        console.log('\nTests completed successfully!');
    } catch (err) {
        console.error('Test Failed:', err);
    }
}

runTests();
