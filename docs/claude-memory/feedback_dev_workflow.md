---
name: Development workflow rules
description: Mandatory process for all changes — branch, local validation, WAIT FOR APPROVAL, then deploy via GitHub Actions only
type: feedback
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Never make changes directly on main or deploy to AWS without following this process. Never merge without explicit user approval.

1. Create a dev branch from main
2. Implement and validate locally (docker compose up)
3. **Present result to user — WAIT for explicit approval before merging**
4. Update Claude memory files with relevant context
5. Commit on dev branch, push, then merge to main only after approval
6. Deploy happens via GitHub Actions CI/CD — never manually via AWS CLI/console

**Why:** In 2026-04-20, Claude merged and pushed to main without waiting for user approval. In 2026-04-21, multiple commits were made directly to main during hotfixes, violating the branch rule. The approval step is non-negotiable regardless of how confident Claude is that the change is correct.

**How to apply:**
- Before touching any code, create a branch from main: `git checkout -b fix/nome` or `feat/nome`
- Never commit directly to main — not even for "small fixes" or "urgent hotfixes"
- Work in progress → `git add && git commit -m "WIP: descrição" && git push` — never stash
- Before merging, present result to user and wait for explicit approval: "sim/aprovado/pode mergear"
- Never interpret silence, "ok", or mid-conversation agreement as merge approval
- After merge, delete the branch (local and remote)
- Never leave development branches open without active progress
- git stash is forbidden — stash has no history, doesn't go to remote, code in stash is code waiting to be lost
