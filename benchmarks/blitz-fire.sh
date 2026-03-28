#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Blitz Fire — Post NoConflict analysis on conflicted PRs
# ═══════════════════════════════════════════════════════════════════
#
# Reads blitz-targets.json, clones each PR, runs full severity
# analysis, and posts a helpful comment.
#
# Usage:
#   ./benchmarks/blitz-fire.sh              # live fire
#   ./benchmarks/blitz-fire.sh --dry        # preview only
#   ./benchmarks/blitz-fire.sh --dry --max 5  # preview first 5
# ═══════════════════════════════════════════════════════════════════

DRY_RUN=false
MAX_TARGETS=999
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGETS="${SCRIPT_DIR}/blitz-targets.json"
FIRE_LOG="${SCRIPT_DIR}/blitz-fire-log.json"
WORK_DIR=$(mktemp -d)

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY_RUN=true; shift ;;
    --max) MAX_TARGETS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'
DIM='\033[2m'; BOLD='\033[1m'; RST='\033[0m'

echo ""
echo -e "${BOLD}  ╔═══════════════════════════════════════════╗${RST}"
if [ "${DRY_RUN}" = "true" ]; then
echo -e "${BOLD}  ║     BLITZ FIRE — DRY RUN (no comments)    ║${RST}"
else
echo -e "${BOLD}  ║     BLITZ FIRE — LIVE 🔥                  ║${RST}"
fi
echo -e "${BOLD}  ╚═══════════════════════════════════════════╝${RST}"
echo ""

if [ ! -f "${TARGETS}" ]; then
  echo -e "  ${R}no targets file. run blitz-scout.sh first.${RST}"
  exit 1
fi

TOTAL=$(jq length "${TARGETS}")
echo -e "  ${DIM}targets: ${TOTAL} PRs loaded${RST}"
echo -e "  ${DIM}max: ${MAX_TARGETS}${RST}"
echo ""

# Init fire log
echo "[" > "${FIRE_LOG}"
FIRST=true
POSTED=0
SKIPPED=0
ERRORS=0

classify_full() {
  local dir="$1"
  local base="$2"
  local head="$3"
  cd "${dir}" 2>/dev/null || return

  local has_conflict="false"
  local conflict_count=0
  local conflict_files=""
  local total_lines=0

  if ! git merge-tree --write-tree "${head}" "${base}" >/dev/null 2>&1; then
    has_conflict="true"
    local mt_output
    mt_output=$(git merge-tree --write-tree "${head}" "${base}" 2>&1)
    conflict_count=$(echo "${mt_output}" | grep -c "CONFLICT" 2>/dev/null || echo "0")
    conflict_files=$(echo "${mt_output}" | grep "CONFLICT" | sed 's/.*CONFLICT.*: //' | head -5)
  fi

  total_lines=$(git diff --numstat "${base}...${head}" 2>/dev/null | awk '{s+=$1+$2} END {print s+0}' 2>/dev/null || echo "0")

  local trivial_only
  trivial_only=$(git diff "${base}...${head}" 2>/dev/null | awk '
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

  local sev="green"
  if [ "${has_conflict}" = "true" ]; then
    if [ "${trivial_only}" = "true" ]; then
      sev="green"
    elif [ "${total_lines}" -gt 50 ] || [ "${conflict_count}" -gt 2 ]; then
      sev="red"
    else
      sev="yellow"
    fi
  fi

  echo "${sev}|${conflict_count}|${total_lines}|${conflict_files}"
}

# Generate the comment body
generate_comment() {
  local repo="$1"
  local pr="$2"
  local sev="$3"
  local conflicts="$4"
  local lines="$5"
  local files="$6"

  local sev_upper
  sev_upper=$(echo "${sev}" | tr 'a-z' 'A-Z')

  local sev_emoji=""
  local sev_desc=""
  case "${sev}" in
    green)
      sev_emoji=">"
      sev_desc="**Trivial** — these conflicts are import/whitespace level. A tool like NoConflict auto-resolves these silently."
      ;;
    yellow)
      sev_emoji=">"
      sev_desc="**Semantic overlap** — both sides edited the same logic differently. NoConflict would explain what happened and ask before acting."
      ;;
    red)
      sev_emoji=">"
      sev_desc="**Significant** — large structural changes on both sides. NoConflict would hard-stop and walk you through what's at risk before touching anything."
      ;;
  esac

  cat << COMMENTEOF
### Merge Conflict Analysis

