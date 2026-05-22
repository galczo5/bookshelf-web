// Placeholder for the AI-enrichment background worker.
// Real worker code lands when the import → enrichment pipeline is wired
// (see context/foundation/prd.md, FR-003 and the 30s enrichment NFR).

const startedAt = new Date().toISOString();
console.log(`[bookshelf-worker] placeholder started at ${startedAt}; idling`);

setInterval(() => {
  console.log(`[bookshelf-worker] heartbeat ${new Date().toISOString()}`);
}, 60_000);
