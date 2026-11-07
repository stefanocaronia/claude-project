# Project

The plugin's code is in `plugins/project`; how to try, test and release it is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Crew, the sibling plugin

Project and [Crew](https://github.com/stefanocaronia/claude-crew) are sibling plugins, separate and complementary: Project keeps the work (plan, tasks, decisions), Crew the colleagues who do it. They must always stay compatible, each working alone and both together:

- A change to what one reads or writes of the other (the configuration's keys, the backlog's commands and their options, the folders under the docs, the colleagues' files) is agreed with Crew's side first, and lands in both, released together when it breaks the other.
- The contract between them is written in both guides, in the same words: what each reads and writes of the other, and the folders they share.
- Before a release, check that the released Crew still works with it: its calls of `backlog.mjs`, and the files it reads.
