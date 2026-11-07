# Guide

How Project keeps a project's plan, tasks and decisions. You rarely need any of this: Claude runs the commands for you.

## Commands

Each is a script in `plugins/project/scripts/`, run by Claude with `node`.

| Command | What it does |
|---|---|
| `backlog.mjs` | adds, starts, finishes, postpones, archives, links, lists and shows tasks |
| `plan.mjs` | the plan's phases and goals; closes a goal when its tasks are done |
| `decisions.mjs` | the next free decision number, shows and finds decisions |
| `specs.mjs` | the specifications, `S-12`, and which tasks cover them |
| `release.mjs` | what is done since the last version, and the release notes |
| `check.mjs` | the docs' health: numbers twice, broken links, lines that don't read; `--fix` mends what is mechanical |
| `issues.mjs` | the GitHub issues in sync with the backlog, where turned on |
| `github.mjs` | git, gh, the repo, GitHub Pages and releases, step by step |
| `init.mjs` | sets a project up, or moves one that already has a plan onto the plugin |

**Outside Claude Code**: `npm link` in `plugins/project` puts a `project` command on your path: `project backlog list`, `project check --fix`, `project page`.

## Files

```
<docs>/
    README.md        the docs' index
    PLAN.md          phases and goals
    TASKS.md         the backlog
    DECISIONS.md     the decisions, and the points still to decide
    SPECS.md         the specifications (optional)
    tasks/T-12.md    a task's note and its comments
    releases/        one note a version
    archive/         the archived tasks
.claude/project.yaml the configuration
```

Every doc starts with a frontmatter (`title`, `description`, `type`, `created`, `updated`): the commands write it and keep it true.

## Tasks

One task a line, under the heading of its state:

```
- T-12 · P2 · medium · Ann · 2026-10-29 · Core · the login page (after: T-9) (type: feature) (by: Ann)
```

- **The fields**: number, priority (P1–P3), effort, who holds it, the day it was added, its goal, its text.
- **The links**: `(after: T-9)` waits for a task, `(see: T-3, D-2)` points to tasks and decisions, `(in: T-23)` is a part of a large task.
- **The marks**: `(type: bug)`, `(due: 2026-11-15)`, `(issue: #34)`, `(by: Ann)` who created it.
- **Kept as you go**: `start` and `done` tell Claude about doubles, waits and tasks freed; a commit that does a task reminds Claude to close it.

## Configuration

`.claude/project.yaml`. Only `language` and `docs` matter at first; the rest is optional.

```yaml
name: My app                   # the project's name; else the docs' README title
language: en                   # en or it; another starts from en, with its words below
docs: project                  # the docs' folder
people: [Claude, Ann]          # who holds tasks, besides Crew's colleagues
cites: [project, src]          # where a decision number may be cited
repos: [{ name: app, path: . }]            # the repos whose commits cite tasks
page: { port: 5790 }           # the page's port; else one of 5800–5999 from the folder
types: { design: Design }      # task types beyond bug, feature, chore, research, test
fields: { system: { name: System, values: [5e, ironsworn] } }   # the tasks' own fields, (system: 5e)
documents: [{ name: GDD, path: project/GDD.md }]   # key documents, shown in the panel and the page
github: { issues: sync, unassigned: auto, logins: { Ann: ann-gh } }   # GitHub issues in sync
release: { run: [npm test], remember: [Update the store page] }      # checks before a release; false: no versions
contracts: [{ name: Save format, file: package.json, pointer: /saveFormat }]   # numbers others read
extensions: [tools/extension.mjs]          # modules adding tabs, checks and formats
words: { states: { postponed: Later } }    # any heading or mark, renamed
prefixes: { task: T, decision: D, spec: S }   # the numbers' letters
files: { plan: ROADMAP.md }    # a core file's own name
agents: .claude/agents         # Crew's colleagues
memory: .claude/agent-memory   # their memory and todos
markdown: [project, docs]      # the folders the check reads; else the docs' folder
skip: [node_modules, dist]     # folders never read
limits: { staleDays: 3, proposalDays: 14 }   # when the check warns
```

## Public code, private docs

A public project can keep its plan in a private repo of its own, inside the project's folder and ignored by it. This repo does so with `project/`.

1. **Make it**: `/project:init` offers it, or ask Claude to make the docs private. The docs' folder becomes a git repo and goes into `.gitignore`.
2. **Configure it**:
   ```yaml
   docs: project                                        # the private folder
   cites: [project, .claude]                            # where decisions are cited
   repos: [{ name: app, path: . }, { name: docs, path: project }]   # both repos' commits cite tasks
   ```
3. **Push it**: give the private folder its own remote, a private repo on GitHub.

Docs a repo already keeps move there with their history (`init.mjs private`). A folder elsewhere, or a submodule, is just its path in `docs:`.

## The panel and the page

- **The panel** beside the chat: the next task, the tasks in progress and to do, the goals, the points to decide. `/project-panel` shows or hides it.
- **The page** in the browser, on localhost: charts, the task list with its filters, the board, the decisions, the docs' health, the versions. Its address shows when a chat starts.

## With Crew

With [Crew](https://github.com/stefanocaronia/claude-crew), the colleagues hold tasks by first name. Their `todo.md` is their own notebook; a line that is work for the project becomes a task when you tidy the backlog.
