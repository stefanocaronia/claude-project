// The backlog's lines: `- T-12 · P2 · medium · Matteo · 2026-10-29 · <goal> · text · started 2026-10-29 · done 2026-10-30`, one task a
// line under the heading of its state. Pure: the text in, the text out, in the project's words.
import { badLinks, joinLinks, splitLinks } from "./links.mjs";
import { escapeRegex } from "./text.mjs";
import { effortWord, priorityKeys, readablePattern, stateKeys, stateOfHeading } from "./words.mjs";

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
    const day = "(\\d{4}-\\d{2}-\\d{2})";
    const marks = new RegExp(`^(.*?)(?: · (?:${readablePattern(words, "startedMarker")}) ${day})?(?: · (?:${readablePattern(words, "doneMarker")}) ${day})?(?: · (?:${readablePattern(words, "archivedMarker")}) ${day})?$`);
    const [, whole, started, done, archived] = marks.exec(rest);
    return { id: Number(id), priority, effort: effortWord(words, effort.trim()), to: to.trim(), created, goal: goal.trim(), ...splitLinks(whole, words.fields ?? []), started: started ?? null, done: done ?? null, archived: archived ?? null, state };
}

/** The task as a line again, its links at the end of its text, then the days it started, was done and archived. */
export function formatLine(task, words, prefix = "T")
{
    const mark = (marker, day) => (day ? `${separator}${marker} ${day}` : "");
    const text = joinLinks(task.text, task, words.fields ?? []);
    return `- ${prefix}-${task.id}${separator}${[task.priority, task.effort, task.to, task.created, task.goal, text].join(separator)}${mark(words.startedMarker, task.started)}${mark(words.doneMarker, task.done)}${mark(words.archivedMarker, task.archived)}`;
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
            state = stateOfHeading(words, heading[1].trim());

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
    // The day it started: set when it goes into progress, kept while it is and once it is done, gone when it waits again.
    const started = (task) => (state === "doing" ? (task.state === "doing" && task.started ? task.started : today) : state === "done" ? task.started ?? null : null);
    const moved = tasks.map((task) => (wanted.has(task.id) ? { ...task, state, started: started(task), done: state === "done" ? (task.done ?? today) : null, archived: null } : task));
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
export function taskErrors(task, { words, people, goals, types = Object.keys(words.types ?? {}), fields = {}, prefix = "T", decisionPrefix = "D", specPrefix = "S", say })
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

    const one = (value) => (value ? [value] : []);
    const lists = { after: task.after ?? [], see: task.see ?? [], in: one(task.parent), issue: one(task.issue), due: one(task.due), type: one(task.type), by: one(task.by) };
    const messages = { after: "badAfter", see: "badSee", in: "badIn", issue: "badIssue", due: "badDue", type: "badType", by: "badBy" };

    for (const kind of Object.keys(lists)) {
        const bad = badLinks(kind, lists[kind], { task: prefix, decision: decisionPrefix, spec: specPrefix });

        if (bad.length > 0) {
            errors.push(say(messages[kind], { list: bad.join(", "), task: `${prefix}-12`, decision: `${decisionPrefix}-2`, spec: `${specPrefix}-4` }));
        }
    }

    if ((task.after ?? []).includes(`${prefix}-${task.id}`)) {
        errors.push(say("afterItself", { id: `${prefix}-${task.id}` }));
    }

    if (task.parent === `${prefix}-${task.id}`) {
        errors.push(say("inItself", { id: `${prefix}-${task.id}` }));
    }

    if (task.by && !people.includes(task.by)) {
        errors.push(say("unknownCreator", { value: task.by, list: people.join(", ") }));
    }

    if (task.type && !types.includes(task.type)) {
        errors.push(say("unknownType", { value: task.type, list: types.join(", ") }));
    }

    // The project's own fields: one value of a line, among those the configuration allows when it lists them.
    for (const [key, value] of Object.entries(task.fields ?? {})) {
        const allowed = fields[key]?.values;

        if (/[()·\n]/.test(value)) {
            errors.push(say("badField", { name: fields[key]?.name ?? key, value }));
        } else if (allowed && !allowed.includes(value)) {
            errors.push(say("unknownFieldValue", { name: fields[key]?.name ?? key, value, list: allowed.join(", ") }));
        }
    }

    return errors;
}

/** The effort's key (low … max, none) from the word the line uses; undefined when the word is not the project's. */
export function effortKey(word, words)
{
    return Object.entries(words.efforts).find(([, value]) => value === effortWord(words, word))?.[0];
}

function headerOf(previous, prefix)
{
    const text = previous ?? "";
    const first = text.search(new RegExp(`^(## |- ${escapeRegex(prefix)}-)`, "m"));
    return first > 0 ? text.slice(0, first) : first === 0 ? "" : text.trim() === "" ? "" : `${text.trimEnd()}\n\n`;
}
