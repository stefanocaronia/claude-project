# Structure

What each folder holds, what it may import, and where new code goes. It changes in the same change that adds, moves or removes a folder.

## The repo

| Folder | What it holds |
|---|---|
| `.claude-plugin/` | the marketplace, `marketplace.json`, with the plugin's version |
| `plugins/project/` | the plugin, below |
| `docs/` | the guide for whoever uses Project, and this page |
| `tools/` | the maintainer's tools: the README's pictures (`screenshots.mjs`) and the panel as an HTML page (`preview.mjs`) |
| `images/` | the README's pictures, which `tools/screenshots.mjs` makes |
| `project/` | this project's own plan, tasks and decisions, a private repo of its own; ignored here |

## The plugin

`plugins/project/` is split by part, as MVC: the model, the commands that drive it, and two views, the page and the panel. Inside each part, a file or a folder an area: the backlog, the decisions, the plan, the specs, the releases, GitHub, Crew.

| Folder | What it holds | Imports |
|---|---|---|
| `lib/` | **The model**: the docs' formats read, checked and written back as text. A task line (`backlog`), its links, note and days (`links`, `notes`, `schedule`); the decisions, the plan, the specs, the releases and contracts, the frontmatter; a colleague's todo and profile (`todos`, `crew`); the configuration's defaults (`config`); what the commits and the GitHub issues mean for the tasks (`code`, `issues`); the words, `words` for the docs and `messages` for the commands and the panel. Pure: it reads no file, runs no process, reads neither the clock nor the environment; so the commands, the page and the panel share it. | `lib/` alone |
| `lib/vendor/yaml/` | The `yaml` package as it comes, never edited. | itself |
| `scripts/` | **The commands**, one file each, run with `node` by Claude, the hooks, Crew and the `project` command (`cli.mjs`). `project.mjs` is the project on disk, which they all share: its root and configuration, the docs read and written through `lib/`, git, the people and the colleagues. | `lib/`, `project.mjs`; today other commands too (Not yet, below) |
| `page/` | **The page** in the browser. `ensure.mjs` starts it when a session starts, `serve.mjs` serves it and runs what the user changes through the commands, `collect.mjs` reads the project into its data, `tidy.mjs` runs its cleanup. `app/` is the browser's side, one script a tab and `helpers.js` they share, loaded in order by `index.html`; `words.js` its words. | `lib/`, `scripts/`; `app/` only the server, by HTTP |
| `hooks/` | **The panel** beside the chat, a Claude Code mod. `register.tsx` hooks it in; `project.ts` reads the project through `scripts/snapshot.mjs`, `state.ts` keeps the panel's state, `holds.ts` what each chat holds, `start.ts` what the panel asks of the chat and of Crew; `panel.tsx`, `sections.tsx`, `tasks.tsx`, `goals.tsx`, `details.tsx`, `kit.tsx` and `draw.ts` draw it. | `lib/`, `types/`; the commands only by running them |
| `types/` | The panel's state contract, `index.d.ts`. | — |
| `skills/` | What Claude does, a folder a skill: `project`, `init`, `tidy`, `github`. | the commands, by path |
| `test/` | The tests, a file an area, each module through its public API: `node --test`. The panel's are `hooks/register.test.tsx`: `claude plugin test`. | everything |

## Fixed paths

Others call these by path: they never move, while their code may move behind them.

- `scripts/<command>.mjs`: Crew runs `scripts/backlog.mjs`; the skills, the guide and the messages name the commands; the `project` command is `scripts/cli.mjs`.
- `page/ensure.mjs` and `scripts/docs.mjs`, which `hooks/hooks.json` runs; `hooks/register.tsx`, which it loads.
- `types/index.d.ts`, named in `.claude-plugin/plugin.json`; `skills/<name>/SKILL.md`.

## Where new code goes

- **A rule of a doc's format**: `lib/`, in the file of its area; a new area, a new file named for it. An area that needs more than one file becomes a folder with an `index.mjs` (`lib/backlog/index.mjs`, `lib/backlog/notes.mjs`), never files with its name as a prefix.
- **Reading or writing the project's files, running git or gh**: `scripts/project.mjs`, or the command's own file when only it needs it.
- **A command**: `scripts/<command>.mjs`, which reads its arguments, calls `lib/` and `project.mjs`, and prints; the guide lists it under Commands. Nothing imports a command.
- **What the page draws**: `page/app/`, the script of its tab, its words in `page/words.js`. **What the panel draws**: `hooks/`, the file of its section.
- **What a command or the panel says**: `lib/messages.mjs`, in English and Italian.
- **What Claude does**: its skill, in `skills/`.
- **A test**: `test/<area>.test.mjs`; the panel's, `hooks/register.test.tsx`.

## Not yet

Where the code does not follow this yet; new code does not copy it.

- **Commands imported as modules**: besides `project.mjs` (a thousand lines, imported by 23 files), `code`, `sync`, `extensions`, `issues`, `check`, `specs`, `people`, `github`, `init`, `adopt`, `task-dates` and `backlog` lend functions to other commands or to the page.
- **No entry files**: `lib/` and `scripts/` are imported file by file.
- **Long files**: `scripts/project.mjs`, `scripts/backlog.mjs`, `scripts/check.mjs`, `scripts/init.mjs`, `page/app/tasks.js`.
