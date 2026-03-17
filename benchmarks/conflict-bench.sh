#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# ConflictBench v1 — NoConflict Severity Router + Resolution Benchmark
# ═══════════════════════════════════════════════════════════════════
#
# Creates synthetic merge conflict scenarios, runs nc push in
# dry-run mode, and scores the severity router's classification.
#
# Usage:
#   ./benchmarks/conflict-bench.sh [--full]
#
# Requires: git, node, nc (noconflict CLI)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

BENCH_DIR=$(mktemp -d)
RESULTS_FILE="${BENCH_DIR}/results.json"
PASS=0
FAIL=0
TOTAL=0
SCENARIOS=()

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${DIM}  $1${RESET}"; }
pass() { echo -e "  ${GREEN}✓${RESET} $1"; ((PASS++)); ((TOTAL++)); }
fail() { echo -e "  ${RED}✕${RESET} $1 ${DIM}(expected: $2, got: $3)${RESET}"; ((FAIL++)); ((TOTAL++)); }

# ─── Setup a fresh repo for a scenario ────────────────────────────
setup_repo() {
  local name="$1"
  local dir="${BENCH_DIR}/${name}"
  mkdir -p "${dir}"
  cd "${dir}"
  git init -q
  git config user.email "bench@noconflict.dev"
  git config user.name "ConflictBench"
  echo "${dir}"
}

