#!/usr/bin/env python3
"""
Seed Scanner — One-time seeder for NoConflict scan database.

Scans 50 well-known repos across categories to populate initial data.

Usage:
    python3 scripts/seed-scan-results.py
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Import scan logic from nightshift-scan
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from importlib import import_module

# We can't import nightshift-scan directly (hyphen), so we load it manually
import importlib.util
spec = importlib.util.spec_from_file_location("nightshift_scan", SCRIPT_DIR / "nightshift-scan.py")
ns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ns)

scan_repo = ns.scan_repo
load_results = ns.load_results
save_results = ns.save_results
update_stats = ns.update_stats
log = ns.log
TOKEN = ns.TOKEN

# ── Seed Repos ─────────────────────────────────────────────────────────────────

SEED_REPOS = [
    # React / Frontend
    {"owner": "facebook", "repo": "react", "category": "react"},
    {"owner": "vercel", "repo": "next.js", "category": "react"},
    {"owner": "remix-run", "repo": "remix", "category": "react"},
    {"owner": "sveltejs", "repo": "svelte", "category": "react"},
    {"owner": "vuejs", "repo": "vue", "category": "react"},
    {"owner": "angular", "repo": "angular", "category": "react"},
    {"owner": "solidjs", "repo": "solid", "category": "react"},
    {"owner": "shadcn-ui", "repo": "ui", "category": "react"},

    # TypeScript / JavaScript
    {"owner": "microsoft", "repo": "TypeScript", "category": "typescript"},
    {"owner": "denoland", "repo": "deno", "category": "typescript"},
    {"owner": "oven-sh", "repo": "bun", "category": "typescript"},
    {"owner": "biomejs", "repo": "biome", "category": "typescript"},
    {"owner": "vitejs", "repo": "vite", "category": "typescript"},
    {"owner": "tailwindlabs", "repo": "tailwindcss", "category": "typescript"},
    {"owner": "trpc", "repo": "trpc", "category": "typescript"},
    {"owner": "drizzle-team", "repo": "drizzle-orm", "category": "typescript"},

    # Python
    {"owner": "python", "repo": "cpython", "category": "python"},
    {"owner": "pallets", "repo": "flask", "category": "python"},
    {"owner": "django", "repo": "django", "category": "python"},
    {"owner": "fastapi", "repo": "fastapi", "category": "python"},
    {"owner": "psf", "repo": "requests", "category": "python"},
    {"owner": "pydantic", "repo": "pydantic", "category": "python"},
    {"owner": "python-poetry", "repo": "poetry", "category": "python"},
    {"owner": "astral-sh", "repo": "ruff", "category": "python"},

    # AI / ML
    {"owner": "openai", "repo": "openai-python", "category": "ai"},
    {"owner": "langchain-ai", "repo": "langchain", "category": "ai"},
    {"owner": "huggingface", "repo": "transformers", "category": "ai"},
    {"owner": "pytorch", "repo": "pytorch", "category": "ai"},
    {"owner": "tensorflow", "repo": "tensorflow", "category": "ai"},
    {"owner": "anthropics", "repo": "anthropic-sdk-python", "category": "ai"},
    {"owner": "ollama", "repo": "ollama", "category": "ai"},
    {"owner": "ggerganov", "repo": "llama.cpp", "category": "ai"},
    {"owner": "AUTOMATIC1111", "repo": "stable-diffusion-webui", "category": "ai"},
    {"owner": "run-llama", "repo": "llama_index", "category": "ai"},

    # Developer Tools
    {"owner": "neovim", "repo": "neovim", "category": "tools"},
    {"owner": "ohmyzsh", "repo": "ohmyzsh", "category": "tools"},
    {"owner": "junegunn", "repo": "fzf", "category": "tools"},
    {"owner": "BurntSushi", "repo": "ripgrep", "category": "tools"},
    {"owner": "sharkdp", "repo": "bat", "category": "tools"},
    {"owner": "jesseduffield", "repo": "lazygit", "category": "tools"},
    {"owner": "cli", "repo": "cli", "category": "tools"},
    {"owner": "starship", "repo": "starship", "category": "tools"},

    # Infrastructure / DevOps
    {"owner": "docker", "repo": "compose", "category": "tools"},
    {"owner": "kubernetes", "repo": "kubernetes", "category": "tools"},
    {"owner": "hashicorp", "repo": "terraform", "category": "tools"},
    {"owner": "traefik", "repo": "traefik", "category": "tools"},

    # Databases / Data
    {"owner": "supabase", "repo": "supabase", "category": "tools"},
    {"owner": "prisma", "repo": "prisma", "category": "typescript"},
    {"owner": "redis", "repo": "redis", "category": "tools"},
    {"owner": "postgres", "repo": "postgres", "category": "tools"},
]


def main():
    log("=" * 60)
    log("NoConflict Seed Scanner")
    log("=" * 60)
    log(f"Seeding {len(SEED_REPOS)} well-known repos")
    log(f"Auth: {'token' if TOKEN else 'unauthenticated (60 req/hr)'}")
    log("")

    existing = load_results()
    existing_names = {r["repo"] for r in existing}
    results = []
    total_issues = 0
    scanned = 0
    skipped = 0
    failed = 0

    for i, repo_info in enumerate(SEED_REPOS):
        owner = repo_info["owner"]
        repo = repo_info["repo"]
        full_name = f"{owner}/{repo}"

        if full_name in existing_names:
            log(f"  [{i+1}/{len(SEED_REPOS)}] {full_name} — already scanned, skipping")
            skipped += 1
            continue

        log(f"  [{i+1}/{len(SEED_REPOS)}] Scanning {full_name}...")

        result = scan_repo(owner, repo)
        if result:
            result["category"] = repo_info["category"]
            result["seeded"] = True
            results.append(result)
            total_issues += result["total_issues"]
            scanned += 1
            log(f"    -> {result['overall']}/100 ({result['grade']}) | {result['total_issues']} issues | {result['stars']} stars")
        else:
            failed += 1
            log(f"    -> FAILED")

        # Throttle
        if TOKEN:
            time.sleep(0.5)
        else:
            time.sleep(3.0)

    # Save
    log("")
    log("Saving results...")
    all_results = existing + results
    saved = save_results(all_results)
    stats = update_stats(saved, scanned, total_issues)

    log("")
    log("=" * 60)
    log("Seed Complete")
    log("=" * 60)
    log(f"  Scanned:  {scanned}")
    log(f"  Skipped:  {skipped}")
    log(f"  Failed:   {failed}")
    log(f"  Issues:   {total_issues}")
    log(f"  Total DB: {len(saved)} repos")
    log(f"  Avg score: {stats.get('average_score', 'N/A')}")
    log("")


if __name__ == "__main__":
    main()
