// The project on disk: its root (the folder with .claude/project.yaml, from here up), its configuration, and the backlog, plan and
// decisions read and written through the pure modules of lib/.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBacklog, renderArchive, renderBacklog } from "../lib/backlog.mjs";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { parseDecisions } from "../lib/decisions.mjs";
import { sayer } from "../lib/messages.mjs";
import { planGoals } from "../lib/plan.mjs";
import { firstName } from "../lib/todos.mjs";

const lockWait = 10_000;
const lockStale = 30_000;

/** The project whose configuration is in this folder or above: its config and the function that speaks its language. */
export function loadProject(from = process.env.CLAUDE_PROJECT_DIR || process.cwd())
{
    // A configuration kept elsewhere, for trying it on a project before it is written there: its `root:` names the project.
    if (process.env.PROJECT_CONFIG) {
        const text = read(process.env.PROJECT_CONFIG);
        const config = configOf(text, configOf(text, dirname(process.env.PROJECT_CONFIG), process.env.PROJECT_CONFIG).rootSetting ?? from, process.env.PROJECT_CONFIG);
        return { config, say: sayer(config.language) };
    }

    const root = findRoot(from);

    if (root === null) {
        throw new ProjectError(sayer("en")("noConfig"));
    }

    const config = configOf(read(join(root, configFile)), root, configFile);
    return { config, say: sayer(config.language) };
}

/** The nearest folder from here up that holds .claude/project.yaml; null when none does. */
export function findRoot(from)
{
    let folder = from;

    while (true) {
        if (existsSync(join(folder, configFile))) {
            return folder;
        }

        const parent = dirname(folder);

        if (parent === folder) {
            return null;
        }

        folder = parent;
    }
}

/** Every task, the backlog's by their sections and the archive's, each with its file, and the lines that do not read. */
export function readBacklog(config)
{
    const prefix = config.prefixes.task;
    const live = parseBacklog(read(config.files.tasks), config.words, prefix, false);
    const archived = parseBacklog(read(config.files.archive), config.words, prefix, true);
    const tagged = (list, file) => list.map((one) => ({ ...one, file }));
    return {
        tasks: [...tagged(live.tasks, config.files.tasks), ...tagged(archived.tasks, config.files.archive)],
        unread: [...tagged(live.unread, config.files.tasks), ...tagged(archived.unread, config.files.archive)],
    };
}

/** Writes the backlog and the archive back, each task under its state: the archive first, which only gains lines, so that a task the
 * second write fails on is in two files, never in none; each file whole or not at all. */
export function writeBacklog(config, tasks)
{
    const prefix = config.prefixes.task;
    // One task a number: a write that failed halfway left a task in both files, and the change at hand settles where it goes.
    const clean = [...new Map(tasks.map(({ file, line, ...task }) => [task.id, task])).values()];
    const say = sayer(config.language);
    writeWhole(config.files.archive, renderArchive(clean, read(config.files.archive), config.words, prefix), say);
    writeWhole(config.files.tasks, renderBacklog(clean, read(config.files.tasks), config.words, prefix), say);
}

/** Runs a change of the backlog alone: two commands at once, a press in the panel while Claude adds a task, wait for each other. */
export function withBacklogLock(config, change)
{
    const lock = `${config.files.tasks}.lock`;
    const started = Date.now();
    mkdirSync(dirname(lock), { recursive: true });

    while (true) {
        try {
            closeSync(openSync(lock, "wx"));
            break;
        } catch (error) {
            if (error.code !== "EEXIST") {
                throw error;
            }

            // A lock left by a command that died long ago is taken over.
            const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());

            if (age > lockStale) {
                unlinkSync(lock);
                continue;
            }

            if (Date.now() - started > lockWait) {
                throw new ProjectError(sayer(config.language)("locked", { file: shown(config, lock) }));
            }

            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
    }

    try {
        return change();
    } finally {
        unlinkSync(lock);
    }
}

export function readGoals(config)
{
    return planGoals(read(config.files.plan), config.words);
}

export function readDecisions(config)
{
    return parseDecisions(read(config.files.decisions), config.words);
}

/** The colleagues of Crew: each agent of the agents folder, by id and first name. */
export function colleagues(config)
{
    return existsSync(config.agents) ? readdirSync(config.agents).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3)).map((id) => ({ id, name: firstName(id) })) : [];
}

