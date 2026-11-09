// The private docs kept in sync among the people of a project (D-18), where the configuration says `sync: auto`: services/sync.mjs.
//   node sync.mjs pull             (the others' changes, ours on top)
//   node sync.mjs push [message]   (everything changed in the docs' repo, committed and pushed)
//   node sync.mjs status           (whether the docs are in sync here, and how they stand)
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";
import { pullDocs, pushDocs, syncStatus } from "../services/sync.mjs";

if (isMain(import.meta.url)) {
    runCli(() => {
        const [command, ...rest] = process.argv.slice(2);
        const { config, say } = loadProject();
        const lines = command === "pull" ? pullDocs(config, say) : command === "push" ? pushDocs(config, say, rest.join(" ") || undefined) : command === "status" ? syncStatus(config, say) : null;

        if (lines === null) {
            throw new Error(say("syncUsage"));
        }

        lines.forEach((line) => console.log(line));
    });
}
