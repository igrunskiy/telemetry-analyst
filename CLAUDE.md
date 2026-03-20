# Claude Code — Project Instructions

## Session Workflow (MANDATORY)

At the start of **every conversation that will make code changes**, follow these steps before touching any files:

### 1. Derive a short session name
Pick a feature name ≤ 25 characters that reflects the request (kebab-case).
The folder and branch name follow the pattern: `{repo-name}_{feature-name}`
Examples: `telemetry-analyst_fix-lap-selector`, `telemetry-analyst_add-dark-mode`

### 2. Create a git worktree
```bash
FEATURE=<feature-name>        # ≤ 25 chars, kebab-case
REPO=telemetry-analyst
SHORT="${REPO}_${FEATURE}"
WORKTREE="d:/Claude/.tmp/$SHORT"

# from the main repo root
git -C d:/Claude/telemetry-analyst checkout main
git -C d:/Claude/telemetry-analyst pull
git -C d:/Claude/telemetry-analyst worktree add "$WORKTREE" -b "$SHORT"
```

### 3. Do ALL work inside the worktree
All file edits, reads, and tool calls must target paths under `$WORKTREE/`, not the main repo directory.

### 4. Run in yolo mode
Proceed autonomously — no confirmation prompts for individual steps.

### 5. Build gate — NON-NEGOTIABLE
After all changes are made, you **MUST** run `docker compose build` from the worktree root, every single time, no exceptions:
```bash
cd "$WORKTREE"
docker compose build
```
There is no scenario where this step is skipped, deferred, or replaced with a different command. Do not commit until this passes.

### 6. On success — commit and push
```bash
cd "$WORKTREE"
git add -A
git commit -m "<concise description>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push -u origin "$SHORT"
```

### 7. On failure — stop and report
Do **not** commit broken code. Report the failure to the user with the full build output.

---

## Notes
- Never merge to `main` — leave that to the user.
- The worktree at `d:/Claude/.tmp/<name>` is a full checkout sharing the git object store — lightweight and isolated.
- If a worktree for the same name already exists, append a short suffix (`-2`, `-3`, …).