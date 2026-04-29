/* server/services/templateScraper.js */
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrapes Oracle documentation for FBDI templates.
 * Currently focuses on Financials 24A as a default, but can be expanded.
 */
async function searchTemplates(query) {
    if (!query) return [];

    // Common Oracle Cloud FBDI Documentation Modules
    const modules = [
        { name: 'Financials', base: 'https://docs.oracle.com/en/cloud/saas/financials/26a/oefbp' },
        { name: 'Procurement', base: 'https://docs.oracle.com/en/cloud/saas/procurement/26a/oefbp' },
        { name: 'SCM', base: 'https://docs.oracle.com/en/cloud/saas/supply-chain-management/26a/oefbp' },
        { name: 'Project Management', base: 'https://docs.oracle.com/en/cloud/saas/project-management/26a/oefbp' }
    ];


    const allResults = [];

    for (const mod of modules) {
        const indexUrl = `${mod.base}/index.html`;
        try {
            console.log(`[Scraper] Searching ${mod.name} at: ${indexUrl}`);
            const response = await axios.get(indexUrl);
            const $ = cheerio.load(response.data);

            const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

            $('a').each((i, el) => {
                const text = $(el).text().trim().toLowerCase();
                const href = $(el).attr('href');

                if (!href || href.startsWith('#') || href.includes('javascript:')) return;

                const isMatch = queryWords.every(word => text.includes(word) || href.includes(word)) ||
                    text.includes(query.toLowerCase()) ||
                    href.includes(query.toLowerCase());

                if (isMatch) {
                    allResults.push({
                        name: $(el).text().trim(),
                        module: mod.name,
                        relativeUrl: href,
                        fullUrl: href.startsWith('http') ? href : `${mod.base}/${href}`,
                        baseUrl: mod.base
                    });
                }
            });
        } catch (err) {
            console.warn(`[Scraper] Failed to search ${mod.name} module: ${err.message}`);
        }
    }

    const topResults = allResults.slice(0, 5); // Pick top 5 across all modules

    for (let res of topResults) {
        try {
            console.log(`[Scraper] Fetching detail page for: ${res.name} at ${res.fullUrl}`);
            const detailRes = await axios.get(res.fullUrl);
            const $detail = cheerio.load(detailRes.data);

            // Look for links ending in .xlsm or with "Template" in text
            $detail('a').each((i, el) => {
                const dText = $detail(el).text();
                const dHref = $detail(el).attr('href');

                if (dHref && dHref.endsWith('.xlsm')) {
                    res.downloadUrl = dHref.startsWith('http') ? dHref : `${res.baseUrl}/${dHref}`;
                    res.templateName = dText.trim();
                }
            });
        } catch (err) {
            console.error(`[Scraper] Failed to fetch detail for ${res.name}:`, err.message);
        }
    }

    return topResults;
}

module.exports = {
    searchTemplates
};
