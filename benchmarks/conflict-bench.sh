#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# ConflictBench v1 — NoConflict Severity Router Benchmark
# ═══════════════════════════════════════════════════════════════════
#
# Creates synthetic merge conflict scenarios and scores the severity
# router's classification (GREEN/YELLOW/RED).
#
# Usage:  ./benchmarks/conflict-bench.sh
# ═══════════════════════════════════════════════════════════════════

BENCH_DIR=$(mktemp -d)
PASS=0
FAIL=0
TOTAL=0
SCENARIOS=()

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'
DIM='\033[2m'; BOLD='\033[1m'; RST='\033[0m'

pass() { echo -e "  ${G}✓${RST} $1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
fail() { echo -e "  ${R}✕${RST} $1 ${DIM}(expected: $2, got: $3)${RST}"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }

# ─── Create a repo with a bare remote origin ─────────────────────
mk() {
  local name="$1"
  local d="${BENCH_DIR}/${name}"
  git init -q --bare "${d}-remote" 2>/dev/null
  mkdir -p "${d}" && cd "${d}"
  git init -q 2>/dev/null
  git config user.email "bench@nc.dev"
  git config user.name "Bench"
  git remote add origin "${d}-remote" 2>/dev/null
}

# Commit + push initial state
seal() { git add -A && git commit -q -m "init" && git push -q -u origin main 2>/dev/null; }

# Clone remote, cd into clone
clone_remote() {
  local d="$1"
  git clone -q "${d}-remote" "${d}-clone" 2>/dev/null
  cd "${d}-clone"
  git config user.email "team@nc.dev"
  git config user.name "Teammate"
}

# Commit clone changes, push, return to local
push_remote() {
  local d="$1"; local msg="$2"
  git add -A && git commit -q -m "${msg}" && git push -q origin main 2>/dev/null
  cd "${d}" && git fetch -q origin 2>/dev/null
}

# ─── Severity check (mirrors severity.ts logic) ──────────────────
# The real nc push checks TWO things:
#   1. merge-tree conflicts (actual git conflicts)
#   2. file overlaps between branches (same file edited on both sides)
# This bench replicates both checks.
check() {
  local expected="$1"; local label="$2"
  local has_conflict="false"
  local conflict_count=0
  local total_lines=0
  local overlap_files=0
  local overlap_lines=0

  local current
  current=$(git branch --show-current 2>/dev/null)

  # Check 1: merge-tree dry run (actual conflicts)
  if ! git merge-tree --write-tree "${current}" "origin/main" >/dev/null 2>&1; then
    has_conflict="true"
    conflict_count=$(git merge-tree --write-tree "${current}" "origin/main" 2>&1 | grep -c "CONFLICT" 2>/dev/null || echo "0")
  fi

  # Check 2: file overlap detection (same as findOverlaps in branch-scanner.ts)
  # Find merge base, then check which files both sides changed
  if git rev-parse origin/main &>/dev/null; then
    local merge_base
    merge_base=$(git merge-base "${current}" "origin/main" 2>/dev/null || echo "")
    if [ -n "${merge_base}" ]; then
      local local_files remote_files
      local_files=$(git diff --name-only "${merge_base}" "${current}" 2>/dev/null || echo "")
      remote_files=$(git diff --name-only "${merge_base}" "origin/main" 2>/dev/null || echo "")

      # Find shared files (overlap zones)
      if [ -n "${local_files}" ] && [ -n "${remote_files}" ]; then
        overlap_files=$(comm -12 <(echo "${local_files}" | sort) <(echo "${remote_files}" | sort) | wc -l | tr -d ' ')
        # Count lines changed in overlapping files
        local shared
        shared=$(comm -12 <(echo "${local_files}" | sort) <(echo "${remote_files}" | sort))
        if [ -n "${shared}" ]; then
          while IFS= read -r f; do
            local la lr
            la=$(git diff --numstat "${merge_base}" "${current}" -- "${f}" 2>/dev/null | awk '{print $1+$2}' || echo "0")
            lr=$(git diff --numstat "${merge_base}" "origin/main" -- "${f}" 2>/dev/null | awk '{print $1+$2}' || echo "0")
            overlap_lines=$((overlap_lines + la + lr))
          done <<< "${shared}"
        fi
      fi
    fi

    total_lines=$(git diff --numstat origin/main 2>/dev/null | awk '{s+=$1+$2} END {print s+0}' 2>/dev/null || echo "0")
  fi

  # Check if conflicting changes are trivial (imports, comments, whitespace, braces)
  # Uses awk to avoid macOS grep regex issues
  local trivial_only="true"
  if [ "${has_conflict}" = "true" ] && git rev-parse origin/main &>/dev/null; then
    local diff_content
    diff_content=$(git diff origin/main 2>/dev/null || echo "")
    trivial_only=$(echo "${diff_content}" | awk '
      /^\+\+\+/ || /^---/ { next }
      /^[+-]/ {
        line = substr($0, 2)
        gsub(/^[ \t]+/, "", line)
        gsub(/[ \t]+$/, "", line)
        if (length(line) == 0) next
        if (line ~ /^import /) next
        if (line ~ /^export /) next
        if (line ~ /^\/\//) next
        if (line ~ /^\/\*/) next
        if (line ~ /^\*/) next
        if (line == "{" || line == "}") next
        found = 1
        print "false"
        exit
      }
      END { if (!found) print "true" }
    ')
  fi

  # Classify (mirrors severity.ts logic)
  local sev="green"

  if [ "${has_conflict}" = "true" ]; then
    # Has actual merge conflicts
    if [ "${trivial_only}" = "true" ]; then
      sev="green"  # trivial (imports, whitespace, comments)
    elif [ "${total_lines}" -gt 50 ] || [ "${conflict_count}" -gt 2 ]; then
      sev="red"    # large conflict or many conflict zones
    else
      sev="yellow" # manageable conflict
    fi
  elif [ "${overlap_files}" -gt 0 ] && [ "${trivial_only}" = "false" ]; then
    # No merge conflict but files overlap (both sides edited same files)
    # Flag as yellow if changes are non-trivial
    if [ "${overlap_lines}" -gt 0 ]; then
      sev="yellow"
    fi
  fi

  if [ "${sev}" = "${expected}" ]; then
    pass "${label} → ${expected}"
  else
    fail "${label}" "${expected}" "${sev}"
  fi

  SCENARIOS+=("{\"name\":\"${label}\",\"expected\":\"${expected}\",\"actual\":\"${sev}\",\"conflicts\":${conflict_count},\"lines\":${total_lines},\"overlap_files\":${overlap_files},\"overlap_lines\":${overlap_lines}}")
}

# ═══════════════════════════════════════════════════════════════════
# GREEN SCENARIOS
# ═══════════════════════════════════════════════════════════════════

s01_clean_push() {
  local d="${BENCH_DIR}/s01"
  mk s01
  echo "hello" > file.txt; seal
  echo "local edit" >> file.txt
  git add -A && git commit -q -m "local"
  check "green" "clean push — no divergence"
}

s02_different_files() {
  local d="${BENCH_DIR}/s02"
  mk s02
  echo "a" > a.txt; echo "b" > b.txt; seal
  clone_remote "${d}"
  echo "remote" >> a.txt; push_remote "${d}" "edit a"
  echo "local" >> b.txt; git add -A && git commit -q -m "edit b"
  check "green" "different files — no overlap"
}

s03_whitespace() {
  local d="${BENCH_DIR}/s03"
  mk s03
  printf "function foo() {\n  return 1;\n}\n" > app.js; seal
  clone_remote "${d}"
  printf "function foo() {\n    return 1;\n}\n" > app.js
  push_remote "${d}" "4-space indent"
  printf "function foo() {\n  return 1;\n}\n\n" > app.js
  git add -A && git commit -q -m "trailing newline"
  check "green" "whitespace only"
}

s04_new_files() {
  local d="${BENCH_DIR}/s04"
  mk s04
  echo "base" > base.txt; seal
  clone_remote "${d}"
  echo "remote" > remote-new.txt; push_remote "${d}" "add remote file"
  echo "local" > local-new.txt; git add -A && git commit -q -m "add local file"
  check "green" "new files — no overlap"
}

s05_trivial_import() {
  local d="${BENCH_DIR}/s05"
  mk s05
  cat > app.ts << 'TSEOF'
import { foo } from "./foo";
import { bar } from "./bar";

function main() { console.log(foo(), bar()); }
TSEOF
  seal
  clone_remote "${d}"
  cat > app.ts << 'TSEOF'
import { foo } from "./foo";
import { bar } from "./bar";
import { baz } from "./baz";

function main() { console.log(foo(), bar()); }
TSEOF
  push_remote "${d}" "add baz"
  cat > app.ts << 'TSEOF'
import { foo } from "./foo";
import { bar } from "./bar";
import { qux } from "./qux";

function main() { console.log(foo(), bar()); }
TSEOF
  git add -A && git commit -q -m "add qux"
  check "green" "trivial import conflict"
}

# ═══════════════════════════════════════════════════════════════════
# YELLOW SCENARIOS
# ═══════════════════════════════════════════════════════════════════

s06_same_function() {
  local d="${BENCH_DIR}/s06"
  mk s06
  cat > auth.ts << 'TSEOF'
export function validate(token: string): boolean {
  const d = decode(token);
  if (!d) return false;
  if (d.exp < Date.now()) return false;
  return true;
}
TSEOF
  seal
  # Work on a feature branch
  git checkout -q -b feature/logging
  clone_remote "${d}"
  cat > auth.ts << 'TSEOF'
export function validate(token: string, role?: string): boolean {
  const d = decode(token);
  if (!d) return false;
  if (d.exp < Date.now()) return false;
  if (role && d.role !== role) return false;
  return true;
}
TSEOF
  push_remote "${d}" "add role check"
  cat > auth.ts << 'TSEOF'
export function validate(token: string): boolean {
  const d = decode(token);
  if (!d) { console.warn("bad token"); return false; }
  if (d.exp < Date.now()) { console.warn("expired"); return false; }
  return true;
}
TSEOF
  git add -A && git commit -q -m "add logging"
  check "yellow" "same function — semantic overlap"
}

s07_config_clash() {
  local d="${BENCH_DIR}/s07"
  mk s07
  cat > config.json << 'EOF'
{
  "port": 3000,
  "host": "localhost",
  "database": "postgres://localhost:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "info"
}
EOF
  seal
  git checkout -q -b feature/config-update
  clone_remote "${d}"
  cat > config.json << 'EOF'
{
  "port": 8080,
  "host": "0.0.0.0",
  "database": "postgres://localhost:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "info",
  "features": { "darkMode": true }
}
EOF
  push_remote "${d}" "change port + features"
  cat > config.json << 'EOF'
{
  "port": 3000,
  "host": "localhost",
  "database": "postgres://prod:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "debug"
}
EOF
  git add -A && git commit -q -m "change db + loglevel"
  check "yellow" "config overlap — different keys"
}

s08_migration() {
  local d="${BENCH_DIR}/s08"
  mk s08
  cat > migration.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
EOF
  seal
  git checkout -q -b feature/schema-update
  clone_remote "${d}"
  cat > migration.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);
EOF
  push_remote "${d}" "add username + role"
  cat > migration.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
EOF
  git add -A && git commit -q -m "add phone + avatar"
  check "yellow" "migration — different columns added"
}

# ═══════════════════════════════════════════════════════════════════
# RED SCENARIOS
# ═══════════════════════════════════════════════════════════════════

s09_large_refactor() {
  local d="${BENCH_DIR}/s09"
  mk s09
  { echo "export class UserService {"; for i in $(seq 1 30); do echo "  m${i}() { return ${i}; }"; done; echo "}"; } > svc.ts
  seal
  clone_remote "${d}"
  { echo "export class AccountService {"; for i in $(seq 1 30); do echo "  async get${i}(): Promise<A> { return fetch(${i}); }"; done; echo "}"; } > svc.ts
  push_remote "${d}" "rename class + async"
  { echo "export class UserService {"; for i in $(seq 1 30); do echo "  m${i}() { try { return ${i}; } catch(e) { throw e; } }"; done; echo "}"; } > svc.ts
  git add -A && git commit -q -m "add error handling"
  check "red" "large refactor — class rename vs error handling"
}

s10_diverged_8files() {
  local d="${BENCH_DIR}/s10"
  mk s10
  for i in $(seq 1 10); do echo "file ${i}" > "f${i}.txt"; done
  seal
  clone_remote "${d}"
  for i in $(seq 1 8); do echo "remote rewrite of file ${i} with lots of new content that is quite different from the original" > "f${i}.txt"; done
  push_remote "${d}" "massive remote rewrite"
  for i in $(seq 1 8); do echo "local rewrite of file ${i} completely different direction and approach than remote" > "f${i}.txt"; done
  git add -A && git commit -q -m "massive local rewrite"
  check "red" "8-file divergence — mutual destruction"
}

s11_interleaved_api() {
  local d="${BENCH_DIR}/s11"
  mk s11
  cat > router.ts << 'TSEOF'
import { auth } from "./mw";
import { UC } from "./ctrl";
export function routes(app: any) {
  app.get("/users", auth, UC.list);
  app.get("/users/:id", auth, UC.get);
  app.post("/users", auth, UC.create);
  app.delete("/users/:id", auth, UC.delete);
}
TSEOF
  cat > mw.ts << 'TSEOF'
export function auth(req: any, res: any, next: any) {
  const t = req.headers.authorization;
  if (!t) return res.status(401).json({ error: "no token" });
  try { req.user = verify(t); next(); } catch { res.status(401).json({ error: "invalid" }); }
}
TSEOF
  cat > ctrl.ts << 'TSEOF'
export class UC {
  static async list(req: any, res: any) { res.json(await db.query("SELECT * FROM users")); }
  static async get(req: any, res: any) { res.json(await db.query("SELECT * FROM users WHERE id=$1", [req.params.id])); }
  static async create(req: any, res: any) { res.json(await db.query("INSERT INTO users (email) VALUES ($1)", [req.body.email])); }
  static async delete(req: any, res: any) { await db.query("DELETE FROM users WHERE id=$1", [req.params.id]); res.json({ok:1}); }
}
TSEOF
  seal
  clone_remote "${d}"
  # Remote: session auth + rate limiting + soft delete + new endpoint
  cat > mw.ts << 'TSEOF'
import { rateLimit } from "express-rate-limit";
export function auth(req: any, res: any, next: any) {
  const s = req.session;
  if (!s?.userId) return res.status(401).json({ error: "not logged in" });
  req.user = { id: s.userId, role: s.role };
  next();
}
export const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
TSEOF
  cat > router.ts << 'TSEOF'
import { auth, limiter } from "./mw";
import { UC } from "./ctrl";
export function routes(app: any) {
  app.use(limiter);
  app.get("/users", auth, UC.list);
  app.get("/users/:id", auth, UC.get);
  app.post("/users", auth, UC.create);
  app.put("/users/:id", auth, UC.update);
  app.delete("/users/:id", auth, UC.delete);
}
TSEOF
  cat > ctrl.ts << 'TSEOF'
export class UC {
  static async list(req: any, res: any) { res.json({data: await db.query("SELECT id,email,role FROM users WHERE active=true"), count: 0}); }
  static async get(req: any, res: any) { const u = await db.query("SELECT id,email,role,created_at FROM users WHERE id=$1",[req.params.id]); if(!u) return res.status(404).json({error:"nope"}); res.json({data:u}); }
  static async create(req: any, res: any) { const {email,role}=req.body; res.status(201).json({data: await db.query("INSERT INTO users (email,role) VALUES ($1,$2) RETURNING *",[email,role])}); }
  static async update(req: any, res: any) { res.json({data: await db.query("UPDATE users SET email=$1 WHERE id=$2 RETURNING *",[req.body.email,req.params.id])}); }
  static async delete(req: any, res: any) { await db.query("UPDATE users SET active=false WHERE id=$1",[req.params.id]); res.json({ok:1}); }
}
TSEOF
  push_remote "${d}" "session auth + rate limiting + soft delete"
  # Local: JWT + zod + pagination
  cat > mw.ts << 'TSEOF'
import jwt from "jsonwebtoken";
export function auth(req: any, res: any, next: any) {
  const b = req.headers.authorization?.split(" ")[1];
  if (!b) return res.status(401).json({ error: "missing bearer" });
  try { req.user = jwt.verify(b, process.env.JWT_SECRET!); next(); }
  catch { res.status(403).json({ error: "expired or invalid" }); }
}
export function admin(req: any, res: any, next: any) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "admin only" });
  next();
}
TSEOF
  cat > router.ts << 'TSEOF'
