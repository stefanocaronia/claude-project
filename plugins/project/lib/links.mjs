// What a task waits for and what it points to, written as Crew writes them at the end of a line: `(after: T-62, #giulia-1)` names
// the tasks this one waits for, a backlog task or a colleague's todo line by its id; `(see: T-12, D-2)` names tasks and decisions to
// read with it; `(in: T-23)` names the large task this one is a part of; `(issue: #34)`, the GitHub issue it does; `(due: 2026-11-15)`,
// the day it is due; `(type: bug)`, its label. A todo line that is a colleague's part of a backlog task carries the task's number where
// Crew puts its id. Pure.
import { escapeRegex } from "./text.mjs";

// The suffixes that name several things, and those that name one, by the field a task keeps it in; written back in this order.
const lists = ["after", "see"];
const singles = { in: "parent", issue: "issue", due: "due", type: "type" };
const kinds = [...lists, ...Object.keys(singles)];

/** A text without its suffixes at the end, in any order, and what they name: { text, after, see, parent, issue, due, type }, lists
 * empty and the others null when it has none. */
export function splitLinks(text)
{
    let rest = String(text);
    const found = Object.fromEntries(kinds.map((kind) => [kind, []]));

    for (let match = suffixOf(rest); match; match = suffixOf(rest)) {
        found[match.kind] = [...new Set([...listOf(match.items), ...found[match.kind]])];
        rest = rest.slice(0, match.index);
    }

    return { text: rest.trim(), after: found.after, see: found.see, ...Object.fromEntries(Object.entries(singles).map(([kind, field]) => [field, found[kind][0] ?? null])) };
}

/** The text with its suffixes at the end again, in their order, each only when it names something. */
export function joinLinks(text, links = {})
{
    const suffix = (kind, items) => (items.length > 0 ? ` (${kind}: ${items.join(", ")})` : "");
    return `${text}${lists.map((kind) => suffix(kind, links[kind] ?? [])).join("")}${Object.entries(singles).map(([kind, field]) => suffix(kind, links[field] ? [links[field]] : [])).join("")}`;
}

/** The decisions and the tasks that name each other, both ways: a task's `(see: D-2)` and a decision whose text or why names a task.
 * { byTask: task id → its decisions, byDecision: decision id → its tasks }, ids as `T-12` and `D-2`. */
export function decisionLinks(tasks, decisions, prefixes)
{
    const byTask = new Map();
    const byDecision = new Map();
    const tie = (task, decision) => {
        byTask.set(task, [...new Set([...(byTask.get(task) ?? []), decision])]);
        byDecision.set(decision, [...new Set([...(byDecision.get(decision) ?? []), task])]);
    };
    const known = new Set(tasks.map((task) => `${prefixes.task}-${task.id}`));
    const decided = new Set(decisions.map((row) => `${prefixes.decision}-${row.number}`));

    for (const task of tasks) {
        for (const decision of (task.see ?? []).filter((one) => decided.has(one))) {
            tie(`${prefixes.task}-${task.id}`, decision);
        }
    }

    for (const row of decisions) {
        for (const match of `${row.text} ${row.why ?? ""}`.matchAll(new RegExp(`\\b${escapeRegex(prefixes.task)}-(\\d+)\\b`, "g"))) {
            if (known.has(`${prefixes.task}-${match[1]}`)) {
                tie(`${prefixes.task}-${match[1]}`, `${prefixes.decision}-${row.number}`);
            }
        }
    }

    return { byTask, byDecision };
}

/** The parts one level too deep: a task whose large task is itself a part, as { id, parent }. A large task holds parts, never parts of
 * parts. */
export function nestedParts(tasks, prefix = "T")
{
    const parentOf = new Map(tasks.map((task) => [`${prefix}-${task.id}`, task.parent ?? null]));
    return tasks.filter((task) => task.parent && parentOf.get(task.parent)).map((task) => ({ id: `${prefix}-${task.id}`, parent: task.parent }));
}

/** Each large task's parts, by its id: the ids of the tasks whose `in` names it, in the backlog's order. */
export function partsOf(tasks, prefix = "T")
{
    const parts = new Map();

    for (const task of tasks.filter((one) => one.parent)) {
        parts.set(task.parent, [...(parts.get(task.parent) ?? []), `${prefix}-${task.id}`]);
    }

    return parts;
}

/** A list given on the command line, `T-3, #giulia-1` or `T-3 #giulia-1`, each once; empty for "" or "-". */
export function listOf(given)
{
    return [...new Set(String(given ?? "").split(/[,\s]+/).filter((item) => item !== "" && item !== "-"))];
}

