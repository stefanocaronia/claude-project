// The project's releases: a version groups the work done since the last one, and its notes stay in <docs>/releases/v<version>.md.
//   node release.mjs status                                   (the last release, what is done since, the version it suggests and why)
//   node release.mjs notes [<version>] [--breaking "a; b"]   (the notes as they would be written, on stdout)
//   node release.mjs write <version> [--summary "…"] [--breaking "a; b"]   (writes them; a version past the last, with work done)
// A version is a release, never a commit: one is due when a goal or a phase of the plan closes, when the work done since makes a whole
// that users notice, when a fix cannot wait, or when a contract went up. The project's own version files, the tag and the publishing are
// the user's call. A project with no release yet shows none, unless its configuration says `release: true`.
import { join } from "node:path";
import { joinFrontmatter } from "../lib/frontmatter.mjs";
import { compareVersions, nextVersion, parseVersion, releaseState, renderRelease } from "../lib/release.mjs";
import { commandLine, fail, isMain, loadProject, readBacklog, readContracts, readGoals, readReleases, runCli, showsReleases, shown, today, writeDoc } from "./project.mjs";

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

function run(args)
{
    const [command, ...rest] = args;
    const { config, say } = loadProject();
    const { options, words } = commandLine(rest);
    const prefix = config.prefixes.task;
    const known = readReleases(config);
    // The notes of the version the plugin's manifest already says, written after it: the work goes back to the release before it.
    const asked = (command === "notes" || command === "write") && typeof words[0] === "string" ? words[0].trim().replace(/^v/, "") : "";
    const releases = known.at(-1)?.source === "plugin" && asked === known.at(-1).version ? known.slice(0, -1) : known;
    const contracts = readContracts(config, releases);
    const { last, pending, counts, closedGoals, urgent, raised } = releaseState(releases, readBacklog(config).tasks, readGoals(config), prefix, contracts);
    const breaking = typeof options.breaking === "string" ? options.breaking.split(";").map((item) => item.trim()).filter(Boolean) : [];
    const suggested = nextVersion(last?.version, pending, breaking.length > 0, raised.length > 0);
    const names = { breaking: say("releaseBreaking"), contracts: say("releaseContracts"), added: say("releaseAdded"), fixed: say("releaseFixed"), maintenance: say("releaseMaintenance"), other: say("releaseOther") };

    if (command === "status") {
        // A project that does not release, a book, is not asked to.
        if (!showsReleases(config, releases)) {
            console.log(say("releaseHidden"));
            return;
        }

        console.log(last ? say("releaseLast", { version: last.version, day: last.day }) : say("releaseNone"));
        contracts.filter((contract) => contract.state !== "same").forEach((contract) => console.log(say(`releaseContract_${contract.state}`, contract)));

        if (pending.length === 0 && raised.length === 0) {
            console.log(say("releaseNothing"));
            return;
        }

        console.log(say("releaseSince", { count: pending.length, ...counts }));
        console.log(say(`releaseSuggest_${suggested.kind}`, { version: suggested.version }));
        // What makes a release due: a goal of the plan closed since the last one, an urgent fix or a contract gone up; else the user
        // judges the whole.
        console.log(closedGoals.length > 0 ? say("releaseDueGoals", { list: closedGoals.join(", ") }) : urgent.length > 0 ? say("releaseDueFix", { list: urgent.join(", ") })
            : raised.length > 0 ? say("releaseDueContract", { list: raised.join(", ") }) : say("releaseJudge"));
        // The checks before a release: the commands Claude runs, what it asks the user.
        config.release.run.length > 0 && console.log(say("releaseRun", { list: config.release.run.join("; ") }));
        config.release.remember.length > 0 && console.log(say("releaseRemember", { list: config.release.remember.join("; ") }));
        return;
    }

    if (command === "notes" || command === "write") {
        const given = words[0];
        const version = (given ?? (command === "notes" ? suggested.version : "")).trim().replace(/^v/, "");

        if (!parseVersion(version)) {
            fail(say("releaseBadVersion", { value: given ?? "" }));
        }

        if (pending.length === 0 && raised.length === 0) {
            fail(say("releaseNothing"));
        }

        const unread = contracts.find((contract) => contract.state === "unread");

        if (unread) {
            fail(say("contractUnread", unread));
        }

        if (last && compareVersions(version, last.version) <= 0) {
            fail(say("releaseNotPast", { version, last: last.version }));
        }

        const text = renderRelease({ version, day: today(), summary: typeof options.summary === "string" ? options.summary : "", breaking, contracts, tasks: pending, prefix, names });

        if (command === "notes") {
            console.log(text.trimEnd());
            return;
        }

        const file = join(config.files.releases, `v${version}.md`);
        // The contracts' numbers at this release, for the next one to compare with.
        writeDoc(config, file, contracts.length > 0 ? joinFrontmatter({ contracts: Object.fromEntries(contracts.map((contract) => [contract.name, /^\d+$/.test(contract.current) ? Number(contract.current) : contract.current])) }, text) : text);
        console.log(say("releaseWritten", { file: shown(config, file), count: pending.length, version }));
        return;
    }

    fail(say("releaseUsage"));
}
