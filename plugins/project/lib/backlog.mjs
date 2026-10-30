// The backlog's lines: `- T-12 · P2 · medium · Matteo · 2026-10-29 · <goal> · text · done 2026-10-30 · archived 2026-10-31`, one task a
// line under the heading of its state. Pure: the text in, the text out, in the project's words.
import { badLinks, joinLinks, splitLinks } from "./links.mjs";
import { escapeRegex } from "./text.mjs";
import { priorityKeys, stateKeys } from "./words.mjs";

const separator = " · ";

/** A task line taken apart, with the state its section gives it; null for any other line. */
export function parseLine(line, state, words, prefix = "T")
{
    const pattern = new RegExp(`^- ${escapeRegex(prefix)}-(\\d+) · (P[1-3]) · ([^·]+?) · ([^·]+?) · (\\d{4}-\\d{2}-\\d{2}) · ([^·]+?) · (.*)$`);
    const match = pattern.exec(line.trim());

    if (!match) {
        return null;
    }

    const [, id, priority, effort, to, created, goal, rest] = match;
    const marks = new RegExp(`^(.*?)(?: · ${escapeRegex(words.doneMarker)} (\\d{4}-\\d{2}-\\d{2}))?(?: · ${escapeRegex(words.archivedMarker)} (\\d{4}-\\d{2}-\\d{2}))?$`);
    const [, whole, done, archived] = marks.exec(rest);
    const { text, after, see, parent, issue } = splitLinks(whole);
    return { id: Number(id), priority, effort: effort.trim(), to: to.trim(), created, goal: goal.trim(), text, after, see, parent, issue, done: done ?? null, archived: archived ?? null, state };
}

/** The task as a line again, its links at the end of its text. */
export function formatLine(task, words, prefix = "T")
{
    const done = task.done ? `${separator}${words.doneMarker} ${task.done}` : "";
    const archived = task.archived ? `${separator}${words.archivedMarker} ${task.archived}` : "";
    const text = joinLinks(task.text, task.after, task.see, task.parent, task.issue);
    return `- ${prefix}-${task.id}${separator}${[task.priority, task.effort, task.to, task.created, task.goal, text].join(separator)}${done}${archived}`;
}

/** The tasks of a backlog's text, each with its line and the state of its heading, and the lines that do not read as a task. What comes
 * before the first section (or the archive's first task) is the header, kept as written; past it, any other line would be lost when
 * the file is written again, so it does not read: a note, a comment, a heading of no state. */
export function parseBacklog(text, words, prefix = "T", isArchive = false)
{
    const tasks = [];
    const unread = [];
    const lines = (text ?? "").split(/\r?\n/);
    const bodyStart = lines.findIndex((line) => new RegExp(`^(## |- ${escapeRegex(prefix)}-)`).test(line));
    let state = isArchive ? "archived" : null;

    lines.forEach((line, index) => {
        if (bodyStart < 0 || index < bodyStart || line.trim() === "") {
            return;
        }

        const heading = /^## (.+)$/.exec(line);

        if (heading && !isArchive) {
            state = stateKeys.find((key) => words.states[key] === heading[1].trim()) ?? null;

            if (state === null) {
                unread.push({ line: index + 1, text: line });
            }

            return;
        }

        const task = parseLine(line, state, words, prefix);

        if (task === null || state === null) {
            unread.push({ line: index + 1, text: line });
        } else {
            tasks.push({ ...task, line: index + 1 });
        }
    });

    return { tasks, unread };
}

/** The backlog's text: what came before the first section kept, then each state's heading with its tasks by number. */
export function renderBacklog(tasks, previous, words, prefix = "T")
{
    const byId = (first, second) => first.id - second.id;
    const sections = stateKeys.map((key) => {
        const lines = tasks.filter((task) => task.state === key).sort(byId).map((task) => formatLine(task, words, prefix));
        return [`## ${words.states[key]}`, ...(lines.length > 0 ? ["", ...lines] : [])].join("\n");
    });
    return `${headerOf(previous, prefix)}${sections.join("\n\n")}\n`;
}

