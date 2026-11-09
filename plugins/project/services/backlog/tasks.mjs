// The backlog's tasks, read from its file and the archive, and written back whole, one change at a time.
import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { parseBacklog, renderArchive, renderBacklog } from "../../lib/backlog.mjs";
import { sayer } from "../../lib/messages.mjs";
import { readGoals, stampDoc } from "../docs.mjs";
import { fail } from "../errors.mjs";
import { pause, read, shown, writeWhole } from "../files.mjs";
import { assignees } from "../people.mjs";

// How long a change waits for the backlog's lock, and the age past which a lock left behind is taken over.
const lockWait = 10_000;
const lockStale = 30_000;

/** The states of a task still to finish. */
export const openStates = ["doing", "todo", "postponed"];

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
