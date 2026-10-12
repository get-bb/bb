# Project handoff example

A project-scoped handover brief collects the project's configured sources and
up to 100 active, visible threads into Markdown, with thread mentions and a next
steps checklist. This is useful when handing a project to another person or
starting a planning session. It does not duplicate project settings or rename.

Install from the repository root with `bb plugin install ./examples/plugins/project-handoff`.
Open any project actions dropdown or right-click a sidebar project, then choose
**Export project handoff**. The browser downloads a Markdown file and shows the
selected project name in a success toast. The target comes from the menu, even
when you are viewing another project. Compact long-press menus show the same item.

The same report generator is available with
`bb project-handoff export <project-id>`; redirect stdout to a file if needed.
Use `bb project list --json` to find the ID. Reports include source metadata
and thread titles, so review the contents before sharing them.

After changes, reload with `bb plugin reload project-handoff`.
