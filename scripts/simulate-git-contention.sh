#!/usr/bin/env bash
set -euo pipefail

TMPDIR_ROOT="$(mktemp -d /tmp/vibe-git-contention-XXXXXX)"
REPO="$TMPDIR_ROOT/repo"
OUT="$TMPDIR_ROOT/out"
mkdir -p "$REPO" "$OUT"

run_shared_parallel() {
  local workers=${1:-4}
  local loops=${2:-120}
  local failfile="$OUT/parallel_failures.txt"
  : > "$failfile"

  rm -rf "$REPO"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email "sim@example.com"
  git -C "$REPO" config user.name "Sim"
  echo "seed" > "$REPO/seed.txt"
  git -C "$REPO" add seed.txt
  git -C "$REPO" commit -q -m "seed"

  worker_fn() {
    local wid="$1"
    local i
    for ((i=1; i<=loops; i++)); do
      local branch="issue-$wid"
      if ! git -C "$REPO" checkout -q -B "$branch" >/dev/null 2>>"$failfile"; then
        echo "checkout_fail worker=$wid i=$i" >> "$failfile"
        continue
      fi
      echo "$wid-$i-$(date +%s%N)" >> "$REPO/worker-$wid.txt"
      if ! git -C "$REPO" add "worker-$wid.txt" >/dev/null 2>>"$failfile"; then
        echo "add_fail worker=$wid i=$i" >> "$failfile"
        continue
      fi
      if ! git -C "$REPO" commit -q -m "w$wid:$i" >/dev/null 2>>"$failfile"; then
        echo "commit_fail worker=$wid i=$i" >> "$failfile"
      fi
      local current
      current="$(git -C "$REPO" branch --show-current 2>/dev/null || true)"
      if [[ "$current" != "$branch" ]]; then
        echo "branch_mismatch worker=$wid i=$i got=$current expected=$branch" >> "$failfile"
      fi
    done
  }

  local pids=()
  local w
  for ((w=1; w<=workers; w++)); do
    worker_fn "$w" &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p" || true; done

  local total_failures
  total_failures="$(wc -l < "$failfile" | tr -d ' ')"
  echo "$total_failures"
}

run_single_sequential() {
  local loops=${1:-480}
  local failfile="$OUT/sequential_failures.txt"
  : > "$failfile"

  rm -rf "$REPO"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email "sim@example.com"
  git -C "$REPO" config user.name "Sim"
  echo "seed" > "$REPO/seed.txt"
  git -C "$REPO" add seed.txt
  git -C "$REPO" commit -q -m "seed"

  local i
  for ((i=1; i<=loops; i++)); do
    local branch="issue-1"
    if ! git -C "$REPO" checkout -q -B "$branch" >/dev/null 2>>"$failfile"; then
      echo "checkout_fail i=$i" >> "$failfile"
      continue
    fi
    echo "1-$i-$(date +%s%N)" >> "$REPO/worker-1.txt"
    if ! git -C "$REPO" add "worker-1.txt" >/dev/null 2>>"$failfile"; then
      echo "add_fail i=$i" >> "$failfile"
      continue
    fi
    if ! git -C "$REPO" commit -q -m "w1:$i" >/dev/null 2>>"$failfile"; then
      echo "commit_fail i=$i" >> "$failfile"
    fi
    local current
    current="$(git -C "$REPO" branch --show-current 2>/dev/null || true)"
    if [[ "$current" != "$branch" ]]; then
      echo "branch_mismatch i=$i got=$current expected=$branch" >> "$failfile"
    fi
  done

  local total_failures
  total_failures="$(wc -l < "$failfile" | tr -d ' ')"
  echo "$total_failures"
}

parallel_failures="$(run_shared_parallel 4 120)"
sequential_failures="$(run_single_sequential 480)"

cat <<REPORT
simulation_root=$TMPDIR_ROOT
parallel_mode_failures=$parallel_failures
sequential_mode_failures=$sequential_failures
parallel_fail_log=$OUT/parallel_failures.txt
sequential_fail_log=$OUT/sequential_failures.txt
REPORT
