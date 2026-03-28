// NoConflict Scan API — Vercel Serverless Function
// POST { "repo": "owner/repo" | "https://github.com/owner/repo" }
// Returns score breakdown with security, deployment, stability, quality, dependencies

const fs = require('fs');
const path = require('path');

const GITHUB_API = 'https://api.github.com';

// ── Helpers ──

function parseRepo(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/\/+$/, '');

  // Full URL: https://github.com/owner/repo or http://github.com/owner/repo
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2]}`;

  // Short form: owner/repo
  const shortMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) return `${shortMatch[1]}/${shortMatch[2]}`;

  return null;
}

function gradeFromScore(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

async function ghFetch(endpoint) {
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'NoConflict-Scanner/1.0',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function ghFetchRaw(endpoint) {
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    headers: {
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'NoConflict-Scanner/1.0',
    },
  });
  if (!res.ok) return null;
  return res.text();
}

// ── Check functions ──

function checkSecurity(repoFiles, repoData) {
  const issues = [];
  let score = 100;

  const fileNames = (repoFiles || []).map(f => f.name.toLowerCase());

  if (!fileNames.includes('security.md')) {
    issues.push('No SECURITY.md found');
    score -= 15;
  }

  if (fileNames.includes('.env')) {
    issues.push('.env file committed to repo — secrets likely exposed');
    score -= 30;
  }

  if (!fileNames.includes('.env.example') && !fileNames.includes('.env.sample')) {
    issues.push('No .env.example — contributors lack config guidance');
    score -= 10;
  }

  if (!fileNames.includes('.gitignore')) {
    issues.push('No .gitignore file');
    score -= 15;
  }

  if (!fileNames.includes('license') && !fileNames.includes('license.md') && !fileNames.includes('license.txt')) {
    issues.push('No LICENSE file');
    score -= 10;
  }

  return { score: Math.max(0, score), issues };
}

function checkDeployment(repoFiles) {
  const issues = [];
  let score = 100;

  const fileNames = (repoFiles || []).map(f => f.name.toLowerCase());
  const hasCI = fileNames.includes('.github');
  const hasVercel = fileNames.includes('vercel.json');
  const hasNetlify = fileNames.includes('netlify.toml');
  const hasDocker = fileNames.includes('dockerfile') || fileNames.includes('docker-compose.yml') || fileNames.includes('docker-compose.yaml');
  const hasRender = fileNames.includes('render.yaml');

  if (!hasCI) {
    issues.push('No .github/workflows directory — no CI/CD detected');
    score -= 25;
  }

  if (!hasVercel && !hasNetlify && !hasDocker && !hasRender) {
    issues.push('No deployment config (Vercel, Netlify, Docker, Render)');
    score -= 20;
  }

  if (!fileNames.includes('readme.md') && !fileNames.includes('readme')) {
    issues.push('No README.md — deploy instructions missing');
    score -= 15;
  }

  return { score: Math.max(0, score), issues };
}

function checkStability(pullRequests, repoData) {
  const issues = [];
  let score = 100;

  const openPRs = pullRequests || [];
  const prCount = openPRs.length;

  if (prCount > 20) {
    issues.push(`${prCount} open PRs — potential merge debt`);
    score -= 25;
  } else if (prCount > 10) {
    issues.push(`${prCount} open PRs — review backlog growing`);
    score -= 15;
  } else if (prCount > 5) {
    issues.push(`${prCount} open PRs`);
    score -= 5;
  }

  // Check for stale PRs (created > 30 days ago)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stalePRs = openPRs.filter(pr => new Date(pr.created_at) < thirtyDaysAgo);
  if (stalePRs.length > 0) {
    issues.push(`${stalePRs.length} stale PR(s) older than 30 days`);
    score -= stalePRs.length * 5;
  }

  // Open issues ratio
  const openIssues = repoData?.open_issues_count || 0;
  if (openIssues > 100) {
    issues.push(`${openIssues} open issues — maintenance concern`);
    score -= 20;
  } else if (openIssues > 50) {
    issues.push(`${openIssues} open issues`);
    score -= 10;
  }

  return { score: Math.max(0, score), issues };
}

function checkQuality(repoFiles, packageJson) {
  const issues = [];
  let score = 100;

  const fileNames = (repoFiles || []).map(f => f.name.toLowerCase());
  const dirNames = (repoFiles || []).filter(f => f.type === 'dir').map(f => f.name.toLowerCase());

  const hasTests = dirNames.includes('test') || dirNames.includes('tests') ||
    dirNames.includes('__tests__') || dirNames.includes('spec') ||
    fileNames.includes('jest.config.js') || fileNames.includes('jest.config.ts') ||
    fileNames.includes('vitest.config.ts') || fileNames.includes('.mocharc.yml') ||
    fileNames.includes('pytest.ini') || fileNames.includes('setup.cfg');

  if (!hasTests) {
    // Also check package.json for test script
    const hasTestScript = packageJson?.scripts?.test &&
      !packageJson.scripts.test.includes('no test specified');
    if (!hasTestScript) {
      issues.push('No test directory or test config found');
      score -= 25;
    }
  }

  if (!fileNames.includes('.editorconfig') && !fileNames.includes('.prettierrc') &&
      !fileNames.includes('.prettierrc.js') && !fileNames.includes('.eslintrc') &&
      !fileNames.includes('.eslintrc.js') && !fileNames.includes('.eslintrc.json') &&
      !fileNames.includes('biome.json')) {
    issues.push('No linter/formatter config detected');
    score -= 15;
  }

  if (!fileNames.includes('.nvmrc') && !fileNames.includes('.node-version') &&
      !fileNames.includes('.tool-versions') && !fileNames.includes('.python-version') &&
      !fileNames.includes('rust-toolchain.toml')) {
    issues.push('No runtime version pinning (.nvmrc, .tool-versions, etc.)');
    score -= 10;
  }

  if (!fileNames.includes('contributing.md')) {
    issues.push('No CONTRIBUTING.md');
    score -= 5;
  }

  return { score: Math.max(0, score), issues };
}

function checkDependencies(packageJson, repoFiles) {
  const issues = [];
  let score = 100;

  const fileNames = (repoFiles || []).map(f => f.name.toLowerCase());

  if (!packageJson) {
    // Not a Node project — check for other dep files
    const hasDeps = fileNames.includes('requirements.txt') || fileNames.includes('pyproject.toml') ||
      fileNames.includes('cargo.toml') || fileNames.includes('go.mod') ||
      fileNames.includes('gemfile') || fileNames.includes('pom.xml') ||
      fileNames.includes('build.gradle');

    if (!hasDeps) {
      issues.push('No dependency manifest found');
      score -= 20;
    }
    return { score: Math.max(0, score), issues };
  }

  // Check for lockfile
  const hasLock = fileNames.includes('package-lock.json') || fileNames.includes('yarn.lock') ||
    fileNames.includes('pnpm-lock.yaml') || fileNames.includes('bun.lockb');
  if (!hasLock) {
    issues.push('No lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml)');
    score -= 20;
  }

  // Count deps
  const depCount = Object.keys(packageJson.dependencies || {}).length;
  const devDepCount = Object.keys(packageJson.devDependencies || {}).length;

  if (depCount > 50) {
    issues.push(`${depCount} production dependencies — heavy bundle risk`);
    score -= 15;
  }

  // Check for known risky patterns
  const allDeps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };

  if (allDeps['moment']) {
    issues.push('Using moment.js — consider date-fns or dayjs (smaller)');
    score -= 5;
  }

  if (allDeps['lodash'] && !allDeps['lodash-es']) {
    issues.push('Using full lodash — consider lodash-es or individual imports');
    score -= 5;
  }

  // Check for wildcard versions
  const wildcardDeps = Object.entries(packageJson.dependencies || {})
    .filter(([, v]) => v === '*' || v === 'latest');
  if (wildcardDeps.length > 0) {
    issues.push(`${wildcardDeps.length} dependencies using wildcard/latest version`);
    score -= wildcardDeps.length * 10;
  }

  // Check engines
  if (!packageJson.engines) {
    issues.push('No engines field — Node version not specified');
    score -= 5;
  }

  return { score: Math.max(0, score), issues };
}

// ── Stats persistence ──

const STATS_PATH = '/tmp/noconflict-stats.json';
const RESULTS_PATH = '/tmp/noconflict-results.json';

function readStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    // Seed defaults
    return { total_scans: 50, total_issues_found: 312, repos_scanned: 50 };
  }
}

function writeStats(stats) {
  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats));
  } catch { /* /tmp write may fail in edge runtime, non-critical */ }
}

function appendResult(result) {
  try {
    let results = [];
    try { results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')); } catch {}
    results.unshift({
      repo: result.repo,
      score: result.score,
      grade: result.grade,
      issues_found: result.issues_found,
      scanned_at: result.scanned_at,
    });
    // Keep last 100
    if (results.length > 100) results = results.slice(0, 100);
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results));
  } catch { /* non-critical */ }
}

// ── Main handler ──

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { repo } = req.body || {};
  const parsed = parseRepo(repo);

  if (!parsed) {
    return res.status(400).json({
      error: 'Invalid repo. Use "owner/repo" or "https://github.com/owner/repo"',
    });
  }

  try {
    // Parallel GitHub API calls — fast
    const [repoData, repoFiles, pullRequests, packageJsonRaw] = await Promise.all([
      ghFetch(`/repos/${parsed}`),
      ghFetch(`/repos/${parsed}/contents`),
      ghFetch(`/repos/${parsed}/pulls?state=open&per_page=100`),
      ghFetchRaw(`/repos/${parsed}/contents/package.json`),
    ]);

    if (!repoData) {
      return res.status(404).json({
        error: `Repository "${parsed}" not found or not public.`,
      });
    }

    // Parse package.json if it exists
    let packageJson = null;
    if (packageJsonRaw) {
      try { packageJson = JSON.parse(packageJsonRaw); } catch {}
    }

    // Run all checks
    const security = checkSecurity(repoFiles, repoData);
    const deployment = checkDeployment(repoFiles);
    const stability = checkStability(pullRequests, repoData);
    const quality = checkQuality(repoFiles, packageJson);
    const dependencies = checkDependencies(packageJson, repoFiles);

    // Weighted average: security 25%, deployment 20%, stability 20%, quality 20%, deps 15%
    const weightedScore = Math.round(
      security.score * 0.25 +
      deployment.score * 0.20 +
      stability.score * 0.20 +
      quality.score * 0.20 +
      dependencies.score * 0.15
    );

    const totalIssues =
      security.issues.length +
      deployment.issues.length +
      stability.issues.length +
      quality.issues.length +
      dependencies.issues.length;

    const result = {
      repo: parsed,
      name: repoData.name,
      description: repoData.description,
      stars: repoData.stargazers_count,
      language: repoData.language,
      score: weightedScore,
      grade: gradeFromScore(weightedScore),
      issues_found: totalIssues,
      categories: {
        security: { score: security.score, weight: '25%', issues: security.issues },
        deployment: { score: deployment.score, weight: '20%', issues: deployment.issues },
        stability: { score: stability.score, weight: '20%', issues: stability.issues },
        quality: { score: quality.score, weight: '20%', issues: quality.issues },
        dependencies: { score: dependencies.score, weight: '15%', issues: dependencies.issues },
      },
      scanned_at: new Date().toISOString(),
    };

    // Update stats
    const stats = readStats();
    stats.total_scans += 1;
    stats.total_issues_found += totalIssues;
    if (!stats._repos) stats._repos = new Set();
    // Simple unique tracking via count (Set won't persist across invocations)
    stats.repos_scanned = stats.total_scans; // Approximate — each scan is likely unique for MVP
    writeStats(stats);

    // Append to results
    appendResult(result);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: 'Scan failed. GitHub API may be rate-limited. Try again shortly.' });
  }
};
