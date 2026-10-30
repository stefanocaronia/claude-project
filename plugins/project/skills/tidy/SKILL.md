---
name: tidy
description: Tidy the project docs - plan, backlog, decisions, the colleagues' todos and the other docs - superseded or duplicate decisions, steps to compact, tasks without priority or date, broken links, docs outside the index, files too heavy. Use when the user asks to tidy, clean up or compact the docs, the decisions or the tasks, or when check.mjs reports errors.
---

# Tidying the project docs

Half deterministic, half judgment: the script finds; you fix what is mechanical and propose to the user what changes a meaning. Speak to the user in the project's language.

## 1. The report

`node "<this skill's folder>/../../scripts/check.mjs"`: errors, warnings and notes, each with file and line. The page's Health tab shows the same list, with the buttons of the cleanup: the mechanical one, and a run of Claude Code that prepares the proposals and then applies those the user ticks.

## 2. To fix without asking

- Trailing spaces and double blank lines: `check.mjs --fix`.
- Tasks without a date in the colleagues' todos: `task-dates.mjs --write` (the day the line appeared in git).
- A decision number used twice: the newer row takes the first free number past the highest (`decisions.mjs next`). Read every reference before changing it, to know which of the two it means; references can be in code too.
- A broken link whose target only moved: the new path. A target that is gone goes among the proposals.

## 3. To propose to the user

A numbered list, the most important first: what, why, what changes. Applied only on their yes, point by point.

- **Superseded decisions**: the row keeps its number, reduced to `| 412 | <superseded marker> D-427: <three or four words>. | |`. A number is never deleted or reused: code cites it. Superseded means revised whole; a revision in part leaves the row as it is.
- **Old proposals** under "to decide": decide them, or remove them if a decision already closed them (say which).
- **Tasks**: priorities that no longer fit, tasks a later decision or piece of work already closed (`backlog.mjs done` or `archive`), a colleague's todo line citing a task closed or missing; a cycle of waits or a link to a task that is not there (`backlog.mjs set T-n --after …` / `--see …`), the note of a task long archived.
- **Docs outside the index**: into it, or into the archive folder if the work is closed.
- **Heavy files**: the superseded rows first, then the lines that repeat what another already says.

## 4. The backlog

When the user asks to tidy the backlog (the panel's «Tidy the backlog», or the page's), read it whole with `backlog.mjs list --json` and `backlog.mjs list --state done --json`, the plan's goals and the decisions, then:

- **Fix without asking** what changes no meaning: a task's text that breaks the line's rules or reads badly (one line, clear, no « · »), a part whose goal differs from its large task's, a type plainly wrong or missing where the text says it (a bug, a research).
- **Propose**, numbered, the most useful first, each with the `backlog.mjs` command that applies it:
  - priorities that no longer fit: P1 only for what blocks the work at hand or the next step;
  - tasks that belong together as one piece of work: a large task with its parts, `(in: T-n)`, one level deep;
  - tasks another task or a commit already did (`show` names the code that cites a task), to close with `done`;
  - tasks a later decision made moot, revised or contradicted (read the decisions they cite and the later ones), to close or rewrite;
  - duplicates, to archive one and point the other to it with `(see: T-n)`;
  - waits that no longer hold, goals that changed.
- Apply only what the user says yes to, through `backlog.mjs` alone; at the end `check.mjs` and a short report.

## The rules that stay

- The docs hold only what is decided, in short.
- The backlog changes only through `backlog.mjs`, but for a task's text.
- Edit files with Edit; Python writes CRLF and `node -e` loses backslashes.
- At the end, `check.mjs` again, and a short report to the user of what changed. Commit only when they ask.
