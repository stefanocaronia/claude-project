// The GitHub issues in sync with the backlog, where the project turns it on (`github: { issues: sync }` in .claude/project.yaml, which
// stands for the user's yes to act on GitHub; D-13). The open issues the user of gh wrote and is assigned come in as tasks, with those
// assigned to nobody where they are the repo's only collaborator (`unassigned: take | leave` fixes it); another's issue waits for the
// user's → Backlog in the panel or the page, and a title another changes on GitHub waits for the user's yes there (D-16). A task closed
// closes its issue, done with a comment naming its commits, archived as not planned; an issue closed closes its task; an opening again
// goes across too. A new task never becomes an issue. The page syncs every few minutes, the start of a session once, the backlog's
// changes after them; the last state in sync is kept in the repo's git folder, so that a change never bounces back.
//   node issues.mjs sync [--dry] [--quiet]   (--dry says what it would do, and does nothing)
//   node issues.mjs status [--json]          (the last sync: when, what it did, what failed)
//   node issues.mjs keep-title 34            (the user's no to the title another gave issue #34: the task's goes back on GitHub)
import { localTime, readState, syncIssues } from "../services/backlog/index.mjs";
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";
import { fail } from "../services/errors.mjs";
import { pullDocs, pushDocs } from "../services/sync.mjs";

if (isMain(import.meta.url)) {
    runCli(() => {
        const [command, ...rest] = process.argv.slice(2);
        const { config, say } = loadProject();

        // Where the docs are kept in sync with the others' (D-18), theirs come first: a task they closed or took from an issue is not
        // done twice; what the sync changed goes to them after.
        if (command === "sync") {
            const dry = rest.includes("--dry");
            const isSynced = !dry && config.github?.issues === "sync";
            const pulled = isSynced ? pullDocs(config, say) : [];
            const { lines } = syncIssues(config, say, { dry });
            const pushed = isSynced ? pushDocs(config, say, "issues: sync") : [];
            rest.includes("--quiet") || console.log([...pulled, ...lines, ...pushed].join("\n"));
        } else if (command === "status") {
            const state = readState(config);
            console.log(rest.includes("--json") ? JSON.stringify(state.last ?? null) : state.last ? [say("issuesLast", { at: localTime(state.last.at) }), ...state.last.lines].join("\n") : say("issuesNever"));
        } else if (command === "keep-title" && /^#?\d+$/.test(rest[0] ?? "")) {
            const pulled = pullDocs(config, say);
            const { lines, kept } = syncIssues(config, say, { keepTitle: rest[0].replace(/^#/, "") });

            if (!kept) {
                fail([...pulled, ...lines].join("\n"));
            }

            console.log([...pulled, ...lines, ...pushDocs(config, say, `issues: keep-title ${rest[0]}`)].join("\n"));
        } else {
            fail(say("issuesUsage"));
        }
    });
}
