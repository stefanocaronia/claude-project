// The project on disk: its root (the folder with .claude/project.yaml, from here up), its configuration, and the backlog, plan and
// decisions read and written through the pure modules of lib/; and what every script shares: git, the command line and its errors.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBacklog, renderArchive, renderBacklog } from "../lib/backlog.mjs";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { parseDecisions } from "../lib/decisions.mjs";
import { citedSpecs, parseSpecs } from "../lib/specs.mjs";
import { sayer } from "../lib/messages.mjs";
import { legacyFiles } from "../lib/words.mjs";
import { firstParagraph, joinFrontmatter, splitFrontmatter, titleOf } from "../lib/frontmatter.mjs";
import { planGoals } from "../lib/plan.mjs";
import { decisionLinks, dependencies, partsOf, seenFrom, todoLinks } from "../lib/links.mjs";
import { dueOf, isStale } from "../lib/schedule.mjs";
import { compareVersions, messageSummary, parseRelease } from "../lib/release.mjs";
import { contractState, contractValue } from "../lib/contracts.mjs";
import { firstName, parseTodo } from "../lib/todos.mjs";
import { hasBody, parseComments } from "../lib/notes.mjs";

// How long a change waits for the backlog's lock, and the age past which a lock left behind is taken over.
const lockWait = 10_000;
const lockStale = 30_000;
// The codes of a file another program holds a moment, on Windows (the page, an editor).
const busyCodes = ["EPERM", "EBUSY", "EACCES"];

/** The states of a task still to finish. */
export const openStates = ["doing", "todo", "postponed"];

/** The plugin's folder in the system's temporary one: the chats' holds, gh's readings, the owner's picture, a release's notes. */
export const tempFolder = join(tmpdir(), "claude-project");

/** The project whose configuration is in this folder or above: its config and the function that speaks its language. */
export function loadProject(from = process.env.CLAUDE_PROJECT_DIR || process.cwd())
{
    // A configuration kept elsewhere, for trying it on a project before it is written there: read once for its `root:`, which names the
    // project, then from that root.
    if (process.env.PROJECT_CONFIG) {
        const file = process.env.PROJECT_CONFIG;
        const text = read(file);
        const root = configOf(text, dirname(file), file).rootSetting ?? from;
        const config = configOf(text, root, file);
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

// The last backlog read, by the texts of its files: the check and the page read it several times a run, and a backlog of thousands of
// lines is worth reading once. Frozen, since every reader shares it.
let lastBacklog = null;

/** Every task, the backlog's by their sections and the archive's, each with its file, and the lines that do not read. */
export function readBacklog(config)
{
    const prefix = config.prefixes.task;
    const files = [config.files.tasks, config.files.archive];
    const texts = files.map(read);
    const isSame = lastBacklog && lastBacklog.words === config.words && lastBacklog.prefix === prefix && files.every((file, index) => lastBacklog.files[index] === file && lastBacklog.texts[index] === texts[index]);

    if (isSame) {
        return lastBacklog.backlog;
    }

    const live = parseBacklog(texts[0], config.words, prefix, false);
    const archived = parseBacklog(texts[1], config.words, prefix, true);
    const tagged = (list, file) => list.map((one) => deepFreeze({ ...one, file }));
    const backlog = Object.freeze({
        tasks: Object.freeze([...tagged(live.tasks, files[0]), ...tagged(archived.tasks, files[1])]),
        unread: Object.freeze([...tagged(live.unread, files[0]), ...tagged(archived.unread, files[1])]),
    });
    lastBacklog = { words: config.words, prefix, files, texts, backlog };
    return backlog;
}

function deepFreeze(value)
{
    Object.values(value).filter((one) => one && typeof one === "object").forEach(deepFreeze);
    return Object.freeze(value);
}

/** The backlog's tasks, to change: refused while a line of it does not read as a task, which writing it again would lose. */
export function changeableBacklog(config)
{
    const { tasks, unread } = readBacklog(config);

    if (unread.length > 0) {
        fail(sayer(config.language)("unreadFirst", { lines: unread.map((one) => `${shown(config, one.file)}:${one.line}`).join(", ") }));
    }

    return tasks;
}

/** Whether a task is closed: done, or archived. */
export function isClosed(task)
{
    return task.state === "done" || task.state === "archived";
}

/** What taskErrors checks a task against: the project's words, people, types, fields and prefixes, and the goals given, else the plan's. */
export function taskRules(config, say, goals = readGoals(config).map((goal) => goal.name))
{
    return { words: config.words, people: assignees(config), goals, types: Object.keys(config.types), fields: config.fields, prefix: config.prefixes.task, decisionPrefix: config.prefixes.decision, specPrefix: config.prefixes.spec, say };
}

/** Writes the backlog and the archive back, each task under its state: the archive first, which only gains lines, so that a task the
 * second write fails on is in two files, never in none; each file whole or not at all. */
export function writeBacklog(config, tasks)
{
    const prefix = config.prefixes.task;
    // One task a number: a write that failed halfway left a task in both files, and the change at hand settles where it goes.
    const clean = [...new Map(tasks.map(({ file, line, ...task }) => [task.id, task])).values()];
    const say = sayer(config.language);
    const archive = read(config.files.archive);
    const backlog = read(config.files.tasks);
    const archived = renderArchive(clean, archive, config.words, prefix);
    const rendered = renderBacklog(clean, backlog, config.words, prefix);

    // Only a file that changes is written: a change to an open task leaves the archive alone, even while a reader holds it.
    if (archived !== archive) {
        writeWhole(config.files.archive, stampDoc(config, config.files.archive, archived), say);
    }

    if (rendered !== backlog) {
        writeWhole(config.files.tasks, stampDoc(config, config.files.tasks, rendered), say);
    }
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
            // On Windows a lock another command is deleting refuses to open (EPERM) until it is gone: busy, as one that exists.
            if (error.code !== "EEXIST" && error.code !== "EPERM") {
                throw error;
            }

            // A lock left by a command that died long ago is taken over.
            const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());

            if (age > lockStale) {
                unlinkSync(lock);
                continue;
            }

            if (Date.now() - started > lockWait) {
                fail(sayer(config.language)("locked", { file: shown(config, lock) }));
            }

            pause(50);
        }
    }

    try {
        return change();
    } finally {
        unlinkSync(lock);
    }
}