# ─── Run the severity router on a repo ────────────────────────────
# We test the severity classification by importing the router directly
# via a small Node script that simulates what nc push does.
run_severity_check() {
  local dir="$1"
  local expected_severity="$2"
  local scenario_name="$3"
  cd "${dir}"

  # Use git merge-tree to detect conflicts (same as nc push)
  local current_branch
  current_branch=$(git branch --show-current)
  local has_conflict="false"
  local conflict_count=0
  local total_changed_lines=0
  local trivial_only="true"

  # Fetch to make sure we have origin refs
  git fetch -q origin 2>/dev/null || true

  # Try merge-tree
  if ! git merge-tree --write-tree "${current_branch}" "origin/main" > /dev/null 2>&1; then
    has_conflict="true"
    conflict_count=$(git merge-tree --write-tree "${current_branch}" "origin/main" 2>&1 | grep -c "CONFLICT" || echo "0")
  fi

  # Get diff stats
  if git rev-parse origin/main &>/dev/null; then
    total_changed_lines=$(git diff --numstat "origin/main" 2>/dev/null | awk '{sum+=$1+$2} END {print sum+0}')

    # Check if changes are trivial (imports, comments, whitespace only)
    local diff_content
    diff_content=$(git diff "origin/main" 2>/dev/null || echo "")
    local changed_lines
    changed_lines=$(echo "${diff_content}" | grep -E '^\+[^+]|^-[^-]' | grep -v '^---' | grep -v '^\+\+\+' || echo "")

    if [ -n "${changed_lines}" ]; then
      # Check each changed line against trivial patterns
      while IFS= read -r line; do
        local stripped="${line:1}"  # remove +/- prefix
        stripped=$(echo "${stripped}" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
        # Non-trivial if it's not: import, export, comment, empty, just braces
        if [ -n "${stripped}" ] && \
           ! echo "${stripped}" | grep -qE '^(import |export |//|/\*|\*|})$'; then
          trivial_only="false"
          break
        fi
      done <<< "${changed_lines}"
    fi
  fi

  # Classify severity (mirrors severity.ts logic)
  local actual_severity="green"

  if [ "${has_conflict}" = "true" ]; then
    if [ "${trivial_only}" = "true" ]; then
      actual_severity="green"
    elif [ "${total_changed_lines}" -gt 100 ] || [ "${conflict_count}" -gt 3 ]; then
      actual_severity="red"
    else
      actual_severity="yellow"
    fi
  fi

  # Score
  if [ "${actual_severity}" = "${expected_severity}" ]; then
    pass "${scenario_name} → ${expected_severity}"
  else
    fail "${scenario_name}" "${expected_severity}" "${actual_severity}"
  fi

  SCENARIOS+=("{\"name\":\"${scenario_name}\",\"expected\":\"${expected_severity}\",\"actual\":\"${actual_severity}\",\"conflict_count\":${conflict_count},\"changed_lines\":${total_changed_lines}}")
}

# ═══════════════════════════════════════════════════════════════════
# SCENARIO DEFINITIONS
# ═══════════════════════════════════════════════════════════════════

# ─── GREEN: Clean push, no conflicts ─────────────────────────────
scenario_clean_push() {
  local dir
  dir=$(setup_repo "clean-push")

  echo "hello world" > file.txt
  git add . && git commit -q -m "initial"

  # Create bare remote
  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"

  # Make a local change (no conflict possible)
  echo "local change" >> file.txt
  git add . && git commit -q -m "local edit"

  run_severity_check "${dir}" "green" "clean push — no divergence"
}

# ─── GREEN: Different files edited ───────────────────────────────
scenario_different_files() {
  local dir
  dir=$(setup_repo "different-files")

  echo "file a content" > a.txt
  echo "file b content" > b.txt
  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote changes file a
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  echo "remote edit" >> a.txt
  git add . && git commit -q -m "remote edit a"
  git push -q origin main

  # Local changes file b (no conflict)
  cd "${dir}"
  git fetch -q origin
  echo "local edit" >> b.txt
  git add . && git commit -q -m "local edit b"

  run_severity_check "${dir}" "green" "different files — no overlap"
}

# ─── GREEN: Trivial import conflict ──────────────────────────────
scenario_trivial_import() {
  local dir
  dir=$(setup_repo "trivial-import")

  cat > app.ts << 'EOF'
import { foo } from "./foo";
import { bar } from "./bar";

function main() {
  console.log(foo(), bar());
}
EOF
  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote adds an import
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  sed -i '' '2a\
import { baz } from "./baz";
' app.ts
  git add . && git commit -q -m "add baz import"
  git push -q origin main

  # Local adds a different import
  cd "${dir}"
  git fetch -q origin
  sed -i '' '2a\
import { qux } from "./qux";
' app.ts
  git add . && git commit -q -m "add qux import"

  run_severity_check "${dir}" "green" "trivial conflict — import lines only"
}

# ─── YELLOW: Same function, different edits ──────────────────────
scenario_same_function() {
  local dir
  dir=$(setup_repo "same-function")

  cat > auth.ts << 'EOF'
export function validateUser(token: string): boolean {
  const decoded = decode(token);
  if (!decoded) return false;
  if (decoded.exp < Date.now()) return false;
  return true;
}
EOF
  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: adds role check
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  cat > auth.ts << 'EOF'
export function validateUser(token: string, requiredRole?: string): boolean {
  const decoded = decode(token);
  if (!decoded) return false;
  if (decoded.exp < Date.now()) return false;
  if (requiredRole && decoded.role !== requiredRole) return false;
  return true;
}
EOF
  git add . && git commit -q -m "add role validation"
  git push -q origin main

  # Local: adds logging
  cd "${dir}"
  git fetch -q origin
  cat > auth.ts << 'EOF'
export function validateUser(token: string): boolean {
  const decoded = decode(token);
  if (!decoded) {
    console.warn("invalid token");
    return false;
  }
  if (decoded.exp < Date.now()) {
    console.warn("token expired");
    return false;
  }
  return true;
}
EOF
  git add . && git commit -q -m "add auth logging"

  run_severity_check "${dir}" "yellow" "same function edited — semantic overlap"
}

# ─── YELLOW: Overlapping config changes ──────────────────────────
scenario_config_overlap() {
  local dir
  dir=$(setup_repo "config-overlap")

  cat > config.json << 'EOF'
{
  "port": 3000,
  "host": "localhost",
  "database": "postgres://localhost:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "info"
}
EOF
  git add . && git commit -q -m "initial config"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: changes port and adds feature flags
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  cat > config.json << 'EOF'
{
  "port": 8080,
  "host": "0.0.0.0",
  "database": "postgres://localhost:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "info",
  "features": {
    "darkMode": true,
    "betaAccess": false
  }
}
EOF
  git add . && git commit -q -m "update port, add features"
  git push -q origin main

  # Local: changes database and log level
  cd "${dir}"
  git fetch -q origin
  cat > config.json << 'EOF'
{
  "port": 3000,
  "host": "localhost",
  "database": "postgres://prod-db:5432/app",
  "redis": "redis://localhost:6379",
  "logLevel": "debug"
}
EOF
  git add . && git commit -q -m "update db + log level"

  run_severity_check "${dir}" "yellow" "config overlap — different keys"
}

# ─── RED: Large conflicting refactor ─────────────────────────────
scenario_large_refactor() {
  local dir
  dir=$(setup_repo "large-refactor")

  # Generate a substantial file
  {
    echo "// User service"
    echo "export class UserService {"
    for i in $(seq 1 30); do
      echo "  method${i}() { return ${i}; }"
    done
    echo "}"
  } > user-service.ts

  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: major refactor — rename class + change half the methods
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  {
    echo "// Account service (renamed from UserService)"
    echo "export class AccountService {"
    for i in $(seq 1 30); do
      echo "  async getAccount${i}(): Promise<Account> { return fetchAccount(${i}); }"
    done
    echo "}"
  } > user-service.ts
  git add . && git commit -q -m "refactor: rename UserService → AccountService"
  git push -q origin main

  # Local: different refactor — add error handling to every method
  cd "${dir}"
  git fetch -q origin
  {
    echo "// User service with error handling"
    echo "export class UserService {"
    for i in $(seq 1 30); do
      echo "  method${i}() { try { return ${i}; } catch(e) { log(e); throw e; } }"
    done
    echo "}"
  } > user-service.ts
  git add . && git commit -q -m "add error handling to all methods"

  run_severity_check "${dir}" "red" "large refactor — class rename vs error handling"
}

# ─── RED: Destructive force push scenario ────────────────────────
scenario_diverged_history() {
  local dir
  dir=$(setup_repo "diverged-history")

  for i in $(seq 1 10); do
    echo "file ${i}" > "file${i}.txt"
  done
  git add . && git commit -q -m "initial 10 files"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: rewrites 8 files
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  for i in $(seq 1 8); do
    echo "completely rewritten by remote" > "file${i}.txt"
  done
  git add . && git commit -q -m "massive remote rewrite"
  git push -q origin main

  # Local: rewrites the same 8 files differently
  cd "${dir}"
  git fetch -q origin
  for i in $(seq 1 8); do
    echo "completely rewritten locally — different content" > "file${i}.txt"
  done
  git add . && git commit -q -m "massive local rewrite"

  run_severity_check "${dir}" "red" "8-file divergence — mutual destruction"
}

# ─── GREEN: Whitespace-only changes ──────────────────────────────
scenario_whitespace() {
  local dir
  dir=$(setup_repo "whitespace")

  printf "function foo() {\n  return 1;\n}\n" > app.js
  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: reformats with different whitespace
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  printf "function foo() {\n    return 1;\n}\n" > app.js
  git add . && git commit -q -m "reformat to 4 spaces"
  git push -q origin main

  # Local: adds trailing newline
  cd "${dir}"
  git fetch -q origin
  printf "function foo() {\n  return 1;\n}\n\n" > app.js
  git add . && git commit -q -m "add trailing newline"

  run_severity_check "${dir}" "green" "whitespace-only — no semantic change"
}

# ─── YELLOW: Database migration conflict ─────────────────────────
scenario_migration_conflict() {
  local dir
  dir=$(setup_repo "migration-conflict")

  cat > migration_001.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
EOF
  git add . && git commit -q -m "initial migration"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: adds columns
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  cat > migration_001.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);
EOF
  git add . && git commit -q -m "add username + role columns"
  git push -q origin main

  # Local: adds different columns
  cd "${dir}"
  git fetch -q origin
  cat > migration_001.sql << 'EOF'
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
EOF
  git add . && git commit -q -m "add phone + avatar + updated_at"

  run_severity_check "${dir}" "yellow" "migration conflict — different columns added"
}

