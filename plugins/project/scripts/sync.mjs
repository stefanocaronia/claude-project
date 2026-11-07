// The private docs kept in sync among the people of a project (D-18), where the configuration says `sync: auto` and the docs' folder is a
// git repo of its own: pulled before a command changes them and when a chat starts, committed and pushed after the command, when a turn
// ends and when the chat ends, with what Crew's colleagues wrote there too. The code's repo is never touched: it is the user's to commit.
// Two people's changes at once are merged by merge.mjs, which this sets as the docs' merge driver: tasks by number, decisions by row, any
// other doc by its lines; a number both took goes to the one who pushed first, and the other's moves to the next free one.
//   node sync.mjs pull             (the others' changes, ours on top)
//   node sync.mjs push [message]   (everything changed in the docs' repo, committed and pushed)
//   node sync.mjs status           (whether the docs are in sync here, and how they stand)
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, loadProject, notePath, runCli } from "./project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The lines a colleague's memory and todo are written by, several people adding at once: git keeps both sides' lines (D-18). Crew's
// other files are merged as plain text, a clash a clash: a profile's frontmatter must never come out doubled.
const unionFiles = ["crew/memory/*/MEMORY.md", "crew/memory/*/todo.md", "crew/memory/*/notes/todo-*.md", "crew/memory/*/notes/diary-*.md"];
// The block of the docs' .gitattributes the plugin writes and keeps; the lines after it are the project's own, and win.
const blockStart = "# project: the docs merged when two people change them at once (D-18); kept by the plugin";
const blockEnd = "# project: end";
// How long a command waits for another's sync of the docs, and when a lock is one left by a command that died.
const lockWait = 120_000;
const lockStale = 300_000;
// Errors of a pull or a push that only mean the remote cannot be reached now: the work goes on here and reaches the others later.
const offline = /could not resolve|unable to access|could not read from remote|connection|timed out|network|couldn't find remote ref|no such ref/i;

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

/** The docs' repo when the project keeps its docs in sync: the docs' folder, the top of a git repo of its own; null otherwise. */
export function syncedDocs(config)
{
    if (config.sync !== "auto") {
        return null;
    }

    const top = run(config.docs, ["rev-parse", "--show-toplevel"]);
    return top.ok && same(top.out, config.docs) ? config.docs : null;
}

/** The others' changes into the docs, ours on top of them: before a change, so that a new number comes after theirs. What was written by
 * hand is committed first. Lines to say: what the merge changed of ours, or why the pull could not be done; none when all went well. */
export function pullDocs(config, say)
{
    const docs = syncedDocs(config);
    return docs ? withSyncLock(docs, config, say, () => pull(docs, config, say).lines) : [];
}

/** Everything changed in the docs' repo committed, with this message or the turn's, and pushed: the others' first when they pushed
 * meanwhile. Lines to say, as pullDocs's. */
export function pushDocs(config, say, message)
{
    const docs = syncedDocs(config);
    return docs ? withSyncLock(docs, config, say, () => push(docs, config, say, message)) : [];
}

/** How the docs stand: in sync or not, why not, and the commits not yet pushed. */
export function syncStatus(config, say)
{
    if (config.sync !== "auto") {
        return [say("syncOff")];
    }

    const docs = syncedDocs(config);

    if (!docs) {
        return [say("syncNoRepo", { folder: config.docs })];
    }

    if (!hasRemote(docs)) {
        return [say("syncNoRemote", { folder: docs })];
    }

    return [say("syncOn", { folder: docs, waiting: waiting(docs) ?? "?" })];
}

/** The commits of the docs not pushed yet: what a chat should say at its start, when they are some; null without an upstream. */
export function unpushed(config)
{
    const docs = syncedDocs(config);
    return docs && hasRemote(docs) ? waiting(docs) : null;
}

