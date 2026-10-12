---
name: project-handoff
description: Export a Markdown handoff brief with the selected project's sources and active threads.
---

Use `bb project list --json` to find the project ID, then run
`bb project-handoff export <project-id>`. The output includes configured sources,
up to 100 active visible threads, and a handover checklist. Redirect stdout to a
file when a saved brief is requested. Review source paths and thread titles
before sharing. The project menu's Export project handoff item downloads the
same report.
