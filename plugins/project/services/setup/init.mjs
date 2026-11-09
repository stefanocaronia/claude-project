// A project set up: .claude/project.yaml and the docs in its language, never over a file, the docs in a private repo of their own
// when asked; and a project made before the core went English, its core files given their English names.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { configFile, readConfig, relativeTo } from "../../lib/config.mjs";
import { sayer } from "../../lib/messages.mjs";
import { quoted } from "../../lib/text.mjs";
import { coreFiles, legacyFiles, presets } from "../../lib/words.mjs";
import { markdownFiles } from "../check.mjs";
import { loadProject, readmeTitle } from "../config.mjs";
import { legacyFormat, writeDoc } from "../docs.mjs";
import { fail } from "../errors.mjs";
import { read, shown, today, write } from "../files.mjs";
import { git, moveFile } from "../git.mjs";
import { englishFormat } from "./legacy.mjs";

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

/** A language the plugin has words for, as given; any other is refused, in the language of `say`, before a file is written. */
export function knownLanguage(language, say = sayer("en"))
{
    if (!presets[language]) {
        fail(say("badLanguage", { list: Object.keys(presets).join(", "), value: language, file: configFile }));
    }

    return language;
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
export function initRepo(path)
{
    if (!existsSync(join(path, ".gitignore"))) {
        write(join(path, ".gitignore"), "tmp/\n");
    }

    execFileSync("git", ["init", "-q", path], { windowsHide: true });
    gitIn(path, ["symbolic-ref", "HEAD", "refs/heads/main"]);
}

/** The project's .gitignore leaving a folder out, its line added once; true when it was added. */
export function ignoreFolder(root, folder)
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
export function gitIn(folder, args, { input, env } = {})
{
    return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", input, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 512 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}
