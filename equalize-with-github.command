#!/bin/bash
# Double-click in Finder, or run: ./equalize-with-github.command
# Makes this Mac repo match GitHub main (discards local branch drift / stuck merges).

set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo " Equalize Mac repo with GitHub (main)"
echo "========================================"
echo "Repo: $(pwd)"
echo

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not found. Install Xcode Command Line Tools first."
  read -r -p "Press Enter to close…"
  exit 1
fi

# Leave stuck merge / rebase / cherry-pick states
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "→ Aborting stuck rebase…"
  git rebase --abort || true
fi
if [ -f .git/MERGE_HEAD ]; then
  echo "→ Aborting stuck merge…"
  git merge --abort || true
fi
if [ -f .git/CHERRY_PICK_HEAD ]; then
  echo "→ Aborting stuck cherry-pick…"
  git cherry-pick --abort || true
fi

# Safety net: stash uncommitted work so hard reset cannot destroy it
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  STASH_MSG="mac-equalize auto-stash $(date '+%Y-%m-%d %H:%M:%S')"
  echo "→ Local changes found — stashing as: $STASH_MSG"
  git stash push -u -m "$STASH_MSG" || true
  echo "  (recover later with: git stash list && git stash pop)"
fi

echo "→ Fetching origin…"
git fetch origin

echo "→ Checking out main…"
git checkout main

echo "→ Hard-resetting to origin/main…"
git reset --hard origin/main

echo "→ Removing untracked files (keeps .env / node_modules — they are gitignored)…"
git clean -fd

echo
echo "Done. Local tip:"
git log -1 --oneline
echo
git status
echo
echo "Your Mac now matches GitHub main."
read -r -p "Press Enter to close…"