/** A colleague's full name, role and color, from their profile's frontmatter, as Crew writes it. */
export function profileOf(config, id, name)
{
    const profile = read(`${config.agents}/${id}.md`);
    const description = /^description: "?(.*?)"?$/m.exec(profile)?.[1] ?? "";
    const sentence = description.split(". ")[0];
    const comma = sentence.indexOf(", ");
    return { fullName: comma > 0 ? sentence.slice(0, comma) : name, role: comma > 0 ? sentence.slice(comma + 2) : "", color: /^color: (\w+)/m.exec(profile)?.[1] ?? "gray" };
}

/** Who may hold a task: the people of the configuration and the colleagues, by their first names. */
export function assignees(config)
{
    return [...new Set([...config.people, ...colleagues(config).map((colleague) => colleague.name)])];
}

/** The colleagues' todo files that exist, by the id of their memory folder. */
export function todoFiles(config)
{
    const ids = existsSync(config.memory) ? readdirSync(config.memory) : [];
    return ids.map((id) => ({ id, name: firstName(id), file: `${config.memory}/${id}/todo.md` })).filter((one) => existsSync(one.file));
}

/** The text files under the configured places a decision may be cited in, a `*` in a part of a path matching any name; a file reached
 * by two paths (a folder and a link to it) once. */
export function citingFiles(config)
{
    const extensions = /\.(md|ts|tsx|js|mjs|cjs|yaml|yml|json|css|py)$/;
    const skip = new Set(config.skip);
    const files = new Map();
    const add = (path) => files.set(realPath(path).toLowerCase(), path.replaceAll("\\", "/"));

    const walk = (path) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, entry.name);

            if (entry.isDirectory()) {
                if (!skip.has(entry.name)) {
                    walk(child);
                }
            } else if (extensions.test(entry.name) && entry.name !== "package-lock.json") {
                add(child);
            }
        }
    };

    for (const place of config.cites.flatMap(expand)) {
        if (!existsSync(place)) {
            continue;
        }

        if (isFolder(place)) {
            walk(place);
        } else if (extensions.test(place)) {
            add(place);
        }
    }

    return [...files.values()];
}

/** A path for messages: relative to the project's root, with "/". */
export function shown(config, path)
{
    return relativeTo(config.root, path.replaceAll("\\", "/"));
}

export function read(path)
{
    return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function write(path, text)
{
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
}

/** Where a path really is, past any link on the way; the path itself when it does not exist. */
export function realPath(path)
{
    try {
        return realpathSync.native(path);
    } catch {
        return path;
    }
}

/** A git command in a folder, its output; empty when git fails or is missing. */
export function git(folder, args)
{
    try {
        return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return "";
    }
}

/** Today, as the files write a day: the local date, YYYY-MM-DD. */
export function today(date = new Date())
{
    return date.toLocaleDateString("sv-SE");
}

/** Whether the module of this URL is the one node was asked to run, through links too. */
export function isMain(url)
{
    return Boolean(process.argv[1]) && realPath(resolve(process.argv[1])).toLowerCase() === realPath(fileURLToPath(url)).toLowerCase();
}

/** An error the command line prints as a message, without a stack. */
export class ProjectError extends Error
{
}

/** Runs a command line: a ProjectError is printed and exits 1, anything else is a bug and throws. */
export async function runCli(main)
{
    try {
        await main();
    } catch (error) {
        if (error instanceof ProjectError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
        }

        throw error;
    }
}

/** The configuration, or a message that says which line of the file is wrong. */
function configOf(text, root, file)
{
    try {
        return readConfig(text, root);
    } catch (error) {
        const line = error?.linePos?.[0]?.line;
        throw new ProjectError(`${file}${line ? `, line ${line}` : ""}: ${String(error?.message ?? error).split("\n")[0]} Fix it, or run /project:init again.`);
    }
}

/** A file written whole or not at all: to a temporary file beside it, then renamed; a file another program holds says so. */
function writeWhole(path, text, say)
{
    const temporary = `${path}.${process.pid}.tmp`;

    try {
        write(temporary, text);
        renameSync(temporary, path);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // nothing was written
        }

        if (["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
            throw new ProjectError(say("cannotWrite", { file: path, code: error.code }));
        }

        throw error;
    }
}

function expand(pattern)
{
    const parts = pattern.split("/");
    const at = parts.findIndex((part) => part.includes("*"));

    if (at < 0) {
        return [pattern];
    }

    const base = parts.slice(0, at).join("/") || "/";
    const matcher = new RegExp(`^${parts[at].split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

    if (!isFolder(base)) {
        return [];
    }

    return readdirSync(base).filter((name) => matcher.test(name)).flatMap((name) => expand([base, name, ...parts.slice(at + 1)].join("/")));
}

function isFolder(path)
{
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