We ran [NoConflict](https://github.com/airlock-labs/noconflict)'s severity router on this PR:

| Metric | Value |
|--------|-------|
| Severity | **${sev_upper}** |
| Conflict zones | ${conflicts} |
| Lines at risk | ${lines} |
| Files | ${files} |

${sev_desc}

---

We're building NoConflict — a git CLI that classifies and resolves merge conflicts so you can \`nc push\` and move on. Free during beta.

\`\`\`bash
npm i -g noconflict
nc init
nc push
\`\`\`

Would love feedback from maintainers working at this scale. Happy to help resolve this one if useful.

<sub>*Analysis by [NoConflict](https://github.com/airlock-labs/noconflict) — murder your merge conflicts.*</sub>
COMMENTEOF
}

# ─── Process each target ─────────────────────────────────────────
for i in $(seq 0 $((TOTAL - 1))); do
  [ "${POSTED}" -ge "${MAX_TARGETS}" ] && break

  repo=$(jq -r ".[$i].repo" "${TARGETS}")
  pr=$(jq -r ".[$i].pr" "${TARGETS}")
  title=$(jq -r ".[$i].title" "${TARGETS}")
  base=$(jq -r ".[$i].base" "${TARGETS}")
  stars=$(jq -r ".[$i].stars" "${TARGETS}")
  lang=$(jq -r ".[$i].language" "${TARGETS}")
  url=$(jq -r ".[$i].url" "${TARGETS}")

  short_title="${title:0:50}"
  echo -e "  ${DIM}[${i}/${TOTAL}]${RST} ${repo}#${pr} ${DIM}${short_title}${RST}"

  # Clone and analyze
  clone_dir="${WORK_DIR}/${repo//\//-}-${pr}"
  if ! git clone -q --depth 50 "https://github.com/${repo}.git" "${clone_dir}" 2>/dev/null; then
    echo -e "    ${R}clone failed${RST}"
    ERRORS=$((ERRORS+1))
    continue
  fi

  cd "${clone_dir}"
  git fetch -q origin "pull/${pr}/head:pr-${pr}" 2>/dev/null
  git fetch -q origin "${base}" 2>/dev/null

  result=$(classify_full "${clone_dir}" "origin/${base}" "pr-${pr}")
  sev=$(echo "${result}" | cut -d'|' -f1)
  conflicts=$(echo "${result}" | cut -d'|' -f2)
  lines=$(echo "${result}" | cut -d'|' -f3)
  files=$(echo "${result}" | cut -d'|' -f4- | tr '\n' ', ' | sed 's/,$//')

  sev_upper=$(echo "${sev}" | tr 'a-z' 'A-Z')
  case "${sev}" in
    green)  color="${G}" ;;
    yellow) color="${Y}" ;;
    red)    color="${R}" ;;
  esac

  echo -e "    ${color}${sev_upper}${RST} — ${conflicts} conflicts, ${lines} lines"

  # Skip green — not worth commenting on
  if [ "${sev}" = "green" ]; then
    echo -e "    ${DIM}skipped (green — no value in commenting)${RST}"
    SKIPPED=$((SKIPPED+1))
    rm -rf "${clone_dir}"
    continue
  fi

  # Generate comment
  comment=$(generate_comment "${repo}" "${pr}" "${sev}" "${conflicts}" "${lines}" "${files}")

  if [ "${DRY_RUN}" = "true" ]; then
    echo -e "    ${Y}DRY RUN — would post:${RST}"
    echo "${comment}" | head -5 | sed 's/^/    /'
    echo -e "    ${DIM}...${RST}"
  else
    # Post the comment
    if gh pr comment "${pr}" --repo "${repo}" --body "${comment}" 2>/dev/null; then
      echo -e "    ${G}POSTED${RST}"
    else
      echo -e "    ${R}failed to comment${RST}"
      ERRORS=$((ERRORS+1))
    fi
  fi

  # Log
  if [ "${FIRST}" = "true" ]; then
    FIRST=false
  else
    echo "," >> "${FIRE_LOG}"
  fi

  safe_title=$(echo "${title}" | sed 's/"/\\"/g')
  cat >> "${FIRE_LOG}" << LOGEOF
  {
    "repo": "${repo}",
    "pr": ${pr},
    "title": "${safe_title}",
    "severity": "${sev}",
    "conflicts": ${conflicts},
    "lines": ${lines},
    "posted": $([ "${DRY_RUN}" = "true" ] && echo "false" || echo "true"),
    "url": "${url}"
  }
LOGEOF

  POSTED=$((POSTED+1))

  # Cleanup clone
  rm -rf "${clone_dir}"

  # Rate limit: 2 second delay between comments to be respectful
  [ "${DRY_RUN}" = "false" ] && sleep 2
done

echo "]" >> "${FIRE_LOG}"

echo ""
echo -e "  ${BOLD}─── BLITZ COMPLETE ───${RST}"
echo ""
echo -e "  ${G}${POSTED}${RST} targets processed"
echo -e "  ${DIM}${SKIPPED} skipped (green)${RST}"
echo -e "  ${R}${ERRORS}${RST} errors"
echo ""

if [ "${DRY_RUN}" = "true" ]; then
  echo -e "  ${Y}DRY RUN — no comments posted.${RST}"
  echo -e "  ${DIM}run without --dry to go live.${RST}"
fi

echo -e "  ${DIM}log: benchmarks/blitz-fire-log.json${RST}"
echo ""

rm -rf "${WORK_DIR}"