/** The names a suffix gives that are no task or todo id (in after), no task or decision (in see), no task (in in), no issue number (in
 * issue), no day (in due), no word (in type). */
export function badLinks(kind, items, prefixes)
{
    const task = `${escapeRegex(prefixes.task)}-\\d+`;
    const patterns = { after: `^(${task}|#[\\w-]+-\\d+)$`, see: `^(${task}|${escapeRegex(prefixes.decision)}-\\d+)$`, in: `^${task}$`, issue: "^#\\d+$", due: "^\\d{4}-\\d{2}-\\d{2}$", type: "^[a-z][\\w-]*$" };
    return items.filter((item) => !new RegExp(patterns[kind]).test(item));
}

/** The id and the waits of a colleague's todo line, as Crew writes it after the priority and the day: `#matteo-3 · …` or `T-61 · …`. */
export function todoLinks(text, prefix = "T")
{
    const id = new RegExp(`^(#[\\w-]+-\\d+|${escapeRegex(prefix)}-\\d+) · `).exec(text)?.[1] ?? null;
    return { id, after: splitLinks(text).after };
}

/** The dependencies of the backlog and the todos, read together: who waits for whom, what is still open, the chains and the cycles.
 * A task is `T-n` (the prefix's), a todo line `#name-n`; a todo line carrying `T-n` is that task, its waits added to the task's. */
export function dependencies(tasks, todos, prefix = "T")
{
    const openStates = new Set(["doing", "todo", "postponed"]);
    const waits = new Map();
    const open = new Map();
    const add = (id, after) => waits.set(id, [...new Set([...(waits.get(id) ?? []), ...after])]);

    for (const task of tasks) {
        const id = `${prefix}-${task.id}`;
        add(id, task.after ?? []);
        open.set(id, openStates.has(task.state));
    }

    const inBacklog = new Set(open.keys());

    for (const todo of todos.filter((one) => one.id)) {
        add(todo.id, todo.after);

        // The backlog says whether a task is open; the todo lines only for an id the backlog does not hold, open while one of them is.
        if (!inBacklog.has(todo.id)) {
            open.set(todo.id, (open.get(todo.id) ?? false) || !todo.done);
        }
    }

    const isOpen = (id) => open.get(id) === true;
    const known = (id) => open.has(id);
    // What a task still waits for: the ids of its after that are open; one no longer open, or not found, waits for nothing.
    const blockers = (id) => (waits.get(id) ?? []).filter(isOpen);
    // The open tasks to do before this one, the first first: each after its own blockers, each once.
    const chain = (id) => {
        const order = [];
        const seen = new Set([id]);
        const visit = (one) => {
            for (const next of blockers(one).filter((blocker) => !seen.has(blocker))) {
                seen.add(next);
                visit(next);
                order.push(next);
            }
        };
        visit(id);
        return order;
    };

    return { waits, isOpen, known, blockers, chain, cycles: () => cyclesOf(waits) };
}

/** The tasks that point to each one with `see`, so that a link shows on both sides: by the id pointed to, the ids that point. */
export function seenFrom(tasks, prefix = "T")
{
    const from = new Map();

    for (const task of tasks) {
        for (const target of task.see ?? []) {
            from.set(target, [...(from.get(target) ?? []), `${prefix}-${task.id}`]);
        }
    }

    return from;
}

/** Each cycle of the waits once, as the ids around it from its smallest: T-2 → T-5 → T-2 is [T-2, T-5]. */
function cyclesOf(waits)
{
    const cycles = new Map();
    const state = new Map();
    const path = [];

    const visit = (id) => {
        state.set(id, "open");
        path.push(id);

        for (const next of waits.get(id) ?? []) {
            if (state.get(next) === "open") {
                const cycle = path.slice(path.indexOf(next));
                const start = cycle.indexOf([...cycle].sort()[0]);
                const turned = [...cycle.slice(start), ...cycle.slice(0, start)];
                cycles.set(turned.join(" "), turned);
            } else if (!state.has(next)) {
                visit(next);
            }
        }

        path.pop();
        state.set(id, "closed");
    };

    for (const id of waits.keys()) {
        if (!state.has(id)) {
            visit(id);
        }
    }

    return [...cycles.values()];
}

function suffixOf(text)
{
    const match = new RegExp(`\\s*\\((${kinds.join("|")}):\\s*([^()]*)\\)\\s*$`, "i").exec(text);
    return match ? { kind: match[1].toLowerCase(), items: match[2], index: match.index } : null;
}
