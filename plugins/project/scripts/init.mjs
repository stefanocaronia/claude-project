// Sets a project up: .claude/project.yaml and the docs (plan, backlog and its archive, decisions, their index), in the project's language.
// Never overwrites a file. node init.mjs [--language it] [--docs project] [--people "Claude,Ann"] [--private project] [--name "My app"]
// --private <folder>: the docs live in a git repo of their own, ignored by the project's repo: the docs' folder itself when it is named
// as they are (--private project, the default and simplest), else a folder that holds them in <folder>/project beside other private
// things (--private private).
// node init.mjs private [--in <folder>] [--write]: a project's docs, kept in its repo, made private the same way, their history with
// them: the docs' folder made a repo of its own where it is, or, with --in, moved into that folder made the repo. Without --write, what
// would change.
// node init.mjs rename [--write]: a project made before the core went English gets its core files' English names (DECISIONS.md,
// archive/TASKS-archive.md, tasks/), with git when they are in a repo, and their format's English words (## In progress, · done,
// ## Goals, ## To decide); the links of its docs follow. Without --write, what would change.
// node init.mjs adopt [--language it] [--people "Claude,Ann"] [--name "My app"] [--write] | adopt --steps | adopt --decisions <file>
// "<heading>": a project that already keeps a plan, tasks or decisions, moved onto the plugin (adopt.mjs).
import { configFile, relativeTo } from "../lib/config.mjs";
import { sayer } from "../lib/messages.mjs";
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";
import { fail } from "../services/errors.mjs";
import { shown } from "../services/files.mjs";
import { git } from "../services/git.mjs";
import { init, knownLanguage, moveDecisions, moveSteps, privatePlan, privateWrite, renameCore, survey, writeSettings } from "../services/setup/index.mjs";

const examples = { language: "--language it", docs: "--docs project", people: '--people "Claude,Ann"', private: "--private project", name: '--name "My app"', in: "--in private" };

if (isMain(import.meta.url)) {
    runCli(() => {
        const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const args = process.argv.slice(2);

        if (args[0] === "adopt") {
            adoptCommand(root, args.slice(1));
            return;
        }

        if (args[0] === "rename") {
            renameCommand(root, args.includes("--write"));
            return;
        }

        if (args[0] === "private") {
            privateCommand(root, optionsOf(args.slice(1), ["--write"]).in, args.includes("--write"));
            return;
        }

        const options = optionsOf(args);
        printWritten(init(root, options), sayer(options.language ?? "en"));
    });
}

/** The options of a command line, each with the word after it, the people as a list; the flags named apart (adopt's --write) are none. */
function optionsOf(args, flags = [])
{
    const options = {};
    const rest = args.filter((arg) => !flags.includes(arg));

    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index].replace(/^--/, "");
        const value = rest[index + 1];

        if (value === undefined || value.startsWith("--")) {
            fail(sayer(options.language ?? "en")("noValue", { name: key, example: examples[key] ?? `--${key} <value>` }));
        }

        options[key] = key === "people" ? value.split(",").map((one) => one.trim()).filter(Boolean) : value;
    }

    return options;
}

/** rename: the core files and folders a project still keeps under their old Italian names, moved to the English ones (the archive's whole
 * folder with it), with `git mv` where git tracks them; then the old names in the docs' markdown follow, and the files outside the docs
 * that still name them are listed, for Claude to fix with the user. */
function renameCommand(root, isWritten)
{
    const { say } = loadProject(root);
    const { steps, formats, changed, others } = renameCore(root, isWritten);

    if (steps.length === 0 && formats.length === 0) {
        console.log(say("renameNone"));
        return;
    }

    for (const step of steps) {
        console.log(say("renameStep", step));
    }

    for (const file of formats) {
        console.log(say("renameFormat", { file }));
    }

    if (!isWritten) {
        console.log(say("renameDry"));
        return;
    }

    console.log(say("renameDone", { count: steps.length, files: changed.length > 0 ? changed.join(", ") : "—" }));

    if (others.length > 0) {
        console.log(say("renameOthers", { list: others.join(", ") }));
    }
}

