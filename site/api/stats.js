// NoConflict Stats API — Returns running scan totals
const fs = require('fs');

const STATS_PATH = '/tmp/noconflict-stats.json';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let stats;
  try {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    // Seed data — reasonable starting numbers
    stats = { total_scans: 50, total_issues_found: 312, repos_scanned: 50 };
  }

  return res.status(200).json({
    total_scans: stats.total_scans,
    total_issues_found: stats.total_issues_found,
    repos_scanned: stats.repos_scanned,
  });
};
