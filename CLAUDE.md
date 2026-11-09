# Project

The plugin's code is in `plugins/project`; how to try, test and release it is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Code

The code follows Stefano's coding guidelines, in `F:\sviluppo\shared\coding`: `principles.md` in every language, `languages/typescript.md` for the panel and, where it fits, the JavaScript. [docs/structure.md](docs/structure.md) says what each folder holds, what it may import, where new code goes and where the code does not follow them yet; it changes with any folder added, moved or removed. What is this project's own, and wins over them:

- **JavaScript, no build, no dependencies**: the commands, the model and the page are plain `.mjs` for Node 20 and scripts for the browser; only the panel is TypeScript, which Claude Code compiles. The YAML parser is vendored in `lib/vendor/yaml`, as it comes. The tests run with `node --test` and `claude plugin test`; there is no formatter or linter yet.
- **Parts first, areas inside**: the plugin's folders are MVC's parts, `lib/` the model, `scripts/` the commands, `page/` and `hooks/` the two views; inside each, a file or a folder an area, never a prefix.
- **Fixed paths**: `scripts/<command>.mjs`, `page/ensure.mjs`, `hooks/register.tsx` and `types/index.d.ts` are called by path, by Crew (`scripts/backlog.mjs`), the skills, `hooks.json`, `plugin.json` and the `project` command: they never move, while their code may move behind them.

## Crew, the sibling plugin

Project and [Crew](https://github.com/stefanocaronia/claude-crew) are sibling plugins, separate and complementary: Project keeps the work (plan, tasks, decisions), Crew the colleagues who do it. They must always stay compatible, each working alone and both together:

- A change to what one reads or writes of the other (the configuration's keys, the backlog's commands and their options, the folders under the docs, the colleagues' files) is agreed with Crew's side first, and lands in both, released together when it breaks the other.
- The contract between them is written in both guides, in the same words: what each reads and writes of the other, and the folders they share.
- Before a release, check that the released Crew still works with it: its calls of `backlog.mjs`, and the files it reads.
