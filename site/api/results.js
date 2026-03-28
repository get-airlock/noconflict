// NoConflict Results API — Returns recent scan summaries
const fs = require('fs');

const RESULTS_PATH = '/tmp/noconflict-results.json';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let results;
  try {
    results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  } catch {
    results = [];
  }

  return res.status(200).json(results);
};