import { auth, admin } from "./mw";
import { UC } from "./ctrl";
export function routes(app: any) {
  app.get("/users", auth, UC.list);
  app.get("/users/:id", auth, UC.get);
  app.post("/users", auth, admin, UC.create);
  app.patch("/users/:id", auth, UC.update);
  app.delete("/users/:id", auth, admin, UC.delete);
}
TSEOF
  cat > ctrl.ts << 'TSEOF'
import { z } from "zod";
const Create = z.object({ email: z.string().email(), name: z.string().min(1) });
const Update = z.object({ email: z.string().email().optional(), name: z.string().optional() });
export class UC {
  static async list(req: any, res: any) { const {page=1,limit=20}=req.query; const u=await db.query("SELECT * FROM users LIMIT $1 OFFSET $2",[limit,(page-1)*limit]); res.json({data:u,page,limit}); }
  static async get(req: any, res: any) { const u=await db.query("SELECT * FROM users WHERE id=$1",[req.params.id]); if(!u) return res.status(404).json({error:"not found"}); res.json(u); }
  static async create(req: any, res: any) { const b=Create.parse(req.body); res.status(201).json(await db.query("INSERT INTO users (email,name) VALUES ($1,$2) RETURNING *",[b.email,b.name])); }
  static async update(req: any, res: any) { const b=Update.parse(req.body); res.json(await db.query("UPDATE users SET email=COALESCE($1,email),name=COALESCE($2,name) WHERE id=$3 RETURNING *",[b.email,b.name,req.params.id])); }
  static async delete(req: any, res: any) { await db.query("DELETE FROM users WHERE id=$1",[req.params.id]); res.status(204).send(); }
}
TSEOF
  git add -A && git commit -q -m "JWT + zod + pagination"
  check "red" "3-file interleaved — session vs JWT rewrite"
}

