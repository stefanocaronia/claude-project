// Gives every checkbox task without a creation date the day its line first appeared in git: node task-dates.mjs [--write]
// The lines are the plan's and the colleagues' todos, as Crew writes them.
import { dateTasks } from "../services/backlog/index.mjs";
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";

if (isMain(import.meta.url)) {
    runCli(() => {
        const { config, say } = loadProject();
        const isWritten = process.argv.includes("--write");
        const dated = dateTasks(config, isWritten);
        const total = dated.reduce((sum, entry) => sum + entry.count, 0);
        dated.forEach((entry) => console.log(`${entry.file}: ${entry.count}`));
        console.log(say(isWritten ? "dated" : "wouldDate", { count: total }));
    });
}
