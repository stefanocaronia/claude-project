# Project

A project's plan, tasks and decisions for Claude Code, in markdown files the project keeps, changed by deterministic commands instead of by hand: numbers never collide, lines never break, and Claude reads the state of the work instead of guessing it.

```
> start T-61
T-61: In progress
> what did we decide about the hidden dice?
D-73: hidden rolls carry a fingerprint the player can check afterwards…
```

One plugin, `project`:

- **The plan**: phases (`| 2. Name | at the end you can… |`) and goals (`### Name (phase 2)`), in `PLAN.md`.
- **The backlog**: one task a line, `- T-12 · P2 · medium · Ann · 2026-10-29 · <goal> · text`, under the heading of its state (in progress, to do, postponed, done), with an archive. `backlog.mjs` adds, starts, finishes, postpones, archives, changes and lists them.
- **The decisions**: a numbered table and the points still to decide, in `DECISIONS.md`. `decisions.mjs` gives the next free number (past every number cited anywhere, so two sessions never take the same), shows, finds and says where one is cited.
- **The docs' health**: `check.mjs` reports numbers twice or missing, decisions cited that do not exist, task lines that do not read, old proposals, broken links, docs outside their index, heavy files; `--fix` mends whitespace. The `tidy` skill fixes what is mechanical and proposes the rest.
- **The panel** beside the chat: tiles with the counts; buttons for the next task (by priority, then the oldest), the next decision and the docs' tidying; the project's links; the tasks in progress, each with ▶ to go on with it (in the chat that holds it, or here), and the tasks to do by priority, each with ▶ to start it, Done and Postpone, the priority turned with a press; the plan's goals with their bars; the decisions to take, one brought to the chat as a choice, and the latest. `/project-panel` shows or hides it.
- **The page** with the charts, served at `http://localhost:5790` from the start of a session: overview, rhythm, decisions, tasks, health with the cleanup, docs. A project adds parts of its own as extensions.

The files speak the project's language: English and Italian come built in, any word can be overridden.

## Crew

[Crew](https://github.com/stefanocaronia/claude-crew) is optional. Without it, tasks belong to the people the configuration names. With it, its colleagues hold tasks too, by first name; a colleague's `todo.md` cites a task by number, and the check says when it cites one that is missing or closed; the panel's ▶ hands a colleague's task to Crew's `/crew:next`, and a colleague given a task whose number is in the brief moves it to in progress by itself.

## Requirements

- **Node.js 20 or later** (`node -v`): the commands, the panel's data and the page run on it.
- **Claude Code 2.1.287 or later** for the panel, in the terminal and in the desktop app's Code tab.
- Install from a terminal `claude` session; the commands run `node` through Bash: allow it once when Claude asks.

## Install

```
/plugin marketplace add stefanocaronia/claude-project
/plugin install project@claude-project
```

Then open a new chat and type `/project:init`, or ask "set up the plan and tasks for this project".

**A project that already keeps a plan, tasks or decisions**, with tools of its own, migrates through the same command. `init.mjs adopt` finds the docs, their language, a private repo of their own, the colleagues and where decisions are cited, and prints the configuration that reads them and what reads and what does not, writing nothing. `adopt --write` writes it, and `adopt --steps` moves the plan's checkbox steps into the backlog. Claude proposes the rest point by point: the old tools the plugin replaces, the hooks that started them, the instructions that cite them.

## Configuration

`.claude/project.yaml`, written by `/project:init`:

```yaml
name: My app                 # the title of the README when left out
language: en                 # en, it; another one starts from en with its words below
docs: project                # the docs' folder, from the project's root
people: [Claude, Ann]        # who holds tasks besides Crew's colleagues
cites: [project, .claude, src, docs]   # where a decision number may be cited
page: { port: 5790 }         # one port per project
extensions: []               # modules that add the project's own parts to the page
words: {}                    # any heading or marker, overridden: { states: { postponed: Later } }
```

**Private docs.** A public project can keep its plan in a git repo of its own, nested and ignored: `/project:init` offers it (`--private private` puts the docs in `private/project/`, makes `private/` a repo and adds it to `.gitignore`). A submodule or a folder outside the repo is just a path in `docs:`.

**Extensions** are modules of the project: `export const id`, `collect(context)` for their data, `route(request, context)` for their own paths under `/extension/<id>/`, and `script`, a file for the page that calls `projectPage.register({ tabs, tiles, rhythm, mounted })`.

## Files

```
plugins/project/
    lib/            the formats, pure: the backlog's lines, the plan, the decisions, the todos, the words, the configuration
    scripts/        the commands: backlog, decisions, check, task-dates, init, snapshot (the panel's data)
    page/           the page's server, its data, the cleanup, the page
    hooks/          the panel (a Claude Code mod) and the hook that serves the page
    skills/         project, init, tidy
```

## Development

```
node --test "plugins/project/test/*.test.mjs"
claude plugin test plugins/project
claude plugin validate .
```

Installed from a local folder (`/plugin marketplace add <folder>`), the plugin is read from that folder: after a change, `/reload-plugins`.

## License

MIT. The YAML parser in `lib/vendor/yaml` is [yaml](https://github.com/eemeli/yaml) by Eemeli Aro, ISC. Project is an independent project, not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.
