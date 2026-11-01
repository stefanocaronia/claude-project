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
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { sayer } from "../lib/messages.mjs";
import { quoted } from "../lib/text.mjs";
import { parseDocument, visit } from "../lib/vendor/yaml/index.js";
import { coreFiles, legacyFiles, presets } from "../lib/words.mjs";
import { markdownFiles } from "./check.mjs";
import { moveDecisions, moveSteps, survey, writeSettings } from "./adopt.mjs";
import { englishFormat, fail, git, isMain, legacyFormat, loadProject, moveFile, read, readmeTitle, runCli, shown, today, write, writeDoc } from "./project.mjs";

const examples = { language: "--language it", docs: "--docs project", people: '--people "Claude,Ann"', private: "--private project", name: '--name "My app"', in: "--in private" };
// Where private --write keeps the docs' rebuilt history in the project's repo while the docs' repo fetches it.
const historyRef = "refs/project-plugin/docs-history";

const templates = {
    en: {
        plan: (name, updated, words) => `# ${name} — Plan\n\n> ${updated}. What the project is doing now, in short.\n\n| Phase | At the end you can… |\n|---|---|\n| 1. First phase | what one can do at its end |\n\nThe plan holds the phases and the goals; the tasks are in the [backlog](TASKS.md).\n\n## ${words.goals}\n\n### First goal (${words.phase} 1)\n\nWhat it is for.\n`,
        tasks: (name) => `# ${name} — Backlog\n\nThe project's tasks, one a line, changed with the project plugin's backlog command, by hand only a task's text. The archived ones are in the [archive](archive/TASKS-archive.md).\n\n`,
        archive: (name) => `# ${name} — Archived tasks\n`,
        decisions: (name, words) => `# ${name} — Decisions\n\n> What is decided and why, in short. A proposal stays under "${words.open}" until it is decided.\n\n| # | ${words.decision} | ${words.why} |\n|---|---|---|\n\n## ${words.open}\n`,
        index: (name) => `# ${name} — Project docs\n\n- [Plan](PLAN.md): the phases and the goals.\n- [Backlog](TASKS.md): the tasks.\n- [Decisions](DECISIONS.md): what is decided and why.\n`,
    },
    it: {
        plan: (name, updated, words) => `# ${name} — Piano\n\n> ${updated}. Cosa fa il progetto ora, in breve.\n\n| Fase | Alla fine puoi… |\n|---|---|\n| 1. Prima fase | cosa si può fare alla sua fine |\n\nIl piano tiene le fasi e i traguardi; i compiti sono nel [backlog](TASKS.md).\n\n## ${words.goals}\n\n### Primo traguardo (${words.phase} 1)\n\nA cosa serve.\n`,
        tasks: (name) => `# ${name} — Backlog\n\nI compiti del progetto, uno per riga, cambiati col comando backlog del plugin project, a mano solo il testo. Quelli archiviati sono nell'[archivio](archive/TASKS-archive.md).\n\n`,
        archive: (name) => `# ${name} — Compiti archiviati\n`,
        decisions: (name, words) => `# ${name} — Decisioni\n\n> Cosa è deciso e perché, in breve. Una proposta resta sotto "${words.open}" finché non si decide.\n\n| # | ${words.decision} | ${words.why} |\n|---|---|---|\n\n## ${words.open}\n`,
        index: (name) => `# ${name} — Documenti di progetto\n\n- [Piano](PLAN.md): le fasi e i traguardi.\n- [Backlog](TASKS.md): i compiti.\n- [Decisioni](DECISIONS.md): cosa è deciso e perché.\n`,
    },
};

/** Writes what a project lacks of the configuration and the docs; returns the files written and those already there, as shown paths. */
export function init(root, options = {})
{
    const language = knownLanguage(options.language ?? "en");
    const name = options.name ?? readmeTitle(root) ?? basename(root);
    // The private repo is the docs' folder itself when it is named as they are (project by default), else a folder holding them.
    const docs = options.docs ?? (options.private && options.private !== "project" ? `${options.private}/project` : "project");
    const people = options.people ?? ["Claude"];
    const written = [];
    const kept = [];
    // The configuration, once written: the docs written after it carry their frontmatter.
    let config = null;
    const place = (path, text) => {
        const shown = relativeTo(root, path);

        if (existsSync(path)) {
            kept.push(shown);
        } else {
            config ? writeDoc(config, path, text) : write(path, text);
            written.push(shown);
        }
    };

    const yaml = [`name: ${quoted(name)}`, `language: ${language}`, `docs: ${quoted(docs)}`, `people: [${people.map(quoted).join(", ")}]`, `cites: [${quoted(docs)}, .claude]`, ""].join("\n");
    place(join(root, configFile).replaceAll("\\", "/"), yaml);

    if (options.private) {
        makePrivateRepo(root, options.private, written);
    }

    config = readConfig(read(join(root, configFile)), root);
    const text = templates[language];
    // The format's words are the core's, English in every language; the rest of the text is in the project's.
    place(config.files.plan, text.plan(name, `${config.words.updated} ${today()}`, config.words));
    place(config.files.tasks, text.tasks(name) + Object.values(config.words.states).map((state) => `## ${state}`).join("\n\n") + "\n");
    place(config.files.archive, text.archive(name));
    place(config.files.decisions, text.decisions(name, config.words));
    place(config.files.index, text.index(name));
    return { written, kept };
}

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