/** The pull itself: { lines, clash }, clash when the others' changes could not be taken. */
function pull(docs, config, say)
{
    prepare(docs, config);
    commitAll(docs, say("syncCommit"));
    rmSync(mergeNotes(docs), { force: true });

    if (!hasRemote(docs)) {
        return { lines: [], clash: false };
    }

    const pulled = run(docs, ["pull", "--rebase", "--quiet"]);

    if (pulled.ok) {
        return { lines: afterMerge(docs, config, say), clash: false };
    }

    if (inRebase(docs)) {
        run(docs, ["rebase", "--abort"]);
    }

    rmSync(mergeNotes(docs), { force: true });
    return offline.test(pulled.err) ? { lines: [], clash: false } : { lines: [say("syncConflict", { folder: docs, problem: firstLine(pulled.err) })], clash: true };
}

function push(docs, config, say, message)
{
    prepare(docs, config);
    commitAll(docs, message ?? say("syncCommit"));

    if (!hasRemote(docs)) {
        return [];
    }

    const upstream = run(docs, ["rev-parse", "--abbrev-ref", "@{u}"]).ok;

    if (upstream && waiting(docs) === 0) {
        return [];
    }

    const pushed = run(docs, upstream ? ["push", "-q"] : ["push", "-q", "-u", "origin", "HEAD"]);

    if (pushed.ok || offline.test(pushed.err) || !upstream) {
        return [];
    }

    // Someone pushed meanwhile: their changes first, ours on top, then ours go.
    const { lines, clash } = pull(docs, config, say);

    if (!clash) {
        run(docs, ["push", "-q"]);
    }

    return lines;
}

/** What the merge of the pull did to ours, said, and done to the notes: a task of ours that changed number takes its note along. */
function afterMerge(docs, config, say)
{
    const file = mergeNotes(docs);

    if (!existsSync(file)) {
        return [];
    }

    const merges = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    rmSync(file, { force: true });
    const lines = [];
    const prefix = config.prefixes.task;
    const notes = merges.flatMap((one) => one.notes);

    if (moveNotes(docs, config, notes.filter((note) => note.from && !note.decision))) {
        commitAll(docs, say("syncRenumberCommit", { prefix }));
    }

    for (const note of notes) {
        if (note.from && !note.decision) {
            lines.push(say("syncRenumbered", { from: note.from, to: note.to }));
        } else if (note.from) {
            lines.push(say("syncRenumberedDecision", { from: note.from, to: note.to }));
        } else if (note.dropped) {
            lines.push(say("syncDropped", { id: note.id, issue: note.issue }));
        } else if (note.lost) {
            lines.push(say("syncLost", { id: note.id }));
        } else if (note.kept) {
            lines.push(say("syncKept", { id: note.id, list: note.kept.join(", ") }));
        }
    }

    return lines;
}

/** The notes of our tasks that changed number, moved to their new number, their title and heading too: all read first, then all
 * written, as one number may be another's new one. A note is ours when the others' upstream does not have it. Whether any moved. */
function moveNotes(docs, config, moves)
{
    const number = (id) => Number(id.split("-").at(-1));
    const path = (id) => notePath(config, number(id));
    const inGit = (file) => relative(docs, file).replace(/\\/g, "/");
    const ours = moves.filter(({ from }) => existsSync(path(from)) && !run(docs, ["cat-file", "-e", `@{u}:${inGit(path(from))}`]).ok);
    const texts = ours.map(({ from, to }) => readFileSync(path(from), "utf8").replace(new RegExp(`(^title: "?|^# )${from} ·`, "gm"), `$1${to} ·`));
    ours.forEach(({ from }) => rmSync(path(from)));
    ours.forEach(({ to }, index) => writeFileSync(path(to), texts[index]));
    return ours.length > 0;
}

/** The docs' repo made ready to merge two people's changes: its .gitattributes block, and this machine's merge drivers, which run this
 * plugin's merge.mjs (its path changes with each version, so it is set each time). */