/** adopt: what the project has and the configuration that reads it, with the language, the people and the name given (--language,
 * --people, --name) over what it finds; --write writes it and the missing docs; --steps moves the plan's checkbox steps into the
 * backlog. The details are for Claude, who tells the user; the frame speaks the docs' language. */
function adoptCommand(root, args)
{
    const { found, settings: seen, report } = survey(root);
    const given = args[0] === "--decisions" || args.includes("--steps") ? {} : optionsOf(args, ["--write"]);
    const unknown = Object.keys(given).find((key) => !["language", "people", "name"].includes(key));

    if (unknown) {
        fail(sayer(seen.language)("adoptOption", { name: unknown }));
    }

    const settings = { ...seen, ...given, language: knownLanguage(given.language ?? seen.language, sayer(seen.language)) };
    const say = sayer(settings.language);

    if (args[0] === "--decisions") {
        if (!args[1] || !args[2]) {
            fail(say("noValue", { name: "decisions", example: 'adopt --decisions design/flow.md "Decisions taken"' }));
        }

        console.log(say("decisionsMovedCount", moveDecisions(root, args[1], args[2])));
        return;
    }

    if (args.includes("--steps")) {
        const moved = moveSteps(root);
        moved.forEach((line) => console.log(`→ ${line}`));
        console.log(say("stepsMoved", { count: moved.length }));
        return;
    }

    console.log(found.docs ? say("adoptFound", { folder: found.docs, own: found.ownRepo ? say("adoptOwnRepo") : "", files: found.names.filter((name) => name.endsWith(".md")).join(", ") }) : say("adoptNone"));
    console.log(`\n${say("adoptConfig", { file: configFile })}\n${Object.entries(settings).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join("\n")}`);
    console.log(`\n${say("adoptReads")}\n${report.map((line) => `  ${line}`).join("\n")}`);

    if (!args.includes("--write")) {
        console.log(`\n${say("adoptNothing")}`);
        return;
    }

    if (!writeSettings(root, settings)) {
        fail(say("adoptExists", { file: configFile }));
    }

    printWritten(init(root, { language: settings.language, docs: settings.docs, name: settings.name, people: settings.people }), say);
}

/** The files init wrote, each with a +, and those it found already there. */
function printWritten({ written, kept }, say)
{
    written.forEach((file) => console.log(say("written", { file })));
    kept.forEach((file) => console.log(say("kept", { file })));
}

/** private: a project's docs, kept in its repo, made private as --private makes a new project's: the docs' folder made a git repo of its
 * own where it is, or, with --in <folder>, moved into that folder made the repo (the docs then in <folder>/<their folder's name>, and the
 * configuration's paths follow). Their history in the project's repo comes with them, commit by commit, with its authors, days and
 * messages; the project's repo keeps its own history as it is, leaves the docs out of its index and ignores the new repo's folder.
 * Nothing is committed. Without --write, what would change. */
function privateCommand(root, container, isWritten)
{
    const { config, say } = loadProject(root);
    const plan = privatePlan(config, container, say);
    const where = (path) => shown(config, path);

    if (plan.already) {
        console.log(say("privateAlready", { folder: plan.already }));
        return;
    }

    const isMoved = plan.docs !== config.docs;
    const steps = [
        say("privateRepo", { folder: where(plan.folder), count: plan.history.length }),
        ...(isMoved ? [say("privateMove", { from: where(config.docs), to: where(plan.docs) })] : []),
        ...(plan.top ? [say("privateIgnore", { line: `/${relativeTo(config.root, plan.folder)}/` })] : []),
        ...(plan.tracked ? [say("privateIndex", { folder: where(config.docs) })] : []),
        ...(isMoved ? [say("privateConfig", { file: configFile, from: where(config.docs), to: where(plan.docs) })] : []),
        ...(plan.listsRepos ? [say("privateRepos", { file: configFile, name: config.words.repoDocs })] : []),
    ];
    steps.forEach((step) => console.log(`- ${step}`));

    if (!isWritten) {
        console.log(say("privateDry"));
        return;
    }

    const others = privateWrite(config, plan, say);
    console.log(say("privateDone", { count: git(plan.folder, ["rev-list", "--count", "HEAD"]).trim() || "0" }));

    if (others.length > 0) {
        console.log(say("privateOthers", { list: others.join(", ") }));
    }
}
