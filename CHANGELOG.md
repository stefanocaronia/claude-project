# Changelog

What changes for whoever uses Project, version by version. Plugins update in a new chat: `/plugin`, Marketplaces, claude-project, Update marketplace, or turn its auto-update on there.

## Unreleased

- A new task always has a type; the panel and the page offer feature.
- Tidying the backlog groups the tasks that are one piece of work into a large task with its parts.
- `start` and `done` tell Claude about doubles, open waits, commits already citing the task and the tasks it frees; a commit that does a task reminds Claude to close it.
- Changing the project's files with no task in progress in the chat reminds Claude to start the task, or add it.
- The board's columns: To do, In progress, Done, Postponed.
- Open pull requests that cite no task show in the panel and the page, to take into the backlog or close.
- A comment can be edited or deleted; Claude's carry its name.
- In the panel, a face names its person under the pointer, and a section's heading no longer lights up.
- Several people on one project, each with their own Claude: `sync: auto` pulls the shared private docs before each change and pushes after it; two tasks or decisions given one number offline are renumbered, and the same task changed by both merges field by field.
- `.claude/project.local.yaml` holds each person's own settings, never committed; the start of a session writes who you are there, `me:`, from gh.
- A task says who started it where the project has more than one person; another's task in progress shows who, and is never marked stuck.
- An issue written by a person of the project, by their login, is the project's own, as yours; their GitHub picture is on their tasks.
- With Crew, the coordinator you hired draws Claude's tasks with their name and portrait, and takes tasks by their name; a portrait Claude drew for a colleague, `avatar.svg`, is drawn as a picture would be.

## 0.15.0

- A task's code is only what does it. The panel refined: links as chips, bold headings, counts in brackets, the page linked.

## 0.14.0

- A generic importer from any other tool, deleting a task, and the panel's buttons and chips drawn with icons and rounded corners.

## 0.13.0

- Comments on tasks and clickable links; private docs as the default, also later (`init.mjs private`); safety of text from outside.

## 0.12.0

- GitHub issues in sync with the backlog, where the project turns it on; tasks, decisions and specs read only through the plugin's commands.

## 0.11.0

- Versions only where the project releases; contracts that raise at least a minor version; checks before a release.

## 0.10.0

- Crew's todos are the colleagues' notebooks: tidying the backlog brings in the lines that are work for the project.

## 0.9.0

- Specifications in the core: `SPECS.md` with `S-n` numbers, cited by tasks, decisions and code, with their coverage.

## 0.8.3

- Fixes: the tidy split between docs and backlog; the page stays up on code half-written; the panel shows the versions' history.

## 0.8.2

- Fixes: versions are the repo's tags, with their notes; descriptions of docs from their first paragraph.

## 0.8.1

- Fixes: the page restarts by itself when the plugin changes; frontmatter on the plugin's docs.

## 0.8.0

- The first version with release notes: tasks with types, due days, waits and parts; panel and page aligned; the core in English.