# ═══════════════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}  ╔═══════════════════════════════════════════╗${RST}"
echo -e "${BOLD}  ║     CONFLICTBENCH v1 — NoConflict         ║${RST}"
echo -e "${BOLD}  ╚═══════════════════════════════════════════╝${RST}"
echo ""
echo -e "${DIM}  workspace: ${BENCH_DIR}${RST}"
echo ""

echo -e "  ${G}── GREEN (should classify as safe) ──${RST}"
s01_clean_push
s02_different_files
s03_whitespace
s04_new_files
s05_trivial_import
echo ""

echo -e "  ${Y}── YELLOW (should warn, not block) ──${RST}"
s06_same_function
s07_config_clash
s08_migration
echo ""

echo -e "  ${R}── RED (should hard-stop) ──${RST}"
s09_large_refactor
s10_diverged_8files
s11_interleaved_api
echo ""

# ═══════════════════════════════════════════════════════════════════
# RESULTS
# ═══════════════════════════════════════════════════════════════════

echo -e "  ${BOLD}─── RESULTS ───${RST}"
echo ""
echo -e "  ${G}${PASS}${RST} passed  ${R}${FAIL}${RST} failed  ${DIM}${TOTAL} total${RST}"

SCORE=$(awk "BEGIN {printf \"%.1f\", (${PASS}/${TOTAL})*100}")
echo -e "  score: ${BOLD}${SCORE}%${RST}"
echo ""

if [ "${FAIL}" -eq 0 ]; then
  echo -e "  ${G}${BOLD}PERFECT SCORE.${RST} ${DIM}${TOTAL}/${TOTAL} conflicts classified correctly.${RST}"
else
  echo -e "  ${Y}${FAIL} misclassifications.${RST} ${DIM}review scenarios above.${RST}"
fi

echo ""

# Write JSON
RESULTS_FILE="${BENCH_DIR}/results.json"
echo "[" > "${RESULTS_FILE}"
for i in "${!SCENARIOS[@]}"; do
  [ "$i" -gt 0 ] && echo "," >> "${RESULTS_FILE}"
  echo "  ${SCENARIOS[$i]}" >> "${RESULTS_FILE}"
done
echo "]" >> "${RESULTS_FILE}"

echo -e "  ${DIM}results: ${RESULTS_FILE}${RST}"
echo ""

# Cleanup
rm -rf "${BENCH_DIR}"

[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
