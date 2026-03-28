#!/usr/bin/env python3
"""
Night Shift Scanner — NoConflict repo health scanner for GitHub.

Fetches popular repos from GitHub API, runs readiness checks via API,
scores them on a 0-100 scale, and saves results for the site dashboard.

Usage:
    python3 scripts/nightshift-scan.py --count 200
    python3 scripts/nightshift-scan.py --count 50 --category ai
    python3 scripts/nightshift-scan.py --category trending --count 30
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
RESULTS_PATH = REPO_ROOT / "site" / "data" / "results.json"
STATS_PATH = REPO_ROOT / "site" / "data" / "stats.json"

# ── GitHub API ─────────────────────────────────────────────────────────────────

GITHUB_API = "https://api.github.com"
TOKEN = os.environ.get("GITHUB_TOKEN", "")

# Rate limit tracking
_rate_remaining = 60
_rate_reset = 0


def gh_headers():
    """Build headers for GitHub API requests."""
    h = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "noconflict-nightshift/1.0",
    }
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h


def gh_get(url, params=None):
    """Make a GET request to GitHub API with rate limit handling."""
    global _rate_remaining, _rate_reset

    if _rate_remaining <= 2:
        wait = max(0, _rate_reset - time.time()) + 1
        if wait > 0:
            log(f"  [rate-limit] waiting {wait:.0f}s for reset...")
            time.sleep(wait)

    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    req = urllib.request.Request(url, headers=gh_headers())

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                _rate_remaining = int(resp.headers.get("X-RateLimit-Remaining", 60))
                _rate_reset = int(resp.headers.get("X-RateLimit-Reset", 0))
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 403:
                reset = int(e.headers.get("X-RateLimit-Reset", 0))
                wait = max(0, reset - time.time()) + 2
                log(f"  [rate-limit] 403 — waiting {wait:.0f}s (attempt {attempt + 1}/3)")
                _rate_reset = reset
                _rate_remaining = 0
                time.sleep(wait)
            elif e.code == 422:
                log(f"  [error] 422 Unprocessable Entity for {url}")
                return None
            elif e.code == 404:
                return None
            else:
                log(f"  [error] HTTP {e.code} for {url}")
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    return None
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"  [error] {e} (attempt {attempt + 1}/3)")
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                return None
    return None


# ── Logging ────────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


# ── Search Queries ─────────────────────────────────────────────────────────────

CATEGORIES = {
    "typescript": {
        "q": "language:typescript stars:>5000",
        "sort": "stars",
        "label": "TypeScript",
    },
    "python": {
        "q": "language:python stars:>5000",
        "sort": "stars",
        "label": "Python",
    },
    "react": {
        "q": "topic:react OR topic:nextjs stars:>3000",
        "sort": "stars",
        "label": "React / Next.js",
    },
    "ai": {
        "q": "topic:machine-learning OR topic:artificial-intelligence OR topic:llm stars:>2000",
        "sort": "stars",
        "label": "AI / ML",
    },
    "tools": {
        "q": "topic:developer-tools OR topic:devtools OR topic:cli stars:>3000",
        "sort": "stars",
        "label": "Developer Tools",
    },
    "trending": {
        "q": "stars:>100 pushed:>{week_ago}",
        "sort": "stars",
        "label": "Trending (last week)",
    },
}


def build_search_queries(category=None, count=200):
    """Build search queries, distributing count across categories."""
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

    if category:
        cats = {category: CATEGORIES[category]}
        per_cat = count
    else:
        cats = dict(CATEGORIES)
        per_cat = max(10, count // len(cats))

    queries = []
    for name, spec in cats.items():
        q = spec["q"].replace("{week_ago}", week_ago)
        # GitHub search returns max 100 per page, cap pages
        pages = min(3, (per_cat + 29) // 30)
        for page in range(1, pages + 1):
            queries.append({
                "category": name,
                "label": spec["label"],
                "params": {
                    "q": q,
                    "sort": spec["sort"],
                    "order": "desc",
                    "per_page": 30,
                    "page": page,
                },
                "target": per_cat,
            })

    return queries


# ── Repo Scanning ──────────────────────────────────────────────────────────────

# Category weights (mirrors readiness-scanner.ts)
CATEGORY_WEIGHTS = {
    "security": 30,
    "stability": 25,
    "deployment": 20,
    "quality": 15,
    "dependencies": 10,
}

SEVERITY_DEDUCTIONS = {
    "critical": 30,
    "warning": 15,
    "info": 8,
}


def score_grade(score):
    """Convert numeric score to letter grade."""
    if score >= 95:
        return "A+"
    elif score >= 90:
        return "A"
    elif score >= 85:
        return "A-"
    elif score >= 80:
        return "B+"
    elif score >= 75:
        return "B"
    elif score >= 70:
        return "B-"
    elif score >= 65:
        return "C+"
    elif score >= 60:
        return "C"
    elif score >= 55:
        return "C-"
    elif score >= 50:
        return "D"
    else:
        return "F"


def scan_repo(owner, repo):
    """
    Scan a GitHub repo using the API. Uses max 5-6 API calls:
      1. GET /repos/{owner}/{repo} — metadata
      2. GET /repos/{owner}/{repo}/contents — root file listing
      3. GET /repos/{owner}/{repo}/contents/package.json — deps check (if exists)
      4. GET /repos/{owner}/{repo}/contents/.gitignore — security check (if exists)
      5. GET /repos/{owner}/{repo}/languages — language breakdown
      6. GET /repos/{owner}/{repo}/community/profile — community health (optional)
    """
    full_name = f"{owner}/{repo}"
    findings = {"security": [], "stability": [], "deployment": [], "quality": [], "dependencies": []}

    # ── 1. Repo metadata ──
    meta = gh_get(f"{GITHUB_API}/repos/{full_name}")
    if not meta:
        return None

    # ── 2. Root contents ──
    contents = gh_get(f"{GITHUB_API}/repos/{full_name}/contents")
    if not contents or not isinstance(contents, list):
        contents = []

    root_files = {item["name"]: item for item in contents if item.get("type") == "file"}
    root_dirs = {item["name"] for item in contents if item.get("type") == "dir"}

    # ── SECURITY CHECKS ──

    has_env = ".env" in root_files
    has_gitignore = ".gitignore" in root_files
    has_env_example = ".env.example" in root_files

    if has_env and not has_gitignore:
        findings["security"].append({
            "severity": "critical",
            "message": ".env file exists without .gitignore protection",
        })

    if has_env and has_gitignore:
        # Check .gitignore content (API call 4 — conditional)
        gi_data = gh_get(f"{GITHUB_API}/repos/{full_name}/contents/.gitignore")
        if gi_data and gi_data.get("encoding") == "base64":
            import base64
            gi_content = base64.b64decode(gi_data["content"]).decode("utf-8", errors="replace")
            lines = [l.strip() for l in gi_content.split("\n")]
            if ".env" not in lines and ".env*" not in lines:
                findings["security"].append({
                    "severity": "critical",
                    "message": ".env not listed in .gitignore",
                })
    elif not has_gitignore and len(root_files) > 3:
        findings["security"].append({
            "severity": "warning",
            "message": "No .gitignore file found",
        })

    # Check for security policy
    has_security_md = "SECURITY.md" in root_files
    has_security_dir = ".github" in root_dirs
    if not has_security_md:
        findings["security"].append({
            "severity": "info",
            "message": "No SECURITY.md — no vulnerability disclosure policy",
        })

    # ── STABILITY CHECKS ──

    has_ci = ".github" in root_dirs
    has_tests = any(d in root_dirs for d in ("tests", "test", "__tests__", "spec"))
    has_dockerfile = "Dockerfile" in root_files or "docker-compose.yml" in root_files or "docker-compose.yaml" in root_files

    if not has_ci:
        findings["stability"].append({
            "severity": "warning",
            "message": "No .github directory — likely no CI/CD pipeline",
        })

    if not has_tests:
        findings["stability"].append({
            "severity": "warning",
            "message": "No test directory found (tests/, test/, __tests__/, spec/)",
        })

    # Check if archived or unmaintained
    if meta.get("archived"):
        findings["stability"].append({
            "severity": "critical",
            "message": "Repository is archived — no longer maintained",
        })

    # Check last push date
    pushed_at = meta.get("pushed_at", "")
    if pushed_at:
        try:
            last_push = datetime.fromisoformat(pushed_at.replace("Z", "+00:00"))
            days_since = (datetime.now(timezone.utc) - last_push).days
            if days_since > 365:
                findings["stability"].append({
                    "severity": "warning",
                    "message": f"Last push {days_since} days ago — possibly unmaintained",
                })
            elif days_since > 180:
                findings["stability"].append({
                    "severity": "info",
                    "message": f"Last push {days_since} days ago",
                })
        except (ValueError, TypeError):
            pass

    # ── DEPLOYMENT CHECKS ──

    # Check for deployment configs
    deploy_configs = [
        "vercel.json", "netlify.toml", "fly.toml", "railway.json",
        "Procfile", "app.yaml", "render.yaml", "Dockerfile",
        "docker-compose.yml", "docker-compose.yaml",
    ]
    has_deploy_config = any(f in root_files for f in deploy_configs)

    if not has_deploy_config and not has_dockerfile:
        findings["deployment"].append({
            "severity": "info",
            "message": "No deployment configuration detected",
        })

    if has_env and not has_env_example:
        findings["deployment"].append({
            "severity": "warning",
            "message": "Has .env but no .env.example for team onboarding",
        })

    # ── 3. Package.json check (API call 3 — conditional) ──

    has_package_json = "package.json" in root_files
    has_requirements = "requirements.txt" in root_files or "pyproject.toml" in root_files or "setup.py" in root_files
    has_cargo = "Cargo.toml" in root_files
    has_go_mod = "go.mod" in root_files

    if has_package_json:
        pkg_data = gh_get(f"{GITHUB_API}/repos/{full_name}/contents/package.json")
        if pkg_data and pkg_data.get("encoding") == "base64":
            import base64
            try:
                pkg = json.loads(base64.b64decode(pkg_data["content"]).decode("utf-8"))
                scripts = pkg.get("scripts", {})

                if not scripts.get("build"):
                    findings["deployment"].append({
                        "severity": "warning",
                        "message": "No build script in package.json",
                    })

                if not scripts.get("start") and not scripts.get("dev"):
                    findings["deployment"].append({
                        "severity": "info",
                        "message": "No start or dev command in package.json",
                    })

                if not scripts.get("test") and not scripts.get("test:unit"):
                    findings["stability"].append({
                        "severity": "info",
                        "message": "No test script in package.json",
                    })

                # ── DEPENDENCIES CHECKS ──
                lock_files = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"]
                has_lock = any(f in root_files for f in lock_files)
                if not has_lock:
                    findings["dependencies"].append({
                        "severity": "warning",
                        "message": "No lock file found",
                    })

                all_deps = {}
                all_deps.update(pkg.get("dependencies", {}))
                all_deps.update(pkg.get("devDependencies", {}))

                wildcard_count = 0
                for name, version in all_deps.items():
                    if version in ("*", "latest"):
                        wildcard_count += 1
                if wildcard_count > 0:
                    findings["dependencies"].append({
                        "severity": "warning",
                        "message": f"{wildcard_count} dependencies use wildcard or 'latest' version",
                    })

                dep_count = len(all_deps)
                if dep_count > 200:
                    findings["dependencies"].append({
                        "severity": "info",
                        "message": f"Large dependency tree: {dep_count} packages",
                    })

            except (json.JSONDecodeError, KeyError):
                findings["deployment"].append({
                    "severity": "critical",
                    "message": "Malformed package.json",
                })

    elif has_requirements or has_cargo or has_go_mod:
        # Non-JS project — lighter dep checks
        pass
    else:
        findings["dependencies"].append({
            "severity": "info",
            "message": "No recognized dependency manifest found",
        })

    # ── QUALITY CHECKS ──

    has_readme = "README.md" in root_files or "readme.md" in root_files or "README" in root_files
    has_license = "LICENSE" in root_files or "LICENSE.md" in root_files or "LICENCE" in root_files
    has_contributing = "CONTRIBUTING.md" in root_files
    has_changelog = "CHANGELOG.md" in root_files or "HISTORY.md" in root_files

    if not has_readme:
        findings["quality"].append({
            "severity": "warning",
            "message": "No README.md found",
        })

    if not has_license:
        findings["quality"].append({
            "severity": "warning",
            "message": "No LICENSE file — unclear usage rights",
        })

    if not has_contributing and meta.get("stargazers_count", 0) > 1000:
        findings["quality"].append({
            "severity": "info",
            "message": "Popular repo without CONTRIBUTING.md",
        })

    # Check open issues — absolute and ratio
    open_issues = meta.get("open_issues_count", 0)
    stars = meta.get("stargazers_count", 0)

    if open_issues > 5000:
        findings["stability"].append({
            "severity": "critical",
            "message": f"{open_issues:,} open issues — massive maintenance backlog",
        })
    elif open_issues > 1000:
        findings["stability"].append({
            "severity": "warning",
            "message": f"{open_issues:,} open issues — significant backlog",
        })
    elif open_issues > 300:
        findings["stability"].append({
            "severity": "info",
            "message": f"{open_issues:,} open issues",
        })

    if stars > 0 and open_issues / max(stars, 1) > 0.1:
        findings["quality"].append({
            "severity": "warning",
            "message": f"High issue-to-star ratio: {open_issues} issues / {stars} stars ({open_issues/stars*100:.1f}%)",
        })
    elif stars > 0 and open_issues / max(stars, 1) > 0.03:
        findings["quality"].append({
            "severity": "info",
            "message": f"Elevated issue ratio: {open_issues} issues / {stars} stars ({open_issues/stars*100:.1f}%)",
        })

    # Repo size / complexity penalty
    size_kb = meta.get("size", 0)
    if size_kb > 500000:  # 500MB+
        findings["quality"].append({
            "severity": "warning",
            "message": f"Very large repository: {size_kb // 1024}MB — deploy/CI overhead",
        })
    elif size_kb > 100000:  # 100MB+
        findings["quality"].append({
            "severity": "info",
            "message": f"Large repository: {size_kb // 1024}MB",
        })

    # Fork count as maintenance signal (more forks = more potential conflicts)
    forks = meta.get("forks_count", 0)
    if forks > 10000:
        findings["stability"].append({
            "severity": "info",
            "message": f"{forks:,} forks — high merge conflict potential across ecosystem",
        })

    # ── SCORING ──

    category_scores = {}
    total_issues = 0
    for cat, cat_findings in findings.items():
        score = 100
        for f in cat_findings:
            score -= SEVERITY_DEDUCTIONS.get(f["severity"], 0)
        category_scores[cat] = max(0, min(100, score))
        total_issues += len(cat_findings)

    total_weight = sum(CATEGORY_WEIGHTS.values())
    overall = round(
        sum(category_scores[cat] * CATEGORY_WEIGHTS[cat] for cat in CATEGORY_WEIGHTS)
        / total_weight
    )
    overall = max(0, min(100, overall))

    # ── 5. Languages (API call 5) ──
    languages = gh_get(f"{GITHUB_API}/repos/{full_name}/languages")
    primary_language = meta.get("language", "Unknown")
    top_languages = []
    if languages and isinstance(languages, dict):
        total_bytes = sum(languages.values())
        if total_bytes > 0:
            top_languages = [
                {"name": lang, "percent": round(bytes_ / total_bytes * 100, 1)}
                for lang, bytes_ in sorted(languages.items(), key=lambda x: -x[1])[:5]
            ]

    return {
        "repo": full_name,
        "name": repo,
        "owner": owner,
        "description": (meta.get("description") or "")[:200],
        "url": meta.get("html_url", f"https://github.com/{full_name}"),
        "stars": stars,
        "forks": meta.get("forks_count", 0),
        "open_issues": open_issues,
        "language": primary_language,
        "languages": top_languages,
        "topics": meta.get("topics", [])[:10],
        "archived": meta.get("archived", False),
        "pushed_at": pushed_at,
        "scores": category_scores,
        "overall": overall,
        "grade": score_grade(overall),
        "total_issues": total_issues,
        "findings": [
            {"category": cat, **f}
            for cat, flist in findings.items()
            for f in flist
        ],
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Fetch Repos ────────────────────────────────────────────────────────────────

def fetch_repos(category=None, count=200):
    """Fetch repos from GitHub search API."""
    queries = build_search_queries(category, count)
    seen = set()
    repos = []

    for q in queries:
        if len(repos) >= count:
            break

        log(f"  Searching: {q['label']} (page {q['params']['page']})")
        data = gh_get(f"{GITHUB_API}/search/repositories", q["params"])

        if not data or "items" not in data:
            log(f"  [warn] No results for {q['label']}")
            continue

        for item in data["items"]:
            full_name = item["full_name"]
            if full_name in seen:
                continue
            seen.add(full_name)
            repos.append({
                "owner": item["owner"]["login"],
                "repo": item["name"],
                "full_name": full_name,
                "category": q["category"],
            })

            if len(repos) >= count:
                break

        # Be nice to the API
        time.sleep(0.5)

    return repos[:count]


# ── Persistence ────────────────────────────────────────────────────────────────

def load_results():
    """Load existing results from disk."""
    if RESULTS_PATH.exists():
        try:
            return json.loads(RESULTS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return []
    return []


def save_results(results):
    """Save results to disk, deduplicating by repo name."""
    seen = {}
    for r in results:
        seen[r["repo"]] = r  # later entries overwrite older ones
    deduped = list(seen.values())
    # Sort by overall score descending
    deduped.sort(key=lambda r: r.get("overall", 0), reverse=True)
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(deduped, indent=2))
    return deduped


def update_stats(results, new_scans, new_issues):
    """Update running stats."""
    stats = {
        "total_scans": 0,
        "total_issues_found": 0,
        "repos_scanned": 0,
        "last_updated": "",
    }
    if STATS_PATH.exists():
        try:
            stats = json.loads(STATS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    stats["total_scans"] += new_scans
    stats["total_issues_found"] += new_issues
    stats["repos_scanned"] = len(results)
    stats["last_updated"] = datetime.now(timezone.utc).isoformat()

    # Aggregate grade distribution
    grades = {}
    for r in results:
        g = r.get("grade", "?")
        grades[g] = grades.get(g, 0) + 1
    stats["grade_distribution"] = grades

    # Average score
    if results:
        stats["average_score"] = round(sum(r.get("overall", 0) for r in results) / len(results), 1)

    STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATS_PATH.write_text(json.dumps(stats, indent=2))
    return stats


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="NoConflict Night Shift Scanner")
    parser.add_argument("--count", type=int, default=200, help="Number of repos to scan (default: 200)")
    parser.add_argument("--category", choices=list(CATEGORIES.keys()), default=None,
                        help="Focus on a specific category")
    parser.add_argument("--dry-run", action="store_true", help="Fetch repos but don't scan")
    args = parser.parse_args()

    log("=" * 60)
    log("NoConflict Night Shift Scanner")
    log("=" * 60)
    log(f"Target: {args.count} repos")
    log(f"Category: {args.category or 'all'}")
    log(f"Auth: {'token' if TOKEN else 'unauthenticated (60 req/hr)'}")
    log(f"Rate limit: {'5000' if TOKEN else '60'} req/hr")
    log("")

    # Fetch repos
    log("[1/3] Fetching repos from GitHub Search...")
    repos = fetch_repos(category=args.category, count=args.count)
    log(f"  Found {len(repos)} unique repos")

    if args.dry_run:
        for r in repos:
            print(f"  {r['full_name']} ({r['category']})")
        return

    # Scan each repo
    log("")
    log(f"[2/3] Scanning {len(repos)} repos...")
    existing = load_results()
    new_results = []
    total_new_issues = 0
    scanned = 0
    failed = 0

    for i, repo_info in enumerate(repos):
        owner = repo_info["owner"]
        repo = repo_info["repo"]
        pct = round((i + 1) / len(repos) * 100)

        log(f"  [{i+1}/{len(repos)}] ({pct}%) {owner}/{repo}")

        result = scan_repo(owner, repo)
        if result:
            result["category"] = repo_info["category"]
            new_results.append(result)
            total_new_issues += result["total_issues"]
            scanned += 1
            log(f"    -> {result['overall']}/100 ({result['grade']}) | {result['total_issues']} issues")
        else:
            failed += 1
            log(f"    -> FAILED (skipped)")

        # Throttle between scans to stay under rate limit
        # Each scan uses ~3-5 API calls. At 5000/hr with token, that's ~1000 repos/hr.
        # Without token (60/hr), ~12-20 repos/hr. Add delay accordingly.
        if TOKEN:
            time.sleep(0.3)
        else:
            time.sleep(3.0)

    # Save results
    log("")
    log("[3/3] Saving results...")
    all_results = existing + new_results
    saved = save_results(all_results)
    stats = update_stats(saved, scanned, total_new_issues)

    log("")
    log("=" * 60)
    log("Night Shift Scan Complete")
    log("=" * 60)
    log(f"  Scanned:  {scanned}")
    log(f"  Failed:   {failed}")
    log(f"  Issues:   {total_new_issues}")
    log(f"  Total DB: {len(saved)} repos")
    log(f"  Avg score: {stats.get('average_score', 'N/A')}")
    log(f"  Grades:   {json.dumps(stats.get('grade_distribution', {}))}")
    log(f"  Saved to: {RESULTS_PATH}")
    log("")


if __name__ == "__main__":
    main()
