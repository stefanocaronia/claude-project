---
name: init
description: Set the project plugin up in the current project - the configuration and the plan, backlog and decisions docs - or migrate a project that already keeps a plan, tasks or decisions, with its own tools, onto the plugin. Use when the user asks to start keeping a plan, tasks or decisions here, or to move a project onto the plugin ("set up the project", "prepara piano e compiti", "migra il progetto", "/project:init").
---

# Setting a project up, or migrating one

The commands run with Bash from the project's folder: `node "<this skill's folder>/../../scripts/init.mjs" …`. Nothing is written before the user's yes.

## 1. Look

Run `init.mjs adopt`. It writes nothing. It finds the folder that holds a plan, a backlog or decisions (up to three levels down), the language of their headings, whether that folder is a git repo of its own, who holds tasks, the colleagues of Crew, and the parts of the project that cite a decision (`D-12`). It prints the configuration that would read them, and what reads and what does not.

- If `.claude/project.yaml` exists, say what it configures. If the project still has its own tools beside it (a configuration written to try the plugin), the migration is half done: go to 3 from the old tools, completing the configuration that is there with Edit. Otherwise stop, unless the user wants a change.
- If nothing is found, it is a **new project**: go to 2.
- If docs are found, it is a **migration**: go to 3.

## 2. A new project

Ask once, in the choice form, with the recommendation first, what the request leaves open:
- the docs' language (`en`, `it`; another one starts from `en` with its words overridden under `words:`);
- where the docs live: in the repo (`project/`, the default), or in a **private repo of their own**, nested and ignored by the project's (`private/`, docs in `private/project/`), for a public project whose plan stays private. A submodule or a folder outside the repo is a path in `docs:` the user sets up;
- who besides Claude holds tasks (`people:`). Crew's colleagues, if the project has them, count by themselves.

Then run `init.mjs --language it [--private private] [--docs <folder>] [--people "Claude,Ann"] [--name "<project>"]`. It writes the configuration and the docs that are missing, and never overwrites one. With `--private` it makes the folder a git repo and adds it to the project's `.gitignore`. Then fill the plan with the user: the phases and the first goals.

## 3. A migration

Read what the survey found, and what else the project has around its docs:
- its own tools for them (scripts that number tasks or decisions, check the docs, serve a page);
- the hooks that start them (`.claude/settings.json`);
- the skills that tidy them;
- the instructions that cite them (AGENTS.md, CLAUDE.md, READMEs).

Then propose the migration as one numbered list, one decision per point, with what you recommend:

1. **The configuration**: the survey's, completed by what you read.
   - `people:` the user and whoever holds tasks.
   - `cites:` the survey's parts, plus sibling repos that cite the same numbers (`../app-*/src`).
   - `files:` names the survey did not guess, and the idea inbox.
   - `words:` headings that differ from the language's.
   - `page.port` when another page holds 5790.
   - `extensions:` for the parts of an old page that belong to this project alone.
2. **What does not read**: lines of the backlog in another format, decisions without the table, a plan whose steps are checkboxes. The plan's checkbox steps under its goals go into the backlog with `init.mjs adopt --steps`: open ones to do, done ones archived, their sub-lines joined to the text. Other formats you convert with Edit, line by line, after the user's yes.
3. **The old tools** the plugin replaces, point by point: what each did, which command of the plugin does it now (see the `project` and `tidy` skills), and that it goes. A tool that does something the plugin does not keeps its place, or becomes an extension.
4. **The texts that cite them**: the instructions, the docs' index, the colleagues' memory. Each line rewritten to the plugin's commands.

On the user's yes, point by point:
- `init.mjs adopt --write`, which writes the configuration and the missing docs, and never overwrites one;
- `--steps` if they chose it;
- the configuration's additions with Edit;
- then the rest.

At the end run `check.mjs` and compare the plugin's outputs with the old tools' ones while they are still there (the backlog's list, the next decision number, the check). Tell the user what changed and what to verify: the panel (`/project-panel`) and the page (`http://localhost:<page.port>`), from a new session. Commit only when they ask; in a private docs repo, with `git -C <its folder>`.

## The configuration

`.claude/project.yaml`:

```yaml
name: My app                 # the title of the README when left out
language: it
docs: private/project        # the docs' folder, from the project's root
people: [Claude, Ann]
cites: [private/project, .claude, src, docs]   # where a decision number may be cited; a * in a part matches any name
markdown: [private/project]  # the folders whose .md the check looks after (default: the docs and their subfolders)
files: { decisions: DECISIONI.md, inbox: IDEE.md }   # names other than the language's
repos: [{ name: app, path: . }, { name: docs, path: private }]   # the commits the page counts
page: { port: 5790 }         # one port per project
extensions: []               # modules that add the project's own parts to the page and links to the panel
words: {}                    # any heading or marker of the language, overridden
```
