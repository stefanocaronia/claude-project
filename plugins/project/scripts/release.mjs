// The project's releases: a version groups the work done since the last one, and its notes stay in <docs>/releases/v<version>.md.
//   node release.mjs status                                   (the last release, what is done since, the version it suggests and why)
//   node release.mjs notes [<version>] [--breaking "a; b"]   (the notes as they would be written, on stdout)
//   node release.mjs write <version> [--summary "…"] [--breaking "a; b"]   (writes them; a version past the last, with work done)
// A version is a release, never a commit: one is due when a goal or a phase of the plan closes, when the work done since makes a whole
// that users notice, or when a fix cannot wait. The project's own version files, the tag and the publishing are the user's call.
import { join } from "node:path";
import { compareVersions, nextVersion, parseVersion, releaseState, renderRelease } from "../lib/release.mjs";
import { isMain, loadProject, ProjectError, readBacklog, readGoals, readReleases, runCli, shown, today, writeDoc } from "./project.mjs";

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

function run(args)
{
    const [command, ...rest] = args;
    const { config, say } = loadProject();
    const { options, words } = optionsOf(rest);
    const prefix = config.prefixes.task;
    const { last, pending, counts, closedGoals, urgent } = releaseState(readReleases(config), readBacklog(config).tasks, readGoals(config), prefix);
    const breaking = typeof options.breaking === "string" ? options.breaking.split(";").map((item) => item.trim()).filter(Boolean) : [];
    const suggested = nextVersion(last?.version, pending, breaking.length > 0);
    const names = { breaking: say("releaseBreaking"), added: say("releaseAdded"), fixed: say("releaseFixed"), maintenance: say("releaseMaintenance"), other: say("releaseOther") };
    const fail = (message) => {
        throw new ProjectError(message);
    };

    if (command === "status") {
        console.log(last ? say("releaseLast", { version: last.version, day: last.day }) : say("releaseNone"));

        if (pending.length === 0) {
            console.log(say("releaseNothing"));
            return;
        }

        console.log(say("releaseSince", { count: pending.length, ...counts }));
        console.log(say(`releaseSuggest_${suggested.kind}`, { version: suggested.version }));
        // What makes a release due: a goal of the plan closed since the last one, or an urgent fix; else the user judges the whole.
        console.log(closedGoals.length > 0 ? say("releaseDueGoals", { list: closedGoals.join(", ") }) : urgent.length > 0 ? say("releaseDueFix", { list: urgent.join(", ") }) : say("releaseJudge"));
        return;
    }

    if (command === "notes" || command === "write") {
        const given = words[0];
        const version = (given ?? (command === "notes" ? suggested.version : "")).replace(/^v/, "");

        if (!parseVersion(version)) {
            fail(say("releaseBadVersion", { value: given ?? "" }));
        }

        if (pending.length === 0) {
            fail(say("releaseNothing"));
        }

        if (last && compareVersions(version, last.version) <= 0) {
            fail(say("releaseNotPast", { version, last: last.version }));
        }

        const text = renderRelease({ version, day: today(), summary: typeof options.summary === "string" ? options.summary : "", breaking, tasks: pending, prefix, names });

        if (command === "notes") {
            console.log(text.trimEnd());
            return;
        }

        const file = join(config.files.releases, `v${version}.md`);
        writeDoc(config, file, text);
        console.log(say("releaseWritten", { file: shown(config, file), count: pending.length, version }));
        return;
    }

    fail(say("releaseUsage"));
}

function optionsOf(args)
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        if (args[index].startsWith("--") && args[index + 1] !== undefined && !args[index + 1].startsWith("--")) {
            options[args[index].slice(2)] = args[index + 1];
            index++;
        } else if (!args[index].startsWith("--")) {
            words.push(args[index]);
        }
    }

    return { options, words };
}
