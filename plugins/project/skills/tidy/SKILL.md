---
name: tidy
description: Tidy the project docs - plan, backlog, decisions, the colleagues' todos and the other docs - superseded or duplicate decisions, steps to compact, tasks without priority or date, broken links, docs outside the index, files too heavy. Use when the user asks to tidy, clean up or compact the docs, the decisions or the tasks, or when check.mjs reports errors.
---

# Tidying the project docs

Half deterministic, half judgment: the script finds; you fix what is mechanical and what is clear, and ask the user only whether an item still stands, where you cannot tell. Tidying never asks them to decide. Speak to the user in the project's language.

## 1. The report

`node "<this skill's folder>/../../scripts/check.mjs"`: errors, warnings and notes, each with file and line. The page's Health tab shows the same list, with the buttons of the cleanup: the mechanical one, and a run of Claude Code that prepares the proposals and then applies those the user ticks.

## 2. To fix without asking

- Trailing spaces and double blank lines: `check.mjs --fix`.
- Core files under their old Italian names (`DECISIONI.md`, `archivio/`, `compiti/`) or in the format's old words (`## In corso`, `· fatto`, `## Traguardi`, `## Da decidere`; the check says `names`): `init.mjs rename --write`, which moves them to the English names with git, writes the format's words in English, leaves the project's own text as it is and makes the docs' links follow; then fix, with the user, the files outside the docs it lists as still naming them.
- Tasks without a date in the colleagues' todos: `task-dates.mjs --write` (the day the line appeared in git).
- A decision number used twice: the newer row takes the first free number past the highest (`decisions.mjs next`). Read every reference before changing it, to know which of the two it means; references can be in code too.
- A broken link whose target only moved: the new path. A target that is gone: the link goes too; ask only if you cannot tell whether it still stands.

## 3. What changes a meaning

Tidying never asks the user to decide anything. For a decision, a point to decide or a task, the only question is whether it still stands: left as it is, obsolete, contradicted by a decision accepted later, or already done. Answer it yourself, reading the decisions, the plan and the code, and apply what is clear without asking; say what you changed in the report at the end, so that the user can undo it.

- **Superseded decisions**: a row revised whole by a later accepted one keeps its number, reduced to `| 412 | <superseded marker> D-427: <three or four words>. | |`. A number is never deleted or reused: code cites it. A revision in part leaves the row as it is.
- **Points under "to decide"**: one a decision already took, or later work made moot, is removed (the report says which row closed it). One still open stays as it is, whatever its age: it is the user's to take up when they want.
- **Tasks**: a task a later decision or piece of work already closed (`backlog.mjs done` or `archive`), a colleague's todo line citing a task closed or missing; a cycle of waits or a link to a task that is not there (`backlog.mjs set T-n --after …` / `--see …`), the note of a task long archived.
- **Docs outside the index**: into it, or into the archive folder if the work is closed.
- **Heavy files**: the superseded rows first, then the lines that repeat what another already says.

**First do all you can alone; then ask, in the question form, only what you cannot decide** because it is not trivial: the evidence points both ways, or the answer is the user's to know. Never before the work you can do is done, never for what is clear, never «decide this» about an open point's content: a question asks whether an item stands («still open, or closed by D-427?», «still to do, or done by 0715a26?»), or settles a form choice really in doubt. An item you cannot tell and that nothing contradicts stays as it is, with no question. The questions go in the question form (AskUserQuestion), never as a wall of text: one an item, at most four a form. The options are the answer you think likely, first, and «it stands», always a normal answer and never a retreat.

## 4. The backlog

When the user asks to tidy the backlog (the panel's «Tidy the backlog», or the page's), read it whole with `backlog.mjs list --json` and `backlog.mjs list --state done --json`, the plan's goals, the decisions and the points still to decide, then, in this order, as section 3 says:

1. **First, the minimum**, yourself and without asking, through `backlog.mjs`, for every task to do, in progress or postponed, large tasks included:
   - its type, when missing or wrong;
   - its priority, when it no longer fits: P1 only for what blocks the work at hand or the next step;
   - who does it (`set T-n --to …`): Claude for work in the code and the docs it can do alone; the user for what only a person can do (an account, a purchase, a test in their hands, a choice of taste); with Crew, the colleague whose field it is, as their profile in `.claude/agents/` says;
   - a part's goal, its large task's;
   - its text, kept to the line's rules: one line, clear, no « · »;
   - no colleague's todo line citing a task closed or missing.

   When this is done, every open task has a type, a priority and who does it.
2. **Then the rest that is clear**, yourself (the points to decide with Edit, only under their heading):
   - tasks plainly done by another task or a commit (`show` names the code that cites a task), closed with `done`; tasks a later accepted decision made moot or contradicted, archived or rewritten to agree with it;
   - tasks that belong together as one piece of work, grouped as a large task with its parts, `(in: T-n)`, one level deep, when it is clear (when it is not, it is a question of step 3);
   - duplicates: one archived, the other pointing to it with `(see: T-n)`; two points to decide on the same question merged into one that keeps who asked and the older date; waits that no longer hold, goals that changed;
   - points to decide that a decision already took or later work made moot, removed.
3. **Then ask**, in the question form, only what you could not decide alone because it is not trivial: whether a task or a point still stands, or a form choice really in doubt (a large task's grouping, say). Never what to decide about an open point.
4. **Leave** an open point, a vague task or anything not superseded as it is, with no question.
5. At the end `check.mjs`, and a short report of what you changed and why, by item.

## The rules that stay

- The docs hold only what is decided, in short.
- The backlog changes only through `backlog.mjs`, but for a task's text.
- Edit files with Edit; Python writes CRLF and `node -e` loses backslashes.
- At the end, `check.mjs` again, and a short report to the user of what changed. Commit only when they ask.
