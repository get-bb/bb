---
name: repo-conventions
description: Conventions for working in this repository — commit style, branch naming, and testing expectations. Use when writing commits, opening PRs, or adding tests here.
---

# Repo conventions

Search the bundled docs before guessing:

```
bb docs search "conventional commits"
```

- Commits follow conventional-commit style (`feat(scope): summary`).
- Branches are named `bb/<topic>`.
- Every bug fix ships with a regression test.
