---
name: project
description: The project's plan, backlog and decisions, kept in markdown by deterministic commands. Use whenever the work adds, starts, finishes, postpones or reassigns a task, needs a task's or a decision's number, looks a decision up or records a new one, reads the plan's goals, or checks the project docs' health; in a project with .claude/project.yaml.
---

# The project's plan, tasks and decisions

The project's key documents, when `.claude/project.yaml` lists them under `documents:` (a game's GDD, a specification, a business plan), are the first to read before deciding or planning anything.

The project keeps three documents in its docs folder (`docs:` in `.claude/project.yaml`), in its own language: the **plan** (phases and goals), the **backlog** (one task a line) and the **decisions** (a numbered table, and the points still to decide). The commands below are the only way to change the backlog and to get numbers: never count by hand, never edit a task line but for its text.

Run them with Bash, from the project's folder: `node "<this skill's folder>/../../scripts/<script>.mjs" …`. Their messages are in the project's language and say how to fix what they refuse.

## The backlog: `backlog.mjs`

A task: `- T-12 · P2 · <effort> · <who> · 2026-10-29 · <goal> · text`, under the heading of its state (in progress, to do, postponed, done), archived ones in the archive. Its text may end with its links: `(after: T-62, #giulia-1)`, the tasks it waits for (a backlog task, or a line of a colleague's todo by its Crew id), and `(see: T-9, D-2)`, tasks and decisions to read with it; `(in: T-23)` makes it a part of a large task.

| Command | Does |
|---|---|
| `add "text" --goal "<goal>" [--p P1\|P2\|P3] [--effort <word>] [--to <name>] [--state todo\|doing\|postponed\|done]` | a new task, numbered, dated today |
| `start`, `done`, `postpone`, `todo` `T-12 [T-13…]` | moves tasks to that state; done carries today's date |
| `set T-12 [--p …] [--effort …] [--to …] [--goal …] [--text …] [--after "T-3, #giulia-1"] [--see "T-9, D-2"] [--in T-23]` | changes a task; `--after ""` clears; a wait that closes a cycle, or a number that does not exist, is refused |
| `note T-12` | the task's note, `<docs>/tasks/T-12.md`, written when missing: its path |
| `archive T-12…` or `archive --done` | moves tasks to the archive |
| `show T-12…` | a task, what it waits for and the chain to do first, what waits for it, its links both ways, its large task or its parts and the next one, its note |
| `list [--state …] [--to …] [--p …] [--goal …] [--json]`, `find <words>`, `goals`, `next` | reads |

- **Priority**: P1 high (it blocks the work at hand or the next step), P2 normal (in the plan), P3 low (later, or only if the work asks). **Effort**: the project's words for Claude Code's levels, low to max, as much as the task needs.
- **Who**: the people of the configuration and, when the project has Crew, its colleagues by first name. A colleague's real work is a task assigned to them; their `todo.md` cites it by number.
- **Goal**: one of the plan's goals, as the plan's `###` heading names it without its phase, or the project's "no goal" mark.
- **Waits**: a task blocked by one still open waits; start the chain from its first link, on one yes from the user (`show` gives it in order). A colleague's todo line that is their part of a backlog task carries its number where Crew puts its id: `- [ ] P1 · 2026-10-28 · T-61 · text`.
- **Large tasks**: work too big for one task, not a goal, is a task whose parts each end with `(in: T-23)`, one level deep. A part started starts the large task; when its last part closes, the command says so and done is yours to say. Start the work from its next part (`show` names it); `list --atomic` leaves the large tasks out.
- **The note**: when a task needs more than its line (the long context, what was tried, where the work got to), write it in its note with `note T-12`; before taking a task up again, read its note.
- When a colleague is given a task whose number is in the brief, the panel moves it to in progress itself. **Done** is yours to say, after reading their report: work finished is not always a task closed.

## The decisions: `decisions.mjs`

`next` (the free number: past every row and every number cited anywhere, so two sessions never take the same), `show 287 540`, `find <words> [--full]`, `cites 287`. A new decision takes its number from `next`, goes in the table as `| 541 | what is decided | why |`, and in the document it concerns. Only what the user has decided goes in the table; a proposal goes under "to decide" until they decide.

## The plan

Phases in its table (`| 2. Name | at the end you can… |`), goals as `### Name (phase 2)` under the goals heading, the line "updated on YYYY-MM-DD" kept true. A goal whose tasks are all done or archived closes with `plan.mjs close "<goal>"`: its heading gets its day, `· done 2026-10-30`, it leaves the open bars and takes no new tasks; `plan.mjs open "<goal>"` opens it again, `plan.mjs goals` lists them. The plan says where the project goes; the tasks say what is left.

## Health: `check.mjs`

`check.mjs` reports errors, warnings and notes with file and line: decision numbers twice or missing, decisions cited that do not exist, backlog lines that do not read, links to tasks that do not exist, cycles of waits, a todo id nobody gave, a note of a task that is not there, a colleague's todo citing a task that is not there, old proposals, broken links, heavy files. `--fix` mends only whitespace. After changing the docs, run it; errors are fixed before the work is called done. The cleanup beyond that is the `tidy` skill.

## The panel and the page

The panel beside the chat (`/project-panel` shows or hides it) has the tasks in progress and the P1 to do, each with ▶ (a blocked one shows «⛓ T-62» and its ▶ asks for the whole chain), the goals with their bars, the decisions to take. The page with the charts is served at `http://localhost:<page.port>` (without it, a port of 5800–5999 that the project's folder gives; the start of a session says it) from the start of a session.
