// What the panel and the page show of each task's links: what it waits for and points to, its parts, its note and comments, who
// holds it.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decisionLinks, dependencies, partsOf, seenFrom } from "../../lib/links.mjs";
import { hasBody, parseComments } from "../../lib/notes.mjs";
import { dueOf, isStale } from "../../lib/schedule.mjs";
import { notePath, readDecisions } from "../docs.mjs";
import { read, shown, tempFolder, today } from "../files.mjs";
import { readTodos } from "../people.mjs";
import { isClosed, readBacklog } from "./tasks.mjs";

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
            // Started by another person of the project: they hold it on their machine, which this one cannot see (D-18).
            stale: isStale(task, Boolean(holds[String(task.id)]) || Boolean(task.startedBy && task.startedBy !== config.me), now, config.limits.staleDays),
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