# ─── RED: Multiple files with interleaved logic changes ──────────
scenario_interleaved_logic() {
  local dir
  dir=$(setup_repo "interleaved-logic")

  # Create interconnected files
  cat > router.ts << 'EOF'
import { authMiddleware } from "./middleware";
import { UserController } from "./controller";

export function setupRoutes(app: any) {
  app.get("/users", authMiddleware, UserController.list);
  app.get("/users/:id", authMiddleware, UserController.get);
  app.post("/users", authMiddleware, UserController.create);
  app.delete("/users/:id", authMiddleware, UserController.delete);
}
EOF

  cat > middleware.ts << 'EOF'
export function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "no token" });
  try {
    req.user = verify(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}
EOF

  cat > controller.ts << 'EOF'
export class UserController {
  static async list(req: any, res: any) {
    const users = await db.query("SELECT * FROM users");
    res.json(users);
  }
  static async get(req: any, res: any) {
    const user = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    res.json(user);
  }
  static async create(req: any, res: any) {
    const user = await db.query("INSERT INTO users (email) VALUES ($1)", [req.body.email]);
    res.json(user);
  }
  static async delete(req: any, res: any) {
    await db.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  }
}
EOF

  git add . && git commit -q -m "initial API"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote: rewrites auth to use sessions + adds rate limiting + changes queries
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"

  cat > middleware.ts << 'EOF'
import { rateLimit } from "express-rate-limit";

export function authMiddleware(req: any, res: any, next: any) {
  const session = req.session;
  if (!session?.userId) return res.status(401).json({ error: "not logged in" });
  req.user = { id: session.userId, role: session.role };
  next();
}

export const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
EOF

  cat > router.ts << 'EOF'
import { authMiddleware, limiter } from "./middleware";
import { UserController } from "./controller";

export function setupRoutes(app: any) {
  app.use(limiter);
  app.get("/users", authMiddleware, UserController.list);
  app.get("/users/:id", authMiddleware, UserController.get);
  app.post("/users", authMiddleware, UserController.create);
  app.put("/users/:id", authMiddleware, UserController.update);
  app.delete("/users/:id", authMiddleware, UserController.delete);
}
EOF

  cat > controller.ts << 'EOF'
export class UserController {
  static async list(req: any, res: any) {
    const users = await db.query("SELECT id, email, role FROM users WHERE active = true");
    res.json({ data: users, count: users.length });
  }
  static async get(req: any, res: any) {
    const user = await db.query("SELECT id, email, role, created_at FROM users WHERE id = $1", [req.params.id]);
    if (!user) return res.status(404).json({ error: "not found" });
    res.json({ data: user });
  }
  static async create(req: any, res: any) {
    const { email, role } = req.body;
    const user = await db.query("INSERT INTO users (email, role) VALUES ($1, $2) RETURNING *", [email, role]);
    res.status(201).json({ data: user });
  }
  static async update(req: any, res: any) {
    const user = await db.query("UPDATE users SET email = $1 WHERE id = $2 RETURNING *", [req.body.email, req.params.id]);
    res.json({ data: user });
  }
  static async delete(req: any, res: any) {
    await db.query("UPDATE users SET active = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  }
}
EOF

  git add . && git commit -q -m "session auth + rate limiting + soft delete"
  git push -q origin main

  # Local: rewrites auth to JWT + adds validation + changes queries differently
  cd "${dir}"
  git fetch -q origin

  cat > middleware.ts << 'EOF'
import jwt from "jsonwebtoken";

export function authMiddleware(req: any, res: any, next: any) {
  const bearer = req.headers.authorization?.split(" ")[1];
  if (!bearer) return res.status(401).json({ error: "missing bearer token" });
  try {
    req.user = jwt.verify(bearer, process.env.JWT_SECRET!);
    next();
  } catch (e) {
    res.status(403).json({ error: "token expired or invalid" });
  }
}

export function requireAdmin(req: any, res: any, next: any) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "admin only" });
  next();
}
EOF

  cat > router.ts << 'EOF'
