// Sets a project up: .claude/project.yaml and the docs (plan, backlog and its archive, decisions, their index), in the project's language.
// Never overwrites a file. node init.mjs [--language it] [--docs project] [--people "Claude,Ann"] [--private private] [--name "My app"]
// --private <folder>: the docs live in a git repo of their own, nested in that folder and ignored by the project's repo.
// node init.mjs rename [--write]: a project made before the core went English gets its core files' English names (DECISIONS.md,
// archive/TASKS-archive.md, tasks/), with git when they are in a repo, and their format's English words (## In progress, · done,
// ## Goals, ## To decide); the links of its docs follow. Without --write, what would change.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { sayer } from "../lib/messages.mjs";
import { quoted } from "../lib/text.mjs";
import { coreFiles, legacyFiles, presets } from "../lib/words.mjs";
import { markdownFiles } from "./check.mjs";
import { moveDecisions, moveSteps, survey, writeSettings } from "./adopt.mjs";
import { englishFormat, git, isMain, legacyFormat, loadProject, ProjectError, read, readmeTitle, runCli, shown, today, write, writeDoc } from "./project.mjs";

const examples = { language: "--language it", docs: "--docs project", people: '--people "Claude,Ann"', private: "--private private", name: '--name "My app"' };

const templates = {
    en: {
        plan: (name, updated) => `# ${name} — Plan\n\n> ${updated}. What the project is doing now, in short.\n\n| Phase | At the end you can… |\n|---|---|\n| 1. First phase | what one can do at its end |\n\nThe plan holds the phases and the goals; the tasks are in the [backlog](TASKS.md).\n\n## Goals\n\n### First goal (phase 1)\n\nWhat it is for.\n`,
        tasks: (name) => `# ${name} — Backlog\n\nThe project's tasks, one a line, changed with the project plugin's backlog command, by hand only a task's text. The archived ones are in the [archive](archive/TASKS-archive.md).\n\n`,
        archive: (name) => `# ${name} — Archived tasks\n`,
        decisions: (name) => `# ${name} — Decisions\n\n> What is decided and why, in short. A proposal stays under "To decide" until it is decided.\n\n| # | Decision | Why |\n|---|---|---|\n\n## To decide\n`,
        index: (name) => `# ${name} — Project docs\n\n- [Plan](PLAN.md): the phases and the goals.\n- [Backlog](TASKS.md): the tasks.\n- [Decisions](DECISIONS.md): what is decided and why.\n`,
    },
    it: {
        plan: (name, updated) => `# ${name} — Piano\n\n> ${updated}. Cosa fa il progetto ora, in breve.\n\n| Fase | Alla fine puoi… |\n|---|---|\n| 1. Prima fase | cosa si può fare alla sua fine |\n\nIl piano tiene le fasi e i traguardi; i compiti sono nel [backlog](TASKS.md).\n\n## Traguardi\n\n### Primo traguardo (fase 1)\n\nA cosa serve.\n`,
        tasks: (name) => `# ${name} — Backlog\n\nI compiti del progetto, uno per riga, cambiati col comando backlog del plugin project, a mano solo il testo. Quelli archiviati sono nell'[archivio](archive/TASKS-archive.md).\n\n`,
        archive: (name) => `# ${name} — Compiti archiviati\n`,
        decisions: (name) => `# ${name} — Decisioni\n\n> Cosa è deciso e perché, in breve. Una proposta resta in "Da decidere" finché non si decide.\n\n| # | Decisione | Perché |\n|---|---|---|\n\n## Da decidere\n`,
        index: (name) => `# ${name} — Documenti di progetto\n\n- [Piano](PLAN.md): le fasi e i traguardi.\n- [Backlog](TASKS.md): i compiti.\n- [Decisioni](DECISIONS.md): cosa è deciso e perché.\n`,
    },
};

/** Writes what a project lacks of the configuration and the docs; returns the files written and those already there, as shown paths. */
export function init(root, options = {})
{
    const language = options.language ?? "en";

    if (!presets[language]) {
        throw new ProjectError(`The language is one of ${Object.keys(presets).join(", ")}, not ${language}; another language: pick one and override its words under words: in ${configFile}.`);
    }

    const name = options.name ?? readmeTitle(root) ?? basename(root);
    const docs = options.docs ?? (options.private ? `${options.private}/project` : "project");
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
    place(config.files.plan, text.plan(name, `${config.words.updated} ${today()}`));
    place(config.files.tasks, text.tasks(name) + Object.values(config.words.states).map((state) => `## ${state}`).join("\n\n") + "\n");
    place(config.files.archive, text.archive(name));
    place(config.files.decisions, text.decisions(name));
    place(config.files.index, text.index(name));
    return { written, kept };
}

