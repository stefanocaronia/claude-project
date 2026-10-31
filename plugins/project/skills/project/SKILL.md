---
name: project
description: The project's plan, backlog and decisions, kept in markdown by deterministic commands. Use whenever the work adds, starts, finishes, postpones or reassigns a task, needs a task's or a decision's number, looks a decision up or records a new one, reads the plan's goals, or checks the project docs' health; in a project with .claude/project.yaml.
---

# The project's plan, tasks and decisions

The project's key documents, when `.claude/project.yaml` lists them under `documents:` (a game's GDD, a specification, a business plan), are the first to read before deciding or planning anything.

The project keeps three documents in its docs folder (`docs:` in `.claude/project.yaml`), in its own language: the **plan** (phases and goals), the **backlog** (one task a line) and the **decisions** (a numbered table, and the points still to decide). The commands below are the only way to change the backlog and to get numbers: never count by hand, never edit a task line but for its text.

Run them with Bash, from the project's folder: `node "<this skill's folder>/../../scripts/<script>.mjs" …`. Their messages are in the project's language and say how to fix what they refuse. Where the user has run `npm link` in the plugin's folder, the same are `project backlog …`, `project plan …`, `project check`, and so on: the start of the session says so, and then call them that way, shorter; tell the user when they ask how to use the commands outside Claude Code. Never run `npm link` yourself: it installs a command on their machine.

## The backlog: `backlog.mjs`

A task: `- T-12 · P2 · <effort> · <who> · 2026-10-29 · <goal> · text`, under the heading of its state (in progress, to do, postponed, done), archived ones in the archive. Its text may end with its links: `(after: T-62, #giulia-1)`, the tasks it waits for (a backlog task, or a line of a colleague's todo by its Crew id), and `(see: T-9, D-2)`, tasks and decisions to read with it; `(in: T-23)` makes it a part of a large task.

| Command | Does |
|---|---|
| `add "text" --goal "<goal>" [--p P1\|P2\|P3] [--effort <word>] [--to <name>] [--state todo\|doing\|postponed\|done] [--type bug] [--in T-23] [--by <name>]` | a new task, numbered, dated today (a part, `--in`, takes its large task's goal unless one is given), with who created it: `(by: Claude)` unless `--by` names the person or colleague who asked for it |
| `start`, `done`, `postpone`, `todo` `T-12 [T-13…]` | moves tasks to that state; done carries today's date |
| `set T-12 [--p …] [--effort …] [--to …] [--goal …] [--text …] [--after "T-3, #giulia-1"] [--see "T-9, D-2"] [--in T-23] [--issue 34] [--due 2026-11-15] [--type bug]` | changes a task; `--after ""` clears; a wait that closes a cycle, or a number that does not exist, is refused |
| `add --issue 34 ["text"]`, `issue-close T-12` | a task from a GitHub issue; the issue closed on GitHub, only on the user's yes |
| `note T-12` | the task's note, `<docs>/tasks/T-12.md`, written when missing: its path |
| `archive T-12…` or `archive --done` | moves tasks to the archive |
| `show T-12…` | a task, what it waits for and the chain to do first, what waits for it, its links both ways, its large task or its parts and the next one, its note, the commits and pull requests that cite it |
| `list [--state …] [--to …] [--p …] [--goal …] [--json]`, `find <words>`, `goals`, `next` | reads |

- **Priority**: P1 high (it blocks the work at hand or the next step), P2 normal (in the plan), P3 low (later, or only if the work asks). **Effort**: the project's words for Claude Code's levels, low to max, as much as the task needs.
- **Who**: the people of the configuration and, when the project has Crew, its colleagues by first name. A colleague's real work is a task assigned to them; their `todo.md` cites it by number.
- **Creator**: `(by: Stefano)` at the end of a task says who created it. A task you add because the user asked for that very task is theirs: `--by <their name>`; one you propose yourself, or one a colleague's review brought, is Claude's or that colleague's. The page and the panel add with their owner's name.
- **Goal**: one of the plan's goals, as the plan's `###` heading names it without its phase, or the project's "no goal" mark.
- **Waits**: a task blocked by one still open waits; start the chain from its first link, on one yes from the user (`show` gives it in order). A colleague's todo line that is their part of a backlog task carries its number where Crew puts its id: `- [ ] P1 · 2026-10-28 · T-61 · text`.
- **Type and due day**: `(type: bug)` (bug, feature, chore, research, test for a test or a playtest, or a type of the project's `types:`; `--type` takes the key or its name in the project's language) and `(due: 2026-11-15)`, with `set --type` and `--due`. A due day near or past shows on the task; the check warns when it is past.
- **Started**: `start` writes the day a task started at the end of its line (`· started 2026-10-30`); the check warns about a task in progress for more than three days that no chat and no colleague holds: take it up again, or put it back to do.
- **Decisions and tasks**: a task's `(see: D-7)` and a decision whose text names `T-12` tie them both ways: `show`, the panel and the page list a task's decisions and a decision's tasks.
- **Large tasks**: work too big for one task, not a goal, is a task whose parts each end with `(in: T-23)`, one level deep. A part started starts the large task; when its last part closes, the command says so and done is yours to say. Start the work from its next part (`show` names it); `list --atomic` leaves the large tasks out.
- **The code**: a commit or a pull request that does a task cites its number in its message or title (`… (T-12)`): `show`, the panel and the page list them on the task, and the check notes a task still open that a merged pull request cites.
- **GitHub issues** (with `gh` and a repo on GitHub): `add --issue 34` makes a task of an issue, its title the text unless one is given, ending with `(issue: #34)`; one task an issue. When a task with an open issue is done, the command says so: ask the user once whether to close it on GitHub, and only on a yes run `issue-close T-12`, which closes it with a comment naming the task and its commits.
- **Reopened**: when the user says something new about a task already done or archived (it does not work, something is missing, a change to it), it is that task again, not a new one: `start T-12` brings it back in progress, out of the archive too, and what is new goes into its text or its note. A new task only when the work is a different one.
- **The project's own fields**, when its configuration declares them (`fields:`): `(system: 5e)` at the end of a line, set with `--system 5e` on `add` or `set`; a field that lists its values takes only those.
- **Export and import**: `export [--format json|csv|<an extension's>] [--all | --state …]` writes the tasks on stdout; `import <file> [--format …] [--by <name>]` adds a file's tasks as new ones, numbered here, all or none; `--by` names who brought them.
- **The note**: when a task needs more than its line (the long context, what was tried, where the work got to), write it in its note with `note T-12`; before taking a task up again, read its note.
- When a colleague is given a task whose number is in the brief, the panel moves it to in progress itself. **Done** is yours to say, after reading their report: work finished is not always a task closed.

## The decisions: `decisions.mjs`

`next` (the free number: past every row and every number cited anywhere, so two sessions never take the same), `show 287 540`, `find <words> [--full]`, `cites 287`. A new decision takes its number from `next`, goes in the table as `| 541 | what is decided | why |`, and in the document it concerns. Only what the user has decided goes in the table; a proposal goes under "to decide" until they decide.

## The plan

Phases in its table (`| 2. Name | at the end you can… |`), goals as `### Name (phase 2)` under the goals heading, the line "updated on YYYY-MM-DD" kept true. A goal whose tasks are all done or archived closes with `plan.mjs close "<goal>"`: its heading gets its day, `· done 2026-10-30`, it leaves the open bars and takes no new tasks; `plan.mjs open "<goal>"` opens it again, `plan.mjs goals` lists them by phase, `plan.mjs phases` says which phases are closed: a phase closes when every goal of it has. The plan says where the project goes; the tasks say what is left.

## Health: `check.mjs`

`check.mjs` reports errors, warnings and notes with file and line: decision numbers twice or missing, decisions cited that do not exist, backlog lines that do not read, links to tasks that do not exist, cycles of waits, a todo id nobody gave, a note of a task that is not there, a colleague's todo citing a task that is not there, old proposals, broken links, heavy files. `--fix` mends only whitespace. After changing the docs, run it; errors are fixed before the work is called done. The cleanup beyond that is the `tidy` skill.

## The docs' frontmatter

Every markdown doc of the project starts with a frontmatter block: `title`, `description` (one sentence of what it holds), `type`, `created`, `updated`. The plugin's docs are the core (the plan, the backlog, the decisions, the index, the archive, the tasks' notes, the releases) and the project-management docs the user adds beside them in the docs' folder or names in `documents:` (a GDD, a specification, a glossary): every one of these has it. Not the folders the user adds inside the docs (playtests, branding), nor manuals, nor the markdown of the project itself (its README, its source's docs): those are the user's, as they are. The commands write it, and the plugin's hook keeps `updated` true after you edit a doc; a new doc you write by hand starts with it, and the check notes one without it. `check.mjs --fix`, the page's mechanical cleanup and the panel's «tidy the docs» write what is missing, with the days from git: you never stamp docs by hand. Keep a doc's description true when what it holds changes.