function prepare(docs, config)
{
    const file = join(docs, ".gitattributes");
    const old = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
    const path = (one) => relative(docs, one).replace(/\\/g, "/").replace(/ /g, "[[:space:]]");
    const block = [
        blockStart,
        "*.md merge=project-doc",
        `${path(config.files.tasks)} merge=project-tasks`,
        `${path(config.files.decisions)} merge=project-decisions`,
        "crew/** merge=text",
        ...unionFiles.map((glob) => `${glob} merge=union`),
        blockEnd,
    ].join("\n");
    const start = old.indexOf(blockStart);
    const end = old.indexOf(blockEnd);
    const rest = start >= 0 && end > start ? `${old.slice(0, start)}${old.slice(end + blockEnd.length)}`.replace(/^\n+/, "") : old;
    const text = `${block}\n${rest ? `\n${rest.replace(/^\n+/, "")}` : ""}`;

    if (text !== old) {
        writeFileSync(file, text);
    }

    const quoted = (one) => `"${one.replace(/\\/g, "/")}"`;
    const script = quoted(join(here, "merge.mjs"));

    for (const [kind, name] of [["tasks", "the backlog, task by task"], ["decisions", "the decisions, row by row"], ["doc", "a doc, by its lines"]]) {
        const driver = `${quoted(process.execPath)} ${script} ${kind} %O %A %B ${quoted(config.root)}`;

        if (run(docs, ["config", "--local", "--get", `merge.project-${kind}.driver`]).out !== driver) {
            run(docs, ["config", "--local", `merge.project-${kind}.name`, `Project: ${name}`]);
            run(docs, ["config", "--local", `merge.project-${kind}.driver`, driver]);
        }
    }
}

/** Every change of the docs' repo committed with this message; nothing when nothing changed. */
function commitAll(docs, message)
{
    if (inRebase(docs)) {
        run(docs, ["rebase", "--abort"]);
    }

    run(docs, ["add", "-A"]);

    if (!run(docs, ["diff", "--cached", "--quiet"]).ok) {
        run(docs, ["commit", "-q", "-m", message]);
    }
}

/** One sync of the docs at a time, on this machine: a command and the end of a turn may come together. */
function withSyncLock(docs, config, say, work)
{
    const lock = join(gitFolder(docs), "project-sync.lock");
    const started = Date.now();

    while (true) {
        try {
            closeSync(openSync(lock, "wx"));
            break;
        } catch (error) {
            if (error.code !== "EEXIST" && error.code !== "EPERM") {
                throw error;
            }

            const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());

            if (age > lockStale) {
                rmSync(lock, { force: true });
                continue;
            }

            if (Date.now() - started > lockWait) {
                return [say("syncBusy", { folder: docs })];
            }

            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        }
    }

    try {
        return work();
    } finally {
        try {
            unlinkSync(lock);
        } catch {
            // gone already
        }
    }
}

function waiting(docs)
{
    const count = run(docs, ["rev-list", "--count", "@{u}..HEAD"]);
    return count.ok ? Number(count.out) : null;
}

function inRebase(docs)
{
    const folder = gitFolder(docs);
    return existsSync(join(folder, "rebase-merge")) || existsSync(join(folder, "rebase-apply"));
}

/** Where merge.mjs leaves what it did, for the pull to say. */
function mergeNotes(docs)
{
    return join(gitFolder(docs), "project-merge.json");
}

/** The repo's own git folder. */
function gitFolder(docs)
{
    return resolve(docs, run(docs, ["rev-parse", "--absolute-git-dir"]).out);
}

/** Whether the repo has a remote to pull from and push to. */
function hasRemote(docs)
{
    return run(docs, ["remote"]).out.length > 0;
}

/** A git command in a folder: whether it went, its output and its errors, trimmed. */
function run(folder, args)
{
    try {
        const out = execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
        return { ok: true, out: out.trim(), err: "" };
    } catch (error) {
        return { ok: false, out: String(error.stdout ?? "").trim(), err: String(error.stderr ?? error.message ?? "").trim() };
    }
}

/** Whether two paths are the same folder, whatever their slashes and, on Windows, their case. */
function same(one, other)
{
    const norm = (path) => resolve(path).replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? norm(one).toLowerCase() === norm(other).toLowerCase() : norm(one) === norm(other);
}

function firstLine(text)
{
    return text.split(/\r?\n/).find((line) => line.trim()) ?? text;
}