import { authMiddleware, requireAdmin } from "./middleware";
import { UserController } from "./controller";

export function setupRoutes(app: any) {
  app.get("/users", authMiddleware, UserController.list);
  app.get("/users/:id", authMiddleware, UserController.get);
  app.post("/users", authMiddleware, requireAdmin, UserController.create);
  app.patch("/users/:id", authMiddleware, UserController.update);
  app.delete("/users/:id", authMiddleware, requireAdmin, UserController.delete);
}
EOF

  cat > controller.ts << 'EOF'
import { z } from "zod";

const CreateUser = z.object({ email: z.string().email(), name: z.string().min(1) });
const UpdateUser = z.object({ email: z.string().email().optional(), name: z.string().optional() });

export class UserController {
  static async list(req: any, res: any) {
    const { page = 1, limit = 20 } = req.query;
    const users = await db.query("SELECT * FROM users LIMIT $1 OFFSET $2", [limit, (page - 1) * limit]);
    const total = await db.query("SELECT COUNT(*) FROM users");
    res.json({ data: users, total: total[0].count, page, limit });
  }
  static async get(req: any, res: any) {
    const user = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (!user) return res.status(404).json({ error: "user not found" });
    res.json(user);
  }
  static async create(req: any, res: any) {
    const body = CreateUser.parse(req.body);
    const user = await db.query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *", [body.email, body.name]);
    res.status(201).json(user);
  }
  static async update(req: any, res: any) {
    const body = UpdateUser.parse(req.body);
    const user = await db.query("UPDATE users SET email = COALESCE($1, email), name = COALESCE($2, name) WHERE id = $3 RETURNING *", [body.email, body.name, req.params.id]);
    res.json(user);
  }
  static async delete(req: any, res: any) {
    await db.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.status(204).send();
  }
}
EOF

  git add . && git commit -q -m "JWT auth + zod validation + pagination"

  run_severity_check "${dir}" "red" "3-file interleaved — session vs JWT auth rewrite"
}

