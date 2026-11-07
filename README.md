# Project

A plugin for [Claude Code](https://claude.com/claude-code) that keeps your project's plan, tasks and decisions in plain markdown files, so Claude always knows where the work stands.

<p align="center">
  <img src="images/panel.png" alt="The panel beside the chat: the next task, the tasks in progress and to do, the plan's goals, the points to decide" height="400">
  <img src="images/page.png" alt="The project's page: tasks done, decisions, commits, versions and the plan's phases" height="400">
</p>
<p align="center"><sub>The panel beside the chat, and the project's page in the browser.</sub></p>

## What you get

- **A plan** with phases and goals.
- **A backlog** of numbered tasks, with priority, owner, type and links between them.
- **Decisions** numbered, so you can ask Claude "what did we decide about X?".
- **A panel** beside the chat with the next task, the tasks in progress and the goals.
- **A page** in the browser with charts, the task list and the docs' health.
- **GitHub** made easy: issues, pull requests and releases, if you want them.

Everything lives in your project's folder as markdown. Claude changes the files only through the plugin's commands, so they never break.

## Install

You need **Claude Code** and **Node.js 20 or later**. If you don't have Node.js, install it from [nodejs.org](https://nodejs.org) and check it with `node -v` in a terminal.

1. Open a terminal in your project's folder and start Claude Code (the desktop app's Code tab does not take `/plugin install`):
   ```
   claude
   ```
2. In the chat, add the plugin's marketplace:
   ```
   /plugin marketplace add stefanocaronia/claude-project
   ```
3. Install the plugin:
   ```
   /plugin install project@claude-project
   ```
4. Close the chat and start a new one, so the plugin loads.
5. Set the project up:
   ```
   /project:init
   ```
   Claude asks a few questions (the language, where to keep the docs) and writes the plan, the backlog and the decisions.

The panel opens beside the chat by itself; `/project-panel` shows or hides it. The page's address is shown when the chat starts.

When Claude asks to run `node`, allow it: the plugin's commands run on it.

## Use it

Just talk to Claude:

- "add a task: the login page"
- "what's next?" or "start T-12"
- "we decided to use SQLite: write it down"
- "tidy the backlog"
- "where does the project stand?"

Claude starts and closes tasks as it works, and tells you when something is done.

**Already have a plan or a task list?** `/project:init` finds it and moves it onto the plugin. A Trello, Jira or Linear export can be imported too: ask Claude.

**Working with [Crew](https://github.com/stefanocaronia/claude-crew)?** Crew gives your project a team of expert colleagues; with both, the colleagues take and do the backlog's tasks. Crew is optional.

## Settings

`/project:init` writes `.claude/project.yaml`. The main keys:

```yaml
language: en            # en or it
docs: project           # the docs' folder
people: [Claude, Ann]   # who holds tasks
github: { issues: sync }   # optional: GitHub issues kept in sync with the backlog
```

Claude knows the rest: ask it to change a setting.

## Development

```
node --test "plugins/project/test/*.test.mjs"
claude plugin test plugins/project
claude plugin validate .
```

`node tools/screenshots.mjs` makes this README's pictures again. Installed from a local folder (`/plugin marketplace add <folder>`), the plugin is read from there: after a change, `/reload-plugins`.

## License

MIT. The YAML parser in `lib/vendor/yaml` is [yaml](https://github.com/eemeli/yaml) by Eemeli Aro, ISC. Project is an independent project, not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.
