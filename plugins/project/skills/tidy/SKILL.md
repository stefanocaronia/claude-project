---
name: tidy
description: Tidy the project - the docs made compliant with the plugin's architecture (the core's English names and format, every doc's frontmatter, spacing, links, the index, the folders), and the backlog with the decisions (types, priorities, who does each task, tasks done or made moot, duplicates; decisions superseded, doubled or scattered, reordered and merged, never resolved). Use when the user asks to tidy, clean up or compact the docs, the backlog, the tasks or the decisions, or when check.mjs reports errors.
---

# Tidying the project

Two tidies, each with its own button, never mixed:

- **The docs** (the panel's «Tidy the docs»; on the page, «Fix names, frontmatter and spacing» for the mechanical part and «Prepare the proposals» for the rest): the docs made compliant with the plugin's architecture. Their form, never their content: no decision, no point to decide, no task changes here.
- **The backlog and the decisions** (the panel's and the page's «Tidy the backlog»): the tasks and the decisions together, since each speaks of the other. Reordered, cleared of what is superseded or done, merged where doubled; an open point is never resolved.

Half deterministic, half judgment: the script finds; you fix what is mechanical and what is clear, and ask the user only whether an item still stands, where you cannot tell. Tidying never asks them to decide. Speak to the user in the project's language.

## 1. The report

`node "<this skill's folder>/../../scripts/check.mjs"`: errors, warnings and notes, each with file and line. The page's Health tab shows the same list, with the buttons of the cleanup.

## 2. The docs

The docs as the plugin's architecture wants them, all of it without asking:

- **The core's names and format**: core files under their old Italian names (`DECISIONI.md`, `archivio/`, `compiti/`) or in the format's old words (`## In corso`, `· fatto`, `## Traguardi`, `## Da decidere`; the check says `names`): `init.mjs rename --write`, which moves them to the English names with git, writes the format's words in English, leaves the project's own text as it is and makes the docs' links follow; then fix, with the user, the files outside the docs it lists as still naming them.
- **Frontmatter and spacing**: docs without their frontmatter or with a part of it, a description an older version took from a code line or a label (the check says `frontmatter`), trailing spaces, double blank lines: `check.mjs --fix`. The plugin's docs are the core, with its archive, notes and releases, and the project-management docs added beside it or named in `documents:` (a GDD); never the folders added inside the docs, manuals or the project's own markdown.
- **Links**: a broken link whose target only moved takes the new path; one whose target is gone goes.
- **The index and the folders**: a doc outside the index goes into it, or into the archive folder if its work is closed.
- **A specifications' document** the project keeps under its own name (`SPECIFICHE.md`, `REQUIREMENTS.md`, the one `documents:` names as such): propose `specs.mjs adopt <file>`, which makes it the core's SPECS.md, its specs numbered and its text as it was; on the user's yes, `--write`. A line of SPECS.md that opens as a spec and does not read (the check says `specs`) is put back in the form `- S-12 · the text`.
- **Heavy files**: say them in the report. Compacting a doc's content is not this tidy: the decisions' file is compacted by the backlog's, the others by the user.

The mechanical part (names, format, frontmatter, spacing) the page's button does in one go, without Claude. Then `check.mjs`, and a short report of what changed.

## 3. The backlog and the decisions

When the user asks to tidy the backlog (the panel's «Tidy the backlog», or the page's), read it whole with `backlog.mjs list --json` and `backlog.mjs list --state done --json`, the plan's goals, the decisions and the points still to decide, then, in this order:

1. **First, the minimum**, yourself and without asking, through `backlog.mjs`, for every task to do, in progress or postponed, large tasks included:
   - its type, when missing or wrong;
   - its priority, when it no longer fits: P1 only for what blocks the work at hand or the next step;
   - who does it (`set T-n --to …`): Claude for work in the code and the docs it can do alone; the user for what only a person can do (an account, a purchase, a test in their hands, a choice of taste); with Crew, the colleague whose field it is, as their profile in `.claude/agents/` says;
   - a part's goal, its large task's;
   - its text, kept to the line's rules: one line, clear, no « · »;
   - no colleague's todo line citing a task closed or missing, and none without a date (`task-dates.mjs --write`, the day the line appeared in git).

   When this is done, every open task has a type, a priority and who does it.
2. **Then the decisions, with the backlog**: reordered, cleared and merged, never resolved. Edit the decisions' file with Edit.
   - **Superseded**: a row revised whole by a later accepted one keeps its number, reduced to `| 412 | <superseded marker> D-427: <three or four words>. | |`. A number is never deleted or reused: code cites it. A revision in part leaves the row as it is.
   - **Doubled**: two rows that say the same thing: the later one reduced to the same marker, pointing to the first. A number used twice: the newer row takes the first free number past the highest (`decisions.mjs next`), after reading every reference to know which of the two it means; references can be in code too.
   - **Points to decide**: one a decision already took, or later work made moot, goes (the report says which row closed it); two on the same question merge into one that keeps who asked and the older date; scattered ones on one subject sit together. One still open stays open, as it is, whatever its age: never decided, never rewritten into a decision, never turned into a question for the user. It is theirs to take up when they want.
   - **A heavy decisions' file**: the superseded rows first, then the lines that repeat what another already says.
   - **The specifications**, where the project keeps them (`specs.mjs`), the same way: a spec a later accepted decision changed is written again to say what is now true, naming the decision; one it dropped keeps its number, its text opening with the superseded marker and the decision; two that ask the same thing: the later one dropped, pointing to the first; a number used twice: the newer takes `specs.mjs next`, after reading what cites it. A task that plainly does a spec and does not cite it gets `(see: S-12)`. Never a spec invented, never one removed because no task does it yet.
3. **Then the rest of the backlog that is clear**, yourself:
   - tasks plainly done by another task or a commit (`show` names the code that cites a task), closed with `done`; tasks a later accepted decision made moot or contradicted, archived or rewritten to agree with it;
   - tasks that belong together as one piece of work, grouped as a large task with its parts, `(in: T-n)`, one level deep, when it is clear (when it is not, it is a question of step 4);
   - duplicates: one archived, the other pointing to it with `(see: T-n)`; waits that no longer hold, cycles of waits and links to tasks that are not there (`set T-n --after …` / `--see …`), goals that changed, the note of a task long archived.
4. **Then ask**, in the question form, only what you could not decide alone because it is not trivial: whether a task or a point still stands, or a form choice really in doubt (a large task's grouping, say). Never what to decide about an open point.
5. **Leave** an open point, a vague task or anything not superseded as it is, with no question.
6. At the end `check.mjs`, and a short report of what you changed and why, by item, so that the user can undo it.

## Asking, in both

Tidying never asks the user to decide anything. For a decision, a point to decide or a task, the only question is whether it still stands: left as it is, obsolete, contradicted by a decision accepted later, or already done. Answer it yourself, reading the decisions, the plan and the code, and apply what is clear without asking.

**First do all you can alone; then ask, in the question form, only what you cannot decide** because it is not trivial: the evidence points both ways, or the answer is the user's to know. Never before the work you can do is done, never for what is clear, never «decide this» about an open point's content: a question asks whether an item stands («still open, or closed by D-427?», «still to do, or done by 0715a26?»), or settles a form choice really in doubt. An item you cannot tell and that nothing contradicts stays as it is, with no question. The questions go in the question form (AskUserQuestion), never as a wall of text: one an item, at most four a form. The options are the answer you think likely, first, and «it stands», always a normal answer and never a retreat.

## The rules that stay

- The docs hold only what is decided, in short.
- The backlog changes only through `backlog.mjs`, but for a task's text.
- Edit files with Edit; Python writes CRLF and `node -e` loses backslashes.
- At the end, `check.mjs` again, and a short report to the user of what changed. Commit only when they ask.
