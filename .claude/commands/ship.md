---
description: Check, commit and push current changes to the harish branch
---
Ship the current working-tree changes. Be brief; no summaries of unchanged things.

1. `git status --short`. Leave out screenshots, loose images, docs and anything already in .gitignore; flag any other file that looks unrelated instead of committing it.
2. If frontend files changed: `cd frontend && npx tsc -b`. Stop and fix type errors (they break the Vercel build).
3. Stage, then commit with a short message saying what changed for the user, ending with the attribution line.
4. Push: `git -c credential.https://github.com.helper= -c credential.helper=manager push verve harish`
5. Reply in 2-3 lines: commit hash, what went in, anything left out.

$ARGUMENTS