/** The archive's text: what came before the first task kept, then the archived tasks by number. */
export function renderArchive(tasks, previous, words, prefix = "T")
{
    const lines = tasks.filter((task) => task.state === "archived").sort((first, second) => first.id - second.id).map((task) => formatLine(task, words, prefix));
    return `${headerOf(previous, prefix)}${lines.join("\n")}\n`;
}

/** The tasks with those named moved to a state, the day of today on those done; the ids not found, apart. */
export function moveTasks(tasks, ids, state, today)
{
    const wanted = new Set(ids.map(Number));
    const missing = [...wanted].filter((id) => !tasks.some((task) => task.id === id));
    const moved = tasks.map((task) => (wanted.has(task.id) ? { ...task, state, done: state === "done" ? (task.done ?? today) : null, archived: null } : task));
    return { tasks: moved, missing };
}

/** The ids of the tasks a text cites, `T-12`, each once, in order. */
export function citedTasks(text, prefix = "T")
{
    return [...new Set([...String(text).matchAll(new RegExp(`\\b${escapeRegex(prefix)}-(\\d+)\\b`, "g"))].map((match) => Number(match[1])))];
}

/** The next free number: past every task of the backlog and the archive. */
export function nextId(tasks)
{
    return Math.max(0, ...tasks.map((task) => task.id)) + 1;
}

/** What makes a task wrong before it is written, as messages; empty when it is right. */
export function taskErrors(task, { words, people, goals, prefix = "T", decisionPrefix = "D", say })
{
    const errors = [];
    const efforts = Object.values(words.efforts);

    if (!priorityKeys.includes(task.priority)) {
        errors.push(say("badPriority", { value: task.priority }));
    }

    if (!efforts.includes(task.effort)) {
        errors.push(say("badEffort", { value: task.effort, list: efforts.join(", ") }));
    }

    if (!people.includes(task.to)) {
        errors.push(say("badAssignee", { value: task.to, list: people.join(", ") }));
    }

    if (task.goal !== words.noGoal && !goals.includes(task.goal)) {
        errors.push(say("badGoal", { value: task.goal, list: goals.join("; "), none: words.noGoal }));
    }

    if (!stateKeys.includes(task.state) && task.state !== "archived") {
        errors.push(say("badState", { value: task.state, list: stateKeys.join(", ") }));
    }

    if (/ · /.test(task.text) || /\n/.test(task.text) || task.text.trim() === "") {
        errors.push(say("badText", { prefix }));
    }

    const lists = { after: task.after ?? [], see: task.see ?? [], in: task.parent ? [task.parent] : [], issue: task.issue ? [task.issue] : [] };
    const messages = { after: "badAfter", see: "badSee", in: "badIn", issue: "badIssue" };

    for (const kind of ["after", "see", "in", "issue"]) {
        const bad = badLinks(kind, lists[kind], { task: prefix, decision: decisionPrefix });

        if (bad.length > 0) {
            errors.push(say(messages[kind], { list: bad.join(", "), task: `${prefix}-12`, decision: `${decisionPrefix}-2` }));
        }
    }

    if ((task.after ?? []).includes(`${prefix}-${task.id}`)) {
        errors.push(say("afterItself", { id: `${prefix}-${task.id}` }));
    }

    if (task.parent === `${prefix}-${task.id}`) {
        errors.push(say("inItself", { id: `${prefix}-${task.id}` }));
    }

    return errors;
}

/** The effort's key (low … max, none) from the word the line uses; undefined when the word is not the project's. */
export function effortKey(word, words)
{
    return Object.entries(words.efforts).find(([, value]) => value === word)?.[0];
}

function headerOf(previous, prefix)
{
    const text = previous ?? "";
    const first = text.search(new RegExp(`^(## |- ${escapeRegex(prefix)}-)`, "m"));
    return first > 0 ? text.slice(0, first) : first === 0 ? "" : text.trim() === "" ? "" : `${text.trimEnd()}\n\n`;
}