/** The plan's goals, in order, each with its phase and, once closed, its day. */
export function readGoals(config)
{
    return planGoals(read(config.files.plan), config.words);
}

/** The decisions: { decided, open, openLine }, the rows of the table and the points still to decide. */
export function readDecisions(config)
{
    return parseDecisions(read(config.files.decisions), config.words);
}

/** The specifications, when the project keeps them: { specs, unread }; none without the file. */
export function readSpecs(config)
{
    return existsSync(config.files.specs) ? parseSpecs(read(config.files.specs), config.words, config.prefixes.spec) : { specs: [], unread: [] };
}

/** Where the files name each spec: { number, file, line, isCode } for every S-n in the files the configuration's cites name, the
 * specifications' own file aside; `isCode` for the code and the tests, outside the docs and the colleagues' memory, which cover it. */
export function specCitations(config)
{
    const own = normalized(config.files.specs);
    const inside = (file, folder) => normalized(file).startsWith(`${normalized(folder)}/`);
    return citingFiles(config).filter((file) => normalized(file) !== own).flatMap((file) => {
        const isCode = !inside(file, config.docs) && !inside(file, config.memory) && !inside(realPath(file), realPath(config.docs));
        return read(file).split(/\r?\n/).flatMap((line, index) => citedSpecs(line, config.prefixes.spec).map((number) => ({ number, file: shown(config, file), line: index + 1, isCode })));
    });
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

/** The project's name: the configuration's, else the title of its README, else its folder's. */
export function projectName(config)
{
    return config.name ?? readmeTitle(config.root) ?? config.root.split("/").at(-1);
}

/** The first `# ` heading of a folder's README, as its project calls itself; null without one. */
export function readmeTitle(folder)
{
    return /^# (.+)$/m.exec(read(join(folder, "README.md")))?.[1]?.trim() ?? null;
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

/** Every task line of the colleagues' todos with its id and what it waits for: { colleague, file, line, done, text, id, after }. */
export function readTodos(config)
{
    return todoFiles(config).flatMap(({ id: colleague, file }) => read(file).split(/\r?\n/).flatMap((text, index) => {
        const task = parseTodo(text);
        return task ? [{ colleague, file, line: index + 1, done: task.done, text: task.text, ...todoLinks(task.text, config.prefixes.task) }] : [];
    }));
}

/** The ids a colleague's todo ever gave, open, ticked or moved to their done and archived notes, as Crew keeps them. */
export function todoIdsEver(config)
{
    const ids = new Set(readTodos(config).map((todo) => todo.id).filter(Boolean));

    for (const { id } of todoFiles(config)) {
        for (const name of ["todo-done.md", "todo-archive.md"]) {
            for (const match of read(`${config.memory}/${id}/notes/${name}`).matchAll(/ · (#[\w-]+-\d+) · /g)) {
                ids.add(match[1]);
            }
        }
    }

    return ids;
}

/** The dependencies of the backlog and the todos together; the tasks given, or the backlog's as it is. */
export function readDependencies(config, tasks = readBacklog(config).tasks)
{
    return dependencies(tasks, readTodos(config), config.prefixes.task);
}

/** What the panel and the page show of each task's links, by its number: what it waits for and what of that is still open, the chain
 * to do first, who waits for it, what it points to and what points to it, its note's path when it has one; the large task it is a part
 * of, or its own parts, how many are closed and the next to start. */
export function taskLinks(config, tasks = readBacklog(config).tasks)
{
    const prefix = config.prefixes.task;
    const graph = readDependencies(config, tasks);
    const from = seenFrom(tasks, prefix);
    const notes = new Set(existsSync(config.files.notes) ? readdirSync(config.files.notes) : []);
    const parts = partsOf(tasks, prefix);
    const byId = new Map(tasks.map((task) => [`${prefix}-${task.id}`, task]));
    const decisions = decisionLinks(tasks, readDecisions(config).decided, config.prefixes).byTask;
    const holds = readHolds(config);
    const now = today();
    const isSpec = (one) => one.startsWith(`${config.prefixes.spec}-`);
    // Who waits for each task, gathered in one pass: looked up task by task, the waits of a large backlog cost its square.
    const waiters = new Map();

    for (const other of tasks) {
        for (const one of new Set(other.after)) {
            waiters.set(one, [...(waiters.get(one) ?? []), `${prefix}-${other.id}`]);
        }
    }

    return new Map(tasks.map((task) => {
        const id = `${prefix}-${task.id}`;
        const own = (parts.get(id) ?? []).map((part) => byId.get(part));
        // The next part to start: one to do and free, by priority, then the oldest; a postponed one when none is to do, so that a large
        // task postponed with its parts starts again from its ▶.
        const waiting = (part) => graph.blockers(`${prefix}-${part.id}`).length === 0;
        const rank = (part) => `${part.state === "todo" ? 0 : 1}${part.priority}${part.created}`;
        const next = own.filter((part) => ["todo", "postponed"].includes(part.state) && waiting(part)).sort((first, second) => rank(first).localeCompare(rank(second)))[0];
        const note = notes.has(`${id}.md`) ? read(notePath(config, task.id)) : null;
        return [task.id, {
            parent: task.parent ?? null,
            parts: own.map((part) => `${prefix}-${part.id}`),
            partsDone: own.filter(isClosed).length,
            nextPart: next ? `${prefix}-${next.id}` : null,
            after: task.after,
            // The specs it does apart from the rest it points to.
            see: task.see.filter((one) => !isSpec(one)),
            specs: task.see.filter(isSpec),
            blockedBy: graph.blockers(id),
            chain: graph.chain(id),
            waitedBy: waiters.get(id) ?? [],
            seenFrom: from.get(id) ?? [],
            note: note === null ? null : shown(config, notePath(config, task.id)),
            // Whether its note says more than its title and its comments: only then is there a note to open.
            noteHasBody: note !== null && hasBody(note),
            // The comments people left on it, in its note: { day, by, text }, the oldest first.
            comments: note === null ? [] : parseComments(note),
            decisions: decisions.get(id) ?? [],
            dueInfo: isClosed(task) ? null : dueOf(task.due, now),
            stale: isStale(task, Boolean(holds[String(task.id)]), now, config.limits.staleDays),
        }];
    }));
}

/** Who holds each task in progress now, as the chats of the project write it in the system's temporary folder (the panel's holds):
 * the colleague at work, or a chat; by task number. */
export function readHolds(config)
{
    const holds = {};

    if (!existsSync(tempFolder)) {
        return holds;
    }

    for (const name of readdirSync(tempFolder).filter((one) => /^held-.+\.json$/.test(one))) {
        try {
            const content = JSON.parse(read(join(tempFolder, name)));

            if (String(content.root).toLowerCase() === config.root.toLowerCase() && Date.now() - content.at < 24 * 3_600_000) {
                for (const [id, one] of Object.entries(content.tasks ?? {})) {
                    holds[id] = { colleague: one.colleague ?? null };
                }
            }
        } catch {
            // a file being written: the next reading has it
        }
    }

    return holds;
}

/** Where a task's note is, `<docs>/tasks/T-12.md`, whether it is written or not. */
export function notePath(config, id)
{
    return `${config.files.notes}/${config.prefixes.task}-${id}.md`;
}

/** The text files under the configured places a decision may be cited in, a `*` in a part of a path matching any name; a file reached
 * by two paths (a folder and a link to it) once. A test in a folder (`*.test.*`, `*.spec.*`) is left out: its D-n are made-up data. */
export function citingFiles(config)
{
    const extensions = /\.(md|ts|tsx|js|mjs|cjs|yaml|yml|json|css|py)$/;
    const tests = /\.(test|spec)\.\w+$/;
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
            } else if (extensions.test(entry.name) && !tests.test(entry.name) && entry.name !== "package-lock.json") {
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

/** A file's text; "" for a file that is not there. */
export function read(path)
{
    // Without the byte-order mark some editors and PowerShell put first, which a heading, a frontmatter or JSON would not read past.
    return existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : "";
}

/** A file written, its folder made when missing. */
export function write(path, text)
{
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
}

/** The plugin's own markdown documents: the core (the plan, the backlog, the decisions, the index, with the archive's, the tasks' notes'
 * and the releases' folders) and the project-management docs the user adds beside them (a GDD, a specification) or names in
 * `documents:`; each once. Not the folders the user adds in the docs (playtests, branding), nor the project's own markdown, nor the
 * colleagues' memory, which is Crew's. */
export function docFiles(config)
{
    const markdown = (folder) => (existsSync(folder) ? readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".md")).map((name) => `${folder.replaceAll("\\", "/")}/${name}`) : []);
    const files = [
        ...[config.docs, dirname(config.files.archive), config.files.notes, config.files.releases].flatMap(markdown),
        ...(config.documents ?? []).map((document) => document.path).filter((path) => path.toLowerCase().endsWith(".md") && existsSync(path)),
    ];
    return [...new Map(files.map((file) => [normalized(file), file])).values()];
}

/** Whether a path is one of the project's documents, whatever its slashes and case. */
export function isDoc(config, path)
{
    const wanted = normalized(path);
    return docFiles(config).some((file) => normalized(file) === wanted);
}

/** A document's kind, for its frontmatter: the plan, the backlog, its archive, the decisions, the specifications, the index, a task's
 * note, a release's notes, or any other doc. */
function docType(config, path)
{
    const file = normalized(path);
    const kinds = { plan: config.files.plan, backlog: config.files.tasks, archive: config.files.archive, decisions: config.files.decisions, specs: config.files.specs, index: config.files.index };
    const kind = Object.entries(kinds).find(([, own]) => normalized(own) === file)?.[0];
    return kind ?? (normalized(dirname(path)) === normalized(config.files.notes) ? "note" : normalized(dirname(path)) === normalized(config.files.releases) ? "release" : "doc");
}

/** A document's text with its frontmatter whole and true: the title, description and kind it has or else found, the day it was created
 * (kept; for a file without one, its first day in git), the day it last changed (today when its body changed, or when touched is true,
 * as after a hand edit; else the one it has, or its last day in git). A project's own keys stay. */
export function stampDoc(config, path, text, touched = false)
{
    const say = sayer(config.language);
    const previous = existsSync(path) ? read(path) : null;
    const old = splitFrontmatter(previous ?? "");
    const { data: given, body } = splitFrontmatter(text);
    const isChanged = touched || previous === null || old.body.replace(/\r\n/g, "\n").trim() !== body.replace(/\r\n/g, "\n").trim();
    const type = given.type ?? old.data.type ?? docType(config, path);
    const name = path.split("/").at(-1);
    const kept = { ...old.data, ...given };
    const core = ["plan", "backlog", "archive", "decisions", "specs", "index"];
    const description = kept.description
        || (core.includes(type) ? say(`docDescription_${type}`)
        : type === "note" ? say("docDescription_note", { id: name.replace(/\.md$/i, "") })
        : type === "release" ? firstParagraph(body.replace(/^#.*$/m, "")) || say("docDescription_release", { version: name.replace(/\.md$/i, "") })
        : firstParagraph(body) || titleOf(body, name));
    const data = {
        ...kept,
        // A core file without a heading of its own takes its kind's name in the project's language.
        title: kept.title || (/^# /m.test(body) || !core.includes(type) ? titleOf(body, name) : say(`docTitle_${type}`)),
        description,
        type,
        created: kept.created || (previous === null ? today() : gitDay(path, "first") ?? today()),
        updated: isChanged ? today() : kept.updated || gitDay(path, "last") || today(),
    };
    return joinFrontmatter(data, body);
}

/** A document written with its frontmatter stamped; any other file as it is. */
export function writeDoc(config, path, text)
{
    write(path, isDoc(config, path) || docType(config, path) !== "doc" ? stampDoc(config, path, text) : text);
}

/** The first or the last day git has a file, YYYY-MM-DD, the last today while it has changes not committed; null outside git or for a
 * file it does not track. */
function gitDay(path, which)
{
    if (which === "last" && git(dirname(path), ["status", "--porcelain", "--", path.split("/").at(-1)]).trim() !== "") {
        return today();
    }

    const days = git(dirname(path), ["log", "--follow", "--format=%as", "--", path.split("/").at(-1)]).trim().split("\n").filter(Boolean);
    return (which === "first" ? days.at(-1) : days[0]) ?? null;
}

/** A path for comparing: with "/", lowercased. */
function normalized(path)
{
    return String(path).replaceAll("\\", "/").toLowerCase();
}

/** The project's releases, the oldest version first: { version, day, summary, tasks, text, tagged, tagOnly, source }. The repo's tags
 * make them (v1.2.3 or 1.2.3), each on its tag's day; the notes in <docs>/releases go with their version's tag. Notes not tagged yet
 * (written, the tag still to make) are releases too, `tagged` false; a tag without notes has `tagOnly`, its summary and text from the
 * tag's own message when it says more than the version, else from the commit it marks (`source` "tag" or "commit"). With neither, the
 * version of the project's package.json, without a day: a project that released before the plugin starts from where it is. A Claude
 * Code plugin's version, in its manifest, counts past every tag and notes (`source` "plugin"), on the day the manifest took it. */
export function readReleases(config)
{
    const notes = new Map((!existsSync(config.files.releases) ? [] : readdirSync(config.files.releases))
        .filter((name) => /^v\d+\.\d+\.\d+\.md$/.test(name))
        .map((name) => {
            const text = read(join(config.files.releases, name));
            const release = parseRelease(text, config.prefixes.task);
            // The contracts' numbers the release recorded, by name.
            const contracts = splitFrontmatter(text).data.contracts;
            return release ? [release.version, { ...release, text, contracts: contracts && typeof contracts === "object" ? contracts : null }] : null;
        })
        .filter(Boolean));
    // Each tag with its day, its own message (an annotated tag's) and its commit's, fields and tags apart by the ASCII separators.
    const tags = new Map(git(config.root, ["for-each-ref", "--format=%(refname:short)%1f%(creatordate:short)%1f%(objecttype)%1f%(contents)%1f%(*contents)%1e", "refs/tags"])
        .split("\x1e").map((record) => record.replace(/^\s+/, "").split("\x1f"))
        .filter(([name, day]) => /^v?\d+\.\d+\.\d+$/.test(name ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(day ?? ""))
        .map(([name, day, type, own = "", marked = ""]) => {
            const version = name.replace(/^v/, "");
            const message = (type === "tag" ? own : "").replace(/-----BEGIN PGP SIGNATURE-----[\s\S]*$/, "").trim();
            const [text, source] = messageSummary(message, version) ? [message, "tag"] : [(type === "tag" ? marked : own).trim(), "commit"];
            return [version, { day, text, source }];
        }));
    const releases = [...new Set([...tags.keys(), ...notes.keys()])].map((version) => {
        const written = notes.get(version);
        const tag = tags.get(version);
        return written ? { ...written, day: tag?.day ?? written.day, tagged: tag !== undefined, tagOnly: false, source: "notes" }
            : { version, day: tag.day, summary: messageSummary(tag.text, version), tasks: [], text: tag.text, tagged: true, tagOnly: true, source: tag.source };
    });
    const packaged = releases.length === 0 ? packageVersion(config) : null;
    // A plugin's version is the one Claude Code installs, written in its manifest, whose tags may stop being made: it counts once it is
    // past every tag and notes.
    const plugin = packaged ? null : pluginVersion(config);
    const declared = plugin && releases.every((release) => compareVersions(plugin.version, release.version) > 0)
        ? { version: plugin.version, day: plugin.day, summary: "", tasks: [], text: "", tagged: false, tagOnly: true, source: "plugin" } : null;
    return [...releases, ...(packaged ? [{ version: packaged, day: "", summary: "", tasks: [], text: "", tagged: false, tagOnly: true, source: "package" }] : []), ...(declared ? [declared] : [])]
        .sort((first, second) => compareVersions(first.version, second.version));
}

/** Whether the project shows its versions: where it has a release already (a tag, notes or a package's version), or declares contracts
 * or the checks before one, unless its configuration says (`release: true | false`, or `show:`). A book that never releases is not
 * asked to. */
export function showsReleases(config, releases = readReleases(config))
{
    const declared = (config.contracts ?? []).length > 0 || (config.release?.run ?? []).length > 0 || (config.release?.remember ?? []).length > 0;
    return config.release?.show ?? (releases.length > 0 || declared);
}

/** The project's contracts now and at its last release, each { name, file, current, before, state }: the number the last release's
 * notes recorded, else the one its tag holds. */
export function readContracts(config, releases = readReleases(config))
{
    const last = releases.at(-1);
    const atTag = (contract) => {
        const path = relativeTo(config.root, contract.file);
        const text = last?.tagged ? [`v${last.version}`, last.version].map((tag) => git(config.root, ["show", `${tag}:${path}`])).find(Boolean) : "";
        return text ? contractValue(text, contract) : null;
    };

    return (config.contracts ?? []).map((contract) => {
        const recorded = last?.contracts?.[contract.name];
        const before = recorded !== undefined && recorded !== null ? String(recorded) : last && last.source !== "package" ? atTag(contract) : null;
        return { ...contractState(contract, contractValue(read(contract.file), contract), before), file: shown(config, contract.file) };
    });
}

/** The version of the project's package.json, when it has one as MAJOR.MINOR.PATCH; else null. */
function packageVersion(config)
{
    try {
        const version = JSON.parse(read(join(config.root, "package.json"))).version;
        return /^\d+\.\d+\.\d+$/.test(String(version)) ? version : null;
    } catch {
        return null;
    }
}

/** The version of a Claude Code plugin the project is: its .claude-plugin/plugin.json's, else that of the one plugin its
 * .claude-plugin/marketplace.json lists (its folder's plugin.json's, which Claude Code reads first, else the entry's), as
 * MAJOR.MINOR.PATCH; { version, day }, day that of the last commit that changed the version in that file, while the committed file says
 * the same; else null. */
function pluginVersion(config)
{
    const json = (path) => {
        try {
            return JSON.parse(read(path));
        } catch {
            return null;
        }
    };
    const own = join(config.root, ".claude-plugin", "plugin.json");
    const plugins = json(join(config.root, ".claude-plugin", "marketplace.json"))?.plugins;
    const only = Array.isArray(plugins) && plugins.length === 1 ? plugins[0] : null;
    const folder = typeof only?.source === "string" && only.source.startsWith("./") ? join(config.root, only.source, ".claude-plugin", "plugin.json") : null;
    const [version, file] = [[json(own)?.version, own], [folder && json(folder)?.version, folder], [only?.version, join(config.root, ".claude-plugin", "marketplace.json")]]
        .find(([one]) => /^\d+\.\d+\.\d+$/.test(String(one ?? ""))) ?? [];

    if (!version) {
        return null;
    }

    const path = relativeTo(config.root, file);
    const committed = git(config.root, ["show", `HEAD:./${path}`]).includes(`"${version}"`);
    return { version, day: committed ? git(config.root, ["log", "-1", "--format=%cs", "-G", "\"version\"", "--", path]).trim() : "" };
}

/** Whether a program is on the path, without running it: `git`, `gh`; on Windows with its .exe or .cmd. */
export function onPath(name, path = process.env.PATH ?? process.env.Path ?? "", windows = process.platform === "win32")
{
    const names = windows ? [`${name}.exe`, `${name}.cmd`, name] : [name];
    return pathFolders(path, windows).some((folder) => names.some((one) => existsSync(join(folder, one))));
}

/** Whether `project`, the plugin's own command (npm link in its folder), is on the path: a link to its scripts/cli.mjs, or npm's
 * shim on Windows that names it. */
export function projectCommandOnPath(path = process.env.PATH ?? process.env.Path ?? "", windows = process.platform === "win32")
{
    const names = windows ? ["project.cmd", "project"] : ["project"];

    for (const folder of pathFolders(path, windows)) {
        for (const name of names.map((one) => join(folder, one)).filter((one) => existsSync(one))) {
            try {
                if (realPath(name).replaceAll("\\", "/").endsWith("/scripts/cli.mjs") || /claude-project[\\/]+scripts[\\/]+cli\.mjs/.test(readFileSync(name, "utf8").slice(0, 4000))) {
                    return true;
                }
            } catch {
                // a file that does not read is no shim of ours
            }
        }
    }

    return false;
}

function pathFolders(path, windows)
{
    return path.split(windows ? ";" : delimiter).filter(Boolean);
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

// The top of the repo each folder is in, by folder.
const tops = new Map();

/** The top of the git repo a folder is in, lowercased, for comparing; "" outside git. A folder in a repo stays in it while a script or
 * the page runs: git is asked once; a folder in none, again, until it is. */
export function repoTop(folder)
{
    if (!tops.get(folder)) {
        tops.set(folder, git(folder, ["rev-parse", "--show-toplevel"]).trim().toLowerCase());
    }

    return tops.get(folder);
}

/** The project's repos: the configured ones, else the project's and, when the docs are a repo of their own, theirs. */
export function projectRepos(config)
{
    if (config.repos) {
        return config.repos;
    }

    const project = repoTop(config.root);
    const docs = existsSync(config.docs) ? repoTop(realPath(config.docs)) : "";
    return [{ name: config.words.repoProject, path: config.root }, ...(docs && docs !== project ? [{ name: config.words.repoDocs, path: realPath(config.docs) }] : [])];
}

/** A file or folder moved to its new path, with `git mv` where git tracks it, so that its history follows; renamed where git does not. */
export function moveFile(from, to)
{
    const folder = dirname(from);
    mkdirSync(dirname(to), { recursive: true });

    if (git(folder, ["ls-files", "--error-unmatch", "--", basename(from)]) !== "") {
        git(folder, ["mv", "--", basename(from), relative(folder, to).replaceAll("\\", "/")]);
    }

    // git mv says nothing either way: a file still in its place is one it did not move.
    if (existsSync(from)) {
        renameSync(from, to);
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

/** Stops a command with a message for the user: a ProjectError, which runCli prints. */
export function fail(message)
{
    throw new ProjectError(message);
}

/** The first line of an error's message: what a message for the user takes of it. */
export function firstLine(error)
{
    return String(error?.message ?? error).split("\n")[0];
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

/** The options and the words of a command line: the options named in `flags` take no value, the others the word after them, or the one
 * after their = (--text=…), which may start with -- too; one with no word after it is true. After a lone --, every word is text, so that
 * a text never reads as an option. */
export function commandLine(args, flags = [])
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];

        if (arg === "--") {
            words.push(...args.slice(index + 1));
            break;
        } else if (/^--[^=]+=/.test(arg)) {
            options[arg.slice(2, arg.indexOf("="))] = arg.slice(arg.indexOf("=") + 1);
        } else if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const value = args[index + 1];
            options[name] = flags.includes(name) || value === undefined || value.startsWith("--") ? true : (index++, value);
        } else {
            words.push(arg);
        }
    }

    return { options, words };
}

/** The configuration, or a message that says which line of the file is wrong; in English, since the language is in the file that does
 * not read. */
function configOf(text, root, file)
{
    try {
        return withLegacyNames(readConfig(text, root));
    } catch (error) {
        const line = error?.linePos?.[0]?.line;
        throw new ProjectError(`${file}${line ? `, line ${line}` : ""}: ${firstLine(error)} Fix it, or run /project:init again.`);
    }
}

/** A project made before the core went English: each core file or folder it has under its old Italian name, and not under the new one,
 * read where it is; `legacy` lists them, for the check to say and `init.mjs rename` to rename. */
function withLegacyNames(config)
{
    const legacy = [];
    const files = { ...config.files };
    let { archiveFolder, skip } = config;

    for (const key of ["decisions", "archive", "notes"].filter((one) => !config.namedFiles.includes(one))) {
        const old = `${config.docs}/${legacyFiles[key]}`;

        if (!existsSync(files[key]) && existsSync(old)) {
            legacy.push({ key, from: old, to: files[key] });
            files[key] = old;

            if (key === "archive") {
                archiveFolder = legacyFiles.archiveFolder;
                skip = [...new Set([...skip, archiveFolder])];
            }
        }
    }

    return { ...config, files, archiveFolder, skip, legacy };
}

/** The core files still written in the format's old words of the language (`## In corso`, `· fatto`, `## Traguardi`, `## Da decidere`):
 * read as they are, rewritten in English by `init.mjs rename`. Their paths. */
export function legacyFormat(config)
{
    const old = config.words.legacy;

    if (!old) {
        return [];
    }

    const uses = {
        [config.files.tasks]: Object.values(old.states).map((state) => `## ${state}`).concat(` · ${old.doneMarker} `, ` · ${old.startedMarker} `),
        [config.files.archive]: [` · ${old.doneMarker} `, ` · ${old.archivedMarker} `],
        [config.files.plan]: [`## ${old.goals}`, `(${old.phase} `, `${old.updated} `],
        [config.files.decisions]: [`## ${old.open}`, `| ${old.decision} |`, `${old.superseded} `],
    };
    return Object.entries(uses).filter(([file, marks]) => existsSync(file) && marks.some((mark) => read(file).includes(mark))).map(([file]) => file);
}

/** The plan and the decisions written again in the format's English words, the project's own text left as it is; the backlog is written
 * again by writeBacklog, which reads both. */
export function englishFormat(config)
{
    const old = config.words.legacy;
    const words = config.words;
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plan = read(config.files.plan)
        .replace(new RegExp(`^## ${escape(old.goals)}[ \t]*$`, "m"), `## ${words.goals}`)
        .replace(/^### .+$/gm, (heading) => heading
            .replace(new RegExp(`\\(${escape(old.phase)} (\\d+)\\)`, "i"), `(${words.phase} $1)`)
            .replace(new RegExp(` · ${escape(old.doneMarker)} (\\d{4}-\\d{2}-\\d{2})\\s*$`), ` · ${words.doneMarker} $1`))
        .replace(new RegExp(`${escape(old.updated)} (\\d{4}-\\d{2}-\\d{2})`), `${words.updated} $1`);
    const decisions = read(config.files.decisions)
        .replace(new RegExp(`^## ${escape(old.open)}[ \t]*$`, "m"), `## ${words.open}`)
        .replace(new RegExp(`^\\| # \\| ${escape(old.decision)} \\| ${escape(old.why)} \\|`, "m"), `| # | ${words.decision} | ${words.why} |`)
        .replace(new RegExp(`^(\\| *\\d+ *\\| *)${escape(old.superseded)} `, "gm"), `$1${words.superseded} `);
    const changed = [];

    for (const [file, text] of [[config.files.plan, plan], [config.files.decisions, decisions]]) {
        if (existsSync(file) && text !== read(file)) {
            writeDoc(config, file, text);
            changed.push(file);
        }
    }

    writeBacklog(config, readBacklog(config).tasks);
    return changed;
}

/** A file put in place of another; on Windows a reader that holds the old one refuses it for a moment: tried again for a second before
 * giving up. */
function replace(from, to)
{
    for (let tries = 0; ; tries++) {
        try {
            renameSync(from, to);
            return;
        } catch (error) {
            if (!busyCodes.includes(error.code) || tries >= 20) {
                throw error;
            }

            pause(50);
        }
    }
}

/** A file written whole or not at all: to a temporary file beside it, then renamed; a file another program holds says so. */
function writeWhole(path, text, say)
{
    const temporary = `${path}.${process.pid}.tmp`;

    try {
        write(temporary, text);
        replace(temporary, path);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // nothing was written
        }

        if (busyCodes.includes(error.code)) {
            fail(say("cannotWrite", { file: path, code: error.code }));
        }

        throw error;
    }
}

/** Waits a few milliseconds: the scripts run synchronously, a lock or a held file waited for in place. */
function pause(ms)
{
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The paths a configured place stands for, a `*` in a part of it matching any name there; the place itself without one. */
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