## GitHub

The `github` skill sets the project up on GitHub and keeps it there: git and gh installed and signed in, the repo, the private docs' repo, GitHub Pages with their workflow, a custom domain, releases. Use it when the user works with GitHub or the start of the session says git or gh is missing.

## Versions and releases: `release.mjs`

As the trade does it (Semantic Versioning and Keep a Changelog), a version is a release, never a commit. Commits and pushes go on without one; the work done since the last release waits for the next.

- **When**: a release is due when a goal or a phase of the plan closes, when the work done since makes a whole that users notice, or when a fix cannot wait. No number of tasks makes one due, and twelve versions in two days are eleven too many. `status` says the last release, what is done since and whether something makes a release due; propose one then, and write it only on the user's yes.
- **What counts**: the repo's tags, `v1.2.3`, are the versions; the notes in `<docs>/releases` go with their tag, and a tag without notes holds the work done by its day. Without tags, the version of the project's `package.json`. A project that released before the plugin starts from where it is, never from 0.1.0.
- **Which number**, MAJOR.MINOR.PATCH, from the work it holds: a change that breaks what users rely on (a file format, a command, a setting that no longer reads) raises MAJOR, MINOR before 1.0.0; a new feature raises MINOR; fixes and maintenance alone raise PATCH. `status` suggests it from the tasks' types; say what breaks with `--breaking "a; b"`, which only you can judge.
- **The notes**: `notes [<version>]` drafts them from the tasks done since, by kind (added, fixed, maintenance, other), `write <version> --summary "…"` keeps them in `<docs>/releases/v<version>.md`, each listing its tasks so that the next starts where it ends. The summary is one or two short sentences of what the release brings, for its users: at most about 200 characters (it is the notes' description in their frontmatter too); the detail is in the notes' sections.
- **Its title**, on GitHub or anywhere a release has one, is the version alone, `v0.8.0`, as the trade has it; the summary opens the notes, never the title.
- **Then**, on the user's word: the project's own version files (package.json, a plugin's manifest…), a commit, the tag `v<version>` on it; pushing and publishing are theirs to ask.

## The panel and the page

The panel beside the chat (`/project-panel` shows or hides it) has the tasks in progress and the P1 to do, each with ▶ (a blocked one shows «⛓ T-62» and its ▶ asks for the whole chain), the goals with their bars, the decisions to take. The page with the charts is served at `http://localhost:<page.port>` (without it, a port of 5800–5999 that the project's folder gives; the start of a session says it) from the start of a session.