/** A language the plugin has words for, as given; any other is refused, in the language of `say`, before a file is written. */
function knownLanguage(language, say = sayer("en"))
{
    if (!presets[language]) {
        fail(say("badLanguage", { list: Object.keys(presets).join(", "), value: language, file: configFile }));
    }

    return language;
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

/** The core's English names and format: the moves and the files in the old format, as shown paths; written, the files changed and those
 * outside the docs still naming the old names. The page's mechanical cleanup runs it too. */
export function renameCore(root, isWritten)
{
    const { config } = loadProject(root);
    const moves = config.legacy ?? [];
    const formats = legacyFormat(config);
    // The archive moves as a folder, with what else it keeps; its backlog file then takes its new name inside it.
    const steps = moves.flatMap(({ key, from, to }) => (key === "archive"
        ? [{ from: join(config.docs, legacyFiles.archiveFolder), to: join(config.docs, coreFiles.archiveFolder) }, { from: join(config.docs, coreFiles.archiveFolder, basename(from)), to }]
        : [{ from, to }]));
    const planned = { steps: steps.map((step) => ({ from: shown(config, step.from), to: shown(config, step.to) })), formats: formats.map((file) => shown(config, file)), changed: [], others: [] };

    if (!isWritten || (steps.length === 0 && formats.length === 0)) {
        return planned;
    }

    // The old names as the docs write them, and the new ones.
    const names = [["archivio/TASKS-archivio.md", "archive/TASKS-archive.md"], ["TASKS-archivio.md", "TASKS-archive.md"], ["DECISIONI.md", "DECISIONS.md"], ["](archivio/", "](archive/"], ["](compiti/", "](tasks/"], ["compiti/T-", "tasks/T-"]];

    // One after the other, each looked at once the one before has moved: the archive's file is in its new folder only once the folder is.
    for (const step of steps) {
        if (existsSync(step.from) && !existsSync(step.to)) {
            moveFile(step.from, step.to);
        }
    }

    // A folder the move left empty goes.
    for (const old of [join(config.docs, legacyFiles.archiveFolder), join(config.docs, legacyFiles.notes)].filter((one) => existsSync(one) && statSync(one).isDirectory() && readdirSync(one).length === 0)) {
        rmdirSync(old);
    }

    const fresh = loadProject(root).config;
    // The format's old words in English, the backlog with its archive written again; then the links.
    const changed = legacyFormat(fresh).length > 0 ? englishFormat(fresh).map((file) => shown(fresh, file)) : [];

    for (const file of markdownFiles(fresh)) {
        const text = read(file);
        const next = names.reduce((result, [from, to]) => result.replaceAll(from, to), text);

        if (next !== text) {
            writeDoc(fresh, file, next);

            if (!changed.includes(shown(fresh, file))) {
                changed.push(shown(fresh, file));
            }
        }
    }

    const others = [...new Set(git(root, ["grep", "-l", "-I", "-e", "DECISIONI.md", "-e", "TASKS-archivio.md", "-e", "archivio/", "--", "."]).split("\n").filter(Boolean))]
        .filter((file) => !changed.includes(file.replaceAll("\\", "/")));
    return { ...planned, changed, others };
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

/** The folder as a git repo of its own, and the project's .gitignore ignoring it, when the project is a repo. */
function makePrivateRepo(root, folder, written)
{
    const path = join(root, folder);

    if (!existsSync(join(path, ".git"))) {
        initRepo(path);
        written.push(`${folder}/ (git init)`);
    }

    if (existsSync(join(root, ".git")) && ignoreFolder(root, folder)) {
        written.push(".gitignore");
    }
}

/** A folder made a git repo of its own, on main, with its .gitignore when it has none. */
function initRepo(path)
{
    if (!existsSync(join(path, ".gitignore"))) {
        write(join(path, ".gitignore"), "tmp/\n");
    }

    execFileSync("git", ["init", "-q", path], { windowsHide: true });
    gitIn(path, ["symbolic-ref", "HEAD", "refs/heads/main"]);
}

/** The project's .gitignore leaving a folder out, its line added once; true when it was added. */
function ignoreFolder(root, folder)
{
    const ignore = join(root, ".gitignore");
    const text = read(ignore);
    const line = `/${folder.replaceAll("\\", "/").replace(/^\/|\/$/g, "")}/`;

    if (text.split(/\r?\n/).includes(line)) {
        return false;
    }

    write(ignore, `${text}${text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n"}# The project's private docs, a git repo of their own\n${line}\n`);
    return true;
}

/** A git command in a folder that must work: its output; it throws, with git's words, when it fails. `input` goes to its stdin, `env`
 * over the process's. */
function gitIn(folder, args, { input, env } = {})
{
    return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", input, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 512 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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

/** What private would do: the project's repo (none when it is not in one), the new repo's folder, where the docs land in it and under
 * which of its paths, the docs' commits in the project's repo, whether it tracks them; or the repo they are already in. */
function privatePlan(config, container, say)
{
    if (!existsSync(config.docs)) {
        fail(say("privateNoDocs", { folder: shown(config, config.docs) }));
    }

    const top = git(config.root, ["rev-parse", "--show-toplevel"]).trim();
    const docsTop = git(config.docs, ["rev-parse", "--show-toplevel"]).trim();

    if (docsTop && docsTop.toLowerCase() !== top.toLowerCase()) {
        return { already: shown(config, docsTop) };
    }

    const prefix = top ? relativeTo(top, config.docs) : "";

    if (top && prefix.toLowerCase() === config.docs.toLowerCase()) {
        return { already: shown(config, top) };
    }

    // --in naming the docs' own folder is the docs' folder made the repo.
    const given = container ? resolve(config.root, container).replaceAll("\\", "/") : config.docs;
    const folder = given.toLowerCase() === config.docs.toLowerCase() ? config.docs : given;
    const isMoved = folder !== config.docs;
    const docs = isMoved ? `${folder}/${basename(config.docs)}` : config.docs;

    if (isMoved && existsSync(join(folder, ".git"))) {
        fail(say("privateRepoThere", { folder: shown(config, folder) }));
    }

    if (isMoved && (existsSync(docs) || relativeTo(config.docs, folder) !== folder)) {
        fail(say("privateDocsThere", { folder: shown(config, docs) }));
    }

    const history = top ? git(top, ["rev-list", "HEAD", "--", prefix]).split("\n").filter(Boolean) : [];
    const tracked = top ? git(top, ["ls-files", "--", prefix]).trim() !== "" : false;
    const repos = parseDocument(read(join(config.root, configFile))).get("repos");
    return { top, folder, docs, inner: isMoved ? basename(config.docs) : "", prefix, history, tracked, listsRepos: Boolean(repos?.items) };
}

/** private --write: the docs' history rebuilt, the docs moved when they go into another folder, their repo made with that history, the
 * project's repo leaving them, the configuration following; the files outside the docs that still name their old folder. */
function privateWrite(config, plan, say)
{
    const head = docsHistory(plan);

    if (head) {
        gitIn(plan.top, ["update-ref", historyRef, head]);
    }

    try {
        if (plan.docs !== config.docs) {
            mkdirSync(plan.folder, { recursive: true });

            try {
                renameSync(config.docs, plan.docs);
            } catch (error) {
                if (readdirSync(plan.folder).length === 0) {
                    rmdirSync(plan.folder);
                }

                fail(say("privateBusy", { folder: shown(config, config.docs), error: error.code ?? error.message }));
            }
        }

        initRepo(plan.folder);

        // The history as the repo's main, the index as its last commit, the files as they are: what the project had not committed yet
        // shows as the docs' repo's own changes.
        if (head) {
            gitIn(plan.folder, ["fetch", "-q", plan.top, historyRef]);
            gitIn(plan.folder, ["update-ref", "refs/heads/main", "FETCH_HEAD"]);
            gitIn(plan.folder, ["reset", "-q"]);
        }
    } finally {
        if (head) {
            git(plan.top, ["update-ref", "-d", historyRef]);
        }
    }

    if (plan.top) {
        ignoreFolder(config.root, relativeTo(config.root, plan.folder));
    }

    if (plan.tracked) {
        gitIn(plan.top, ["rm", "-r", "-q", "--cached", "--", plan.prefix]);
    }

    followInConfig(config, plan);

    if (plan.docs === config.docs || !plan.top) {
        return [];
    }

    // The old folder as a path of its own, not the end of a longer one (project/ in plugins/project/).
    const pattern = `(^|[^[:alnum:]_./-])${plan.prefix.replace(/[.[\]()*+?^$|\\{}]/g, "\\$&")}/`;
    return git(plan.top, ["grep", "-l", "-I", "-E", "-e", pattern, "--", "."]).split("\n").filter(Boolean);
}

/** The docs' commits in the project's repo as commits of their own: each one's tree the docs' folder, under their folder's name when the
 * new repo holds them in a subfolder, with its authors, days and message; one that leaves the docs as they were is none. The last, or
 * null when the project's repo never held them. */
function docsHistory(plan)
{
    if (plan.history.length === 0) {
        return null;
    }

    const fields = ["%H", "%an", "%ae", "%ad", "%cn", "%ce", "%cd", "%B"].join("%x00");
    const commits = gitIn(plan.top, ["log", "--reverse", "--date=raw", `--format=${fields}%x01`, "HEAD", "--", plan.prefix]).split("\x01").map((record) => record.replace(/^\n/, "")).filter(Boolean)
        .map((record) => record.split("\x00"));
    // The docs' folder in each commit, read at once: "<id> tree <size>", or "<name> missing" where the commit lacks it.
    const trees = gitIn(plan.top, ["cat-file", "--batch-check"], { input: commits.map(([hash]) => `${hash}:${plan.prefix}\n`).join("") }).split("\n");
    let parent = null;
    let last = null;

    for (const [index, [, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message]] of commits.entries()) {
        const [tree, kind] = trees[index].split(" ");

        if (kind !== "tree") {
            continue;
        }

        const wrapped = plan.inner ? gitIn(plan.top, ["mktree"], { input: `040000 tree ${tree}\t${plan.inner}\n` }).trim() : tree;

        if (wrapped === last) {
            continue;
        }

        const env = { GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_NAME: committerName, GIT_COMMITTER_EMAIL: committerEmail, GIT_COMMITTER_DATE: committerDate };
        parent = gitIn(plan.top, ["commit-tree", wrapped, ...(parent ? ["-p", parent] : []), "-F", "-"], { input: message, env }).trim();
        last = wrapped;
    }

    return parent;
}

/** The configuration after private: the paths under the docs' old folder under the new one, when the docs moved; the docs' repo in
 * repos:, when the project lists its repos. Changed in its text where those values are, so that the rest stays as the user wrote it. */
function followInConfig(config, plan)
{
    const path = join(config.root, configFile);
    const text = read(path);
    const yaml = parseDocument(text);
    const from = relativeTo(config.root, config.docs);
    const to = relativeTo(config.root, plan.docs);
    // [start, end, text]: a part of the file and what takes its place.
    const edits = [];

    if (from !== to) {
        // Only values naming a path: the project's name and its words stay what they are.
        for (const pair of yaml.contents?.items ?? []) {
            if (!["name", "language", "words", "people", "prefixes", "types"].includes(String(pair.key))) {
                visit(pair.value, { Scalar: (key, node) => {
                    if (key !== "key" && typeof node.value === "string" && (node.value === from || node.value.startsWith(`${from}/`))) {
                        edits.push([node.range[0], node.range[1], text.slice(node.range[0], node.range[1]).replace(from, to)]);
                    }
                } });
            }
        }
    }

    const repos = yaml.get("repos");
    const folder = relativeTo(config.root, plan.folder);

    if (repos?.items && !repos.items.some((repo) => String(repo.get?.("path") ?? "") === folder)) {
        const name = quoted(config.words.repoDocs);

        if (repos.flow) {
            const close = text.lastIndexOf("]", repos.range[1]);
            edits.push([close, close, `${repos.items.length > 0 ? ", " : ""}{ name: ${name}, path: ${quoted(folder)} }`]);
        } else {
            // A list item on lines of its own, at the list's indentation, after its last item.
            const last = repos.items.at(-1);
            const lineStart = text.lastIndexOf("\n", repos.items[0].range[0]) + 1;
            const dash = text.slice(lineStart, repos.items[0].range[0]);
            const end = text.indexOf("\n", last.range[1] - 1) + 1 || text.length;
            edits.push([end, end, `${end === text.length && !text.endsWith("\n") ? "\n" : ""}${dash}name: ${name}\n${" ".repeat(dash.length)}path: ${quoted(folder)}\n`]);
        }
    }

    write(path, edits.sort((one, other) => other[0] - one[0]).reduce((result, [start, end, put]) => `${result.slice(0, start)}${put}${result.slice(end)}`, text));
}