if (isMain(import.meta.url)) {
    runCli(() => {
        const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const options = {};
        const args = process.argv.slice(2);

        if (args[0] === "adopt") {
            adoptCommand(root, args.slice(1));
            return;
        }

        if (args[0] === "rename") {
            renameCommand(root, args.includes("--write"));
            return;
        }

        for (let index = 0; index < args.length; index += 2) {
            const key = args[index].replace(/^--/, "");
            const value = args[index + 1];

            if (value === undefined || value.startsWith("--")) {
                throw new ProjectError(sayer(options.language ?? "en")("noValue", { name: key, example: examples[key] ?? `--${key} <value>` }));
            }

            options[key] = key === "people" ? value.split(",").map((one) => one.trim()).filter(Boolean) : value;
        }

        printWritten(init(root, options), sayer(options.language ?? "en"));
    });
}

/** rename: the core files and folders a project still keeps under their old Italian names, moved to the English ones (the archive's whole
 * folder with it), with `git mv` where git tracks them; then the old names in the docs' markdown follow, and the files outside the docs
 * that still name them are listed, for Claude to fix with the user. */
function renameCommand(root, isWritten)
{
    const { config, say } = loadProject(root);
    const moves = config.legacy ?? [];
    const formats = legacyFormat(config);

    if (moves.length === 0 && formats.length === 0) {
        console.log(say("renameNone"));
        return;
    }

    // The archive moves as a folder, with what else it keeps; its backlog file then takes its new name inside it.
    const steps = moves.flatMap(({ key, from, to }) => (key === "archive"
        ? [{ from: join(config.docs, legacyFiles.archiveFolder), to: join(config.docs, coreFiles.archiveFolder) }, { from: join(config.docs, coreFiles.archiveFolder, basename(from)), to }]
        : [{ from, to }]));
    // The old names as the docs write them, and the new ones.
    const names = [["archivio/TASKS-archivio.md", "archive/TASKS-archive.md"], ["TASKS-archivio.md", "TASKS-archive.md"], ["DECISIONI.md", "DECISIONS.md"], ["](archivio/", "](archive/"], ["](compiti/", "](tasks/"], ["compiti/T-", "tasks/T-"]];

    for (const step of steps) {
        console.log(say("renameStep", { from: shown(config, step.from), to: shown(config, step.to) }));
    }

    for (const file of formats) {
        console.log(say("renameFormat", { file: shown(config, file) }));
    }

    if (!isWritten) {
        console.log(say("renameDry"));
        return;
    }

    // One after the other: the archive's file is in its new folder only once the folder has moved.
    for (const step of steps) {
        if (!existsSync(step.from) || existsSync(step.to)) {
            continue;
        }

        mkdirSync(dirname(step.to), { recursive: true });
        const folder = dirname(step.from);
        const tracked = git(folder, ["ls-files", "--error-unmatch", "--", relative(folder, step.from)]) !== "";

        if (!tracked || git(folder, ["mv", "--", relative(folder, step.from), relative(folder, step.to)]) === "" && existsSync(step.from)) {
            renameSync(step.from, step.to);
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
            changed.push(...(changed.includes(shown(fresh, file)) ? [] : [shown(fresh, file)]));
        }
    }

    console.log(say("renameDone", { count: steps.length, files: changed.length > 0 ? changed.join(", ") : "—" }));
    const others = [...new Set(git(root, ["grep", "-l", "-I", "-e", "DECISIONI.md", "-e", "TASKS-archivio.md", "-e", "archivio/", "--", "."]).split("\n").filter(Boolean))]
        .filter((file) => !changed.includes(file.replaceAll("\\", "/")));

    if (others.length > 0) {
        console.log(say("renameOthers", { list: others.join(", ") }));
    }
}

/** adopt: what the project has and the configuration that reads it; --write writes it and the missing docs; --steps moves the plan's
 * checkbox steps into the backlog. The details are for Claude, who tells the user; the frame speaks the docs' language. */
function adoptCommand(root, args)
{
    const { found, settings, report } = survey(root);
    const say = sayer(settings.language);

    if (args[0] === "--decisions") {
        if (!args[1] || !args[2]) {
            throw new ProjectError(say("noValue", { name: "decisions", example: 'adopt --decisions design/flow.md "Decisions taken"' }));
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
        throw new ProjectError(say("adoptExists", { file: configFile }));
    }

    printWritten(init(root, { language: settings.language, docs: settings.docs, name: settings.name, people: settings.people }), say);
}

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
        write(join(path, ".gitignore"), "tmp/\n");
        execFileSync("git", ["init", "-q", path], { windowsHide: true });
        written.push(`${folder}/ (git init)`);
    }

    if (!existsSync(join(root, ".git"))) {
        return;
    }

    const ignore = join(root, ".gitignore");
    const text = read(ignore);
    const line = `/${folder.replace(/^\/|\/$/g, "")}/`;

    if (!text.split(/\r?\n/).includes(line)) {
        write(ignore, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}\n# The project's private docs, a git repo of their own\n${line}\n`);
        written.push(".gitignore");
    }
}
