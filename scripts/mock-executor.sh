#!/usr/bin/env bash
# Deterministic fake coding agent for stride tests and examples.
# Reads the prompt on stdin; acts based on STRIDE_* environment variables.
#   STRIDE_TASK_ID  - the task being worked
#   STRIDE_MODE     - implement | evaluate | decompose
#   STRIDE_MODEL    - the routed model id
#   STRIDE_STEER    - optional mid-run guidance
# Test knobs (space-separated id lists):
#   STRIDE_MOCK_FAIL_IDS      - make the task's test fail (writes bad artifact)
#   STRIDE_MOCK_NEEDSWORK_IDS - return NEEDS_WORK in evaluate mode
#   STRIDE_MOCK_ORPHAN_IDS    - add an unreferenced source module (reachability)
set -euo pipefail

prompt="$(cat || true)"
id="${STRIDE_TASK_ID:-unknown}"
model="${STRIDE_MODEL:-none}"
mode="${STRIDE_MODE:-implement}"

mkdir -p build prompts models
printf '%s' "$prompt" > "prompts/${id}.txt"
printf '%s' "$model" > "models/${id}.txt"
if [ -n "${STRIDE_STEER:-}" ]; then printf '%s' "$STRIDE_STEER" > "steer_${id}.txt"; fi

if [ "$mode" = "evaluate" ]; then
  case " ${STRIDE_MOCK_NEEDSWORK_IDS:-} " in
    *" ${id} "*) echo "NEEDS_WORK: mock reason"; exit 0 ;;
  esac
  echo "PASS"
  exit 0
fi

if [ "$mode" = "decompose" ]; then
  # Emit the features.md content on stdout; stride writes the file.
  cat <<'EOF'
# functional: user can sign up
- create the signup form
- store the new user
verify: an integration test posts to /signup and asserts a 201

# functional: user can log in
- create the login form
verify: an integration test logs in and asserts a session cookie
EOF
  echo "STRIDE_COST 0.02" 1>&2
  exit 0
fi

# implement mode
content="ok"
case " ${STRIDE_MOCK_FAIL_IDS:-} " in
  *" ${id} "*) content="bad" ;;
esac
printf '%s' "$content" > "build/${id}.txt"

case " ${STRIDE_MOCK_ORPHAN_IDS:-} " in
  *" ${id} "*) printf 'export const orphan = 1;\n' > "orphan_${id}.ts" ;;
esac

echo "STRIDE_COST 0.01" 1>&2
exit 0