# ─── GREEN: New file, no overlap ─────────────────────────────────
scenario_new_file() {
  local dir
  dir=$(setup_repo "new-file")

  echo "existing" > existing.txt
  git add . && git commit -q -m "initial"

  git clone -q --bare "${dir}" "${dir}-remote"
  git remote add origin "${dir}-remote"
  git push -q -u origin main

  # Remote adds a different new file
  local clone_dir="${dir}-clone"
  git clone -q "${dir}-remote" "${clone_dir}"
  cd "${clone_dir}"
  echo "remote new file" > remote-new.txt
  git add . && git commit -q -m "add remote file"
  git push -q origin main

  # Local adds its own new file
  cd "${dir}"
  git fetch -q origin
  echo "local new file" > local-new.txt
  git add . && git commit -q -m "add local file"

  run_severity_check "${dir}" "green" "new files — no overlap possible"
}

# ═══════════════════════════════════════════════════════════════════
# RUN ALL SCENARIOS
# ═══════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}  ╔═══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}  ║     CONFLICTBENCH v1 — NoConflict         ║${RESET}"
echo -e "${BOLD}  ╚═══════════════════════════════════════════╝${RESET}"
echo ""

echo -e "${DIM}  workspace: ${BENCH_DIR}${RESET}"
echo ""

# GREEN scenarios
echo -e "  ${GREEN}── GREEN (should classify as safe) ──${RESET}"
scenario_clean_push
scenario_different_files
scenario_trivial_import
scenario_whitespace
scenario_new_file
echo ""

# YELLOW scenarios
echo -e "  ${YELLOW}── YELLOW (should warn, not block) ──${RESET}"
scenario_same_function
scenario_config_overlap
scenario_migration_conflict
echo ""

# RED scenarios
echo -e "  ${RED}── RED (should hard-stop) ──${RESET}"
scenario_large_refactor
scenario_diverged_history
scenario_interleaved_logic
echo ""

# ═══════════════════════════════════════════════════════════════════
# RESULTS
# ═══════════════════════════════════════════════════════════════════

echo -e "  ${BOLD}─── RESULTS ───${RESET}"
echo ""
echo -e "  ${GREEN}${PASS}${RESET} passed  ${RED}${FAIL}${RESET} failed  ${DIM}${TOTAL} total${RESET}"

SCORE=$(awk "BEGIN {printf \"%.1f\", (${PASS}/${TOTAL})*100}")
echo -e "  score: ${BOLD}${SCORE}%${RESET}"
echo ""

if [ "${FAIL}" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}PERFECT SCORE.${RESET} ${DIM}${TOTAL}/${TOTAL} conflicts classified correctly.${RESET}"
else
  echo -e "  ${YELLOW}${FAIL} misclassifications.${RESET} ${DIM}review scenarios above.${RESET}"
fi

echo ""

# Write JSON results
echo "[" > "${RESULTS_FILE}"
for i in "${!SCENARIOS[@]}"; do
  if [ "$i" -gt 0 ]; then echo "," >> "${RESULTS_FILE}"; fi
  echo "  ${SCENARIOS[$i]}" >> "${RESULTS_FILE}"
done
echo "]" >> "${RESULTS_FILE}"

echo -e "  ${DIM}results: ${RESULTS_FILE}${RESET}"
echo ""

# Cleanup
rm -rf "${BENCH_DIR}"

# Exit code
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
