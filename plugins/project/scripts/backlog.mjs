// The project's backlog, changed only through here but for a task's text:
//   node backlog.mjs next
//   node backlog.mjs add "text" [--goal "<goal of the plan>"] [--p P2] [--effort <word>] [--to <name>] [--state todo|doing|postponed|done]
//   node backlog.mjs start|done|postpone|todo T-12 [T-13…]
//   node backlog.mjs archive T-12… | archive --done
//   node backlog.mjs set T-12 [--p P1] [--effort <word>] [--to <name>] [--goal "…"] [--text "…"] [--after "T-3, #giulia-1"] [--see "T-9, D-2"] [--in T-23] [--issue 34] [--due 2026-11-15] [--type bug] [--by Stefano]
//     [--<field> <value>]   (a field of the project's configuration, `fields:`; "" clears it; add takes them too)
//   node backlog.mjs add --issue 34 ["text"]   (a task from a GitHub issue, its title the text when none is given)
//   node backlog.mjs issue-close T-12   (closes its GitHub issue with a comment: only on the user's yes)
//   node backlog.mjs note T-12   (its note, written when missing: the path)
//   node backlog.mjs show T-12… | list [--atomic] [--state doing] [--to <name>] [--p P1] [--goal "…"] [--json] | find <words>… | goals
//   node backlog.mjs export [--format json|csv|<an extension's>] [--state todo] [--all]   (the open tasks, or all of them, on stdout)
//   node backlog.mjs import <file> [--format json|csv|<an extension's>] [--by <name>]   (new tasks, numbered here; all or none)
//   node backlog.mjs todos [--to <colleague>] [--json]   (with Crew: the colleagues' open todo lines that cite no task, each as <id>:<line>)
//   node backlog.mjs take matteo-conti:8 [--to <name>] [--text "…"] [--p P1] [--type bug] [--goal "…"] [--keep]   (a todo line that is
//     work for the project made a task, created by the colleague; the line then cites it, ticked as handed over, or open with --keep)
import { existsSync, readFileSync } from "node:fs";
import { parseCsv, toCsv } from "../lib/csv.mjs";
import { formatLine, moveTasks, nextId, taskErrors } from "../lib/backlog.mjs";
import { codeView, issueOf } from "../lib/code.mjs";
import { listOf, nestedParts, splitLinks, todoLinks } from "../lib/links.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { formatTodo, parseTodo } from "../lib/todos.mjs";
import { effortWord, stateKeys } from "../lib/words.mjs";
import { closeIssue, readCode, readIssue, readIssues } from "./code.mjs";
import { context, loadExtensions } from "./extensions.mjs";
import { assignees, isMain, loadProject, notePath, ProjectError, read, readBacklog, readDecisions, readDependencies, readGoals, readSpecs, runCli, shown, taskLinks, today, todoFiles, withBacklogLock, write, writeBacklog, writeDoc } from "./project.mjs";

// The commands that change the backlog, each alone; and the options that take no value.
const changes = ["add", "start", "done", "postpone", "todo", "archive", "set", "import", "take"];
const flags = ["json", "done", "atomic", "all", "keep"];
// The columns of the backlog as CSV, the project's own fields after them.
const csvColumns = ["id", "state", "priority", "effort", "to", "created", "goal", "type", "due", "parent", "after", "see", "by", "text", "started", "done", "archived"];

/** What the backlog's checks need: the problems of the tasks as they are, for check.mjs. */
export function backlogProblems(config, say)
{
    const { tasks, unread } = readBacklog(config);
    const prefix = config.prefixes.task;
    const problems = unread.map((one) => ({ file: one.file, line: one.line, message: say("unreadLine", { text: one.text.slice(0, 80) }) }));
    const people = assignees(config);
    const goals = readGoals(config).map((goal) => goal.name);
    const seen = new Map();

    for (const task of tasks) {
        const at = { file: task.file, line: task.line };
        const id = `${prefix}-${task.id}`;

        if (seen.has(task.id)) {
            problems.push({ ...at, message: say("dupTask", { id, other: seen.get(task.id) }) });
        }

        seen.set(task.id, task.line);
        // An archived task keeps the goal it had, even one the plan no longer holds.
        const archivedGoals = task.state === "archived" ? [...goals, task.goal] : goals;

        for (const error of taskErrors(task, { words: config.words, people, goals: archivedGoals, types: Object.keys(config.types), fields: config.fields, prefix, decisionPrefix: config.prefixes.decision, specPrefix: config.prefixes.spec, say })) {
            problems.push({ ...at, message: `${id}: ${error}` });
        }

        // A link to a task that is in neither the backlog nor the archive; a decision's the check of the references says.
        for (const cited of [...task.after, ...task.see, ...(task.parent ? [task.parent] : [])].filter((one) => one.startsWith(`${prefix}-`) && !tasks.some((other) => `${prefix}-${other.id}` === one))) {
            problems.push({ ...at, message: say("linkUnknown", { id, other: cited }) });
        }

        if (task.state === "done" && !task.done) {
            problems.push({ ...at, message: say("doneNoDate", { id, marker: config.words.doneMarker }) });
        }
    }

    for (const nested of nestedParts(tasks, prefix)) {
        const task = tasks.find((one) => `${prefix}-${one.id}` === nested.id);
        problems.push({ file: task.file, line: task.line, message: say("inNested", { id: nested.id, other: nested.parent }) });
    }

    return problems;
}

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

async function run(args)
{
    const [command, ...rest] = args;
    const { options, words } = optionsOf(rest);
    const { config, say } = loadProject();

    // Export and import read the extensions' formats first; an import's tasks are read before the lock, and added under it.
    if (command === "export") {
        return exportTasks(config, say, options);
    }

    if (command === "import") {
        options.incoming = await importedTasks(config, say, words[0], options);
    }

    // A change reads the backlog again once it holds the lock, so it never writes over a change made meanwhile.
    return changes.includes(command) ? withBacklogLock(config, () => execute(command, options, words, config, say)) : execute(command, options, words, config, say);
}

/** The formats the backlog is written in and read from: json and csv, and those of the extensions, by name. */
async function formatsOf(config, kind)
{
    const own = { json: true, csv: true };

    for (const extension of await loadExtensions(config)) {
        for (const [name, convert] of Object.entries(extension[kind] ?? {})) {
            own[name] = { convert, extension };
        }
    }

    return own;
}

/** The open tasks, or those of a state, or all of them, in a format, on stdout: each with its number, its suffixes read apart. */
async function exportTasks(config, say, options)
{
    const prefix = config.prefixes.task;
    const formats = await formatsOf(config, "exporters");
    const format = typeof options.format === "string" ? options.format : "json";
    const open = ["doing", "todo", "postponed"];
    const tasks = readBacklog(config).tasks
        .filter((task) => (typeof options.state === "string" ? task.state === options.state : options.all === true || open.includes(task.state)))
        .map(({ file, line, ...task }) => ({ ...task, id: `${prefix}-${task.id}` }));

    if (!(format in formats)) {
        throw new ProjectError(say("unknownFormat", { format, list: Object.keys(formats).join(", ") }));
    }

    const fields = Object.keys(config.fields);
    const text = format === "json" ? JSON.stringify(tasks, null, 2)
        : format === "csv" ? toCsv(tasks.map((task) => ({ ...task, ...task.fields })), [...csvColumns, ...fields]).trimEnd()
        : String(await formats[format].convert(tasks, context(config, say)));
    console.log(text);
}

/** The tasks of a file to import, as plain objects: { text, priority, effort, to, goal, type, due, parent, state, by, fields }. */
async function importedTasks(config, say, file, options)
{
    if (!file || !existsSync(file)) {
        throw new ProjectError(say("importNoFile", { file: file ?? "" }));
    }

    const formats = await formatsOf(config, "importers");
    const format = typeof options.format === "string" ? options.format : file.toLowerCase().endsWith(".csv") ? "csv" : "json";

    if (!(format in formats)) {
        throw new ProjectError(say("unknownFormat", { format, list: Object.keys(formats).join(", ") }));
    }

    const text = readFileSync(file, "utf8");
    let items;

    try {
        items = format === "json" ? JSON.parse(text) : format === "csv" ? parseCsv(text) : await formats[format].convert(text, context(config, say));
    } catch (error) {
        throw new ProjectError(say("importUnread", { file, error: String(error?.message ?? error).split("\n")[0] }));
    }

    const list = Array.isArray(items) ? items : Array.isArray(items?.tasks) ? items.tasks : null;

    if (!list || list.length === 0) {
        throw new ProjectError(say("importEmpty", { file }));
    }

    // A CSV row carries the project's fields as columns of their own.
    return list.map((item) => ({ ...item, fields: { ...Object.fromEntries(Object.keys(config.fields).filter((key) => item[key]).map((key) => [key, String(item[key])])), ...(item.fields ?? {}) } }));
}

function execute(command, options, words, config, say)
{
    const { tasks, unread } = readBacklog(config);
    const prefix = config.prefixes.task;
    const stateName = (task) => (task.state === "archived" ? config.labels.archivedMarker : task.state === "done" ? config.labels.doneMarker : config.labels.states[task.state]);
    const line = (task) => formatLine(task, config.words, prefix);
    const fail = (message) => {
        throw new ProjectError(message);
    };

    if (unread.length > 0 && changes.includes(command)) {
        fail(say("unreadFirst", { lines: unread.map((one) => `${shown(config, one.file)}:${one.line}`).join(", ") }));
    }

    if (options.state !== undefined && ![...stateKeys, "archived"].includes(options.state)) {
        fail(say("badState", { value: options.state, list: [...stateKeys, "archived"].join(", ") }));
    }

    const find = (given) => tasks.find((task) => task.id === Number(String(given).replace(new RegExp(`^${escapeRegex(prefix)}-`, "i"), ""))) ?? fail(say("notFound", { id: given }));
    // A task as it will be written, among all the others: right in itself, its links to tasks and decisions that exist, no cycle of waits.
    const checked = (task) => {
        const all = [...tasks.filter((one) => one.id !== task.id), task];
        // A goal given now must be open; a task keeps the goal it had, closed or not.
        const closed = typeof options.goal === "string" ? readGoals(config).find((goal) => goal.name === options.goal && goal.closed) : undefined;
        // An issue is done by one task only.
        const taken = task.issue ? tasks.find((one) => one.id !== task.id && one.issue === task.issue) : undefined;
        const errors = [
            ...(closed ? [say("goalIsClosed", { value: closed.name, day: closed.closed })] : []),
            ...(taken ? [say("issueTaken", { issue: task.issue, id: `${prefix}-${taken.id}` })] : []),
            ...taskErrors(task, { words: config.words, people: assignees(config), goals: readGoals(config).map((goal) => goal.name), types: Object.keys(config.types), fields: config.fields, prefix, decisionPrefix: config.prefixes.decision, specPrefix: config.prefixes.spec, say }),
            ...linkErrors(task, all, config, say),
        ];
        return errors.length > 0 ? fail(errors.join("\n")) : task;
    };
    // The suffixes of a text, `(after: …)`, `(see: …)`, `(in: …)`, `(issue: …)`, `(due: …)` and `(type: …)` at its end, with the options
    // on top: an option given replaces, "" clears.
    const linked = (given, old = {}) => {
        const split = splitLinks(given ?? old.text, config.words.fields);
        const isGiven = (kind) => options[kind] !== undefined && options[kind] !== true;
        const pick = (kind) => (isGiven(kind) ? listOf(options[kind]) : given !== undefined && split[kind].length > 0 ? split[kind] : old[kind] ?? []);
        const single = (option, field, shape = (value) => value) => (isGiven(option) ? (listOf(options[option]).map(shape)[0] ?? null) : given !== undefined && split[field] ? split[field] : (old[field] ?? null));
        return {
            text: split.text,
            after: pick("after"),
            see: pick("see"),
            parent: single("in", "parent"),
            issue: single("issue", "issue", (value) => value.replace(/^#?/, "#")),
            due: single("due", "due"),
            // A type by its key or by its name in the project's language: --type funzione is feature.
            type: single("type", "type", (value) => Object.entries(config.types).find(([, name]) => name.toLowerCase() === value.toLowerCase())?.[0] ?? value.toLowerCase()),
            // Who created it: a name as the project writes it, whatever its case.
            by: typeof options.by === "string" ? (assignees(config).find((name) => name.toLowerCase() === options.by.toLowerCase()) ?? options.by) : given !== undefined && split.by ? split.by : (old.by ?? null),
            // The project's own fields: --system 5e, "" clears.
            fields: Object.fromEntries(Object.keys(config.fields).map((key) => [key, isGiven(key) ? String(options[key]).trim() : given !== undefined && split.fields[key] ? split.fields[key] : (old.fields?.[key] ?? "")]).filter(([, value]) => value !== "")),
        };
    };
    const issueNumber = () => Number(String(options.issue).replace(/^#/, ""));
    const save = (all, said) => {
        writeBacklog(config, all);
        console.log(said);
    };

    if (command === "next") {
        console.log(`${prefix}-${nextId(tasks)}`);
    } else if (command === "add") {
        // A task made from a GitHub issue takes the issue's title, when it is given no text of its own.
        const given = words.join(" ").trim() || (typeof options.issue === "string" ? readIssue(config, issueNumber()).title.replaceAll(" · ", " - ") : fail(say("noText")));
        const state = options.state ?? "todo";
        const task = checked({
            id: nextId(tasks),
            priority: options.p ?? "P2",
            effort: options.effort ? effortWord(config.words, options.effort) : config.words.efforts.medium,
            to: options.to ?? config.people[0],
            created: today(),
            // A part takes its large task's goal, unless one is given.
            goal: options.goal ?? (typeof options.in === "string" ? tasks.find((one) => `${prefix}-${one.id}` === options.in.trim().toUpperCase())?.goal : undefined) ?? config.words.noGoal,
            // Who created it: --by, else Claude, who runs the command.
            ...linked(given, { by: config.people.includes("Claude") || assignees(config).includes("Claude") ? "Claude" : null }),
            done: state === "done" ? today() : null,
            archived: null,
            state,
        });
        save([...tasks, task], say("added", { id: `${prefix}-${task.id}`, line: line(task) }));
    } else if (["start", "done", "postpone", "todo"].includes(command)) {
        const state = { start: "doing", done: "done", postpone: "postponed", todo: "todo" }[command];
        const ids = words.map(find).map((task) => task.id);
        // A large task is in progress while one of its parts is: a part started starts it too.
        const parents = state === "doing" ? ids.map((id) => tasks.find((task) => task.id === id).parent).filter(Boolean).map(find).filter((task) => ["todo", "postponed"].includes(task.state)).map((task) => task.id) : [];
        const moved = moveTasks(moveTasks(tasks, ids, state, today()).tasks, parents, "doing", today()).tasks;
        save(moved, [...ids, ...parents].map((id) => say("moved", { id: `${prefix}-${id}`, state: config.labels.states[state] })).join("\n"));
        // A task done whose GitHub issue is still open: Claude asks whether to close it, and closes it on a yes.
        const issues = state === "done" ? readIssues(config) : [];

        for (const task of ids.map((id) => moved.find((one) => one.id === id)).filter((one) => one.issue)) {
            if (issues.find((issue) => `#${issue.number}` === task.issue)?.state === "open") {
                console.log(say("issueAskClose", { id: `${prefix}-${task.id}`, issue: task.issue }));
            }
        }
        // A large task whose parts are now all closed: done is still to say, as for any task.
        const isClosed = (task) => task.state === "done" || task.state === "archived";

        for (const parent of new Set(ids.map((id) => moved.find((task) => task.id === id).parent).filter(Boolean))) {
            if (moved.filter((task) => task.parent === parent).every(isClosed) && !isClosed(find(parent))) {
                console.log(say("partsAllDone", { id: parent }));
            }
        }
    } else if (command === "archive") {
        const chosen = options.done === true ? tasks.filter((task) => task.state === "done") : words.map(find);
        const ids = new Set(chosen.map((task) => task.id));
        save(tasks.map((task) => (ids.has(task.id) ? { ...task, state: "archived", archived: today() } : task)), say("archivedCount", { count: ids.size }));
    } else if (command === "set") {
        const task = find(words[0]);
        const changed = checked({
            ...task,
            ...(options.p ? { priority: options.p } : {}),
            ...(options.effort ? { effort: effortWord(config.words, options.effort) } : {}),
            ...(options.to ? { to: options.to } : {}),
            ...(options.goal ? { goal: options.goal } : {}),
            ...linked(typeof options.text === "string" ? options.text : undefined, task),
        });
        save(tasks.map((one) => (one.id === task.id ? changed : one)), line(changed));
    } else if (command === "issue-close") {
        const task = find(words[0]);
        const number = Number(String(task.issue ?? fail(say("noIssue", { id: `${prefix}-${task.id}` }))).slice(1));
        const commits = readCode(config).get(task.id)?.commits ?? [];
        closeIssue(config, number, say("issueComment", { id: `${prefix}-${task.id}`, project: config.name ? ` (${config.name})` : "", commits: commits.length > 0 ? say("issueCommits", { list: commits.slice(0, 10).map((commit) => commit.hash).join(", ") }) : "" }).trim());
        console.log(say("issueClosed", { issue: task.issue, id: `${prefix}-${task.id}` }));
    } else if (command === "note") {
        const task = find(words[0]);
        const path = notePath(config, task.id);

        if (!existsSync(path)) {
            writeDoc(config, path, `# ${prefix}-${task.id} · ${task.text}\n`);
        }

        console.log(shown(config, path));
    } else if (command === "show") {
        const shownTasks = words.map(find);
        const links = linksOf(tasks, config, say, stateName);
        const code = readCode(config);
        const issues = shownTasks.some((task) => task.issue) ? readIssues(config) : [];
        const issueLine = (task) => {
            const issue = issueOf(issues, task);
            return issue ? [say("issueLabel", { issue: task.issue, title: issue.title, state: say(issue.state === "open" ? "issueStateOpen" : "issueStateClosed") })] : [];
        };
        print(shownTasks, options.json, (task) => [line(task), ...[say("stateLabel", { state: stateName(task) }), ...links(task), ...issueLine(task), ...codeLines(code.get(task.id), say)].map((one) => `  ${one}`)].join("\n"));
    } else if (command === "list") {
        const shownTasks = tasks.filter((task) => (options.state ? task.state === options.state : task.state !== "archived" && task.state !== "done"))
            .filter((task) => !options.to || task.to === options.to)
            .filter((task) => !options.p || task.priority === options.p)
            .filter((task) => !options.goal || task.goal === options.goal)
            // --atomic: only the tasks done as they are, for Crew and whoever wants them; a large task is done through its parts.
            .filter((task) => options.atomic !== true || !tasks.some((other) => other.parent === `${prefix}-${task.id}`));
        // As the panel shows them: a blocked task with what it still waits for, a large task with its parts closed.
        const links = taskLinks(config, tasks);
        const marked = (task) => {
            const { blockedBy, parts, partsDone, dueInfo, stale } = links.get(task.id);
            const marks = [
                blockedBy.length > 0 ? `⛓ ${blockedBy.join(", ")}` : null,
                parts.length > 0 ? say("partsCount", { done: partsDone, total: parts.length }) : null,
                dueInfo && (dueInfo.isLate || dueInfo.isNear) ? `⏰ ${dueText(dueInfo, say)}` : null,
                stale ? `⏸ ${say("staleTip", { day: task.started })}` : null,
            ].filter(Boolean);
            return `${line(task)}${marks.map((mark) => `  ${mark}`).join("")}`;
        };
        print(shownTasks, options.json, marked, say("count", { count: shownTasks.length }));
    } else if (command === "find" && words.length > 0) {
        const wanted = words.map(plain);
        const shownTasks = tasks.filter((task) => wanted.every((word) => plain(`${task.text} ${task.goal} ${task.to}`).includes(word)));
        print(shownTasks, options.json, (task) => `${line(task)} [${stateName(task)}]`, say("count", { count: shownTasks.length }));
    } else if (command === "import") {
        // Each a new task, numbered after the others; a wrong one stops them all, so that nothing is half imported.
        const added = [];
        const typeKey = (value) => (value ? Object.entries(config.types).find(([key, name]) => key === String(value).toLowerCase() || name.toLowerCase() === String(value).toLowerCase())?.[0] ?? String(value).toLowerCase() : null);
        const creator = typeof options.by === "string" ? options.by : config.people.includes("Claude") || assignees(config).includes("Claude") ? "Claude" : null;

        for (const item of options.incoming) {
            const split = splitLinks(String(item.text ?? "").replace(/\s+/g, " ").replaceAll(" · ", " - ").trim(), config.words.fields);
            const state = stateKeys.includes(item.state) ? item.state : "todo";
            const day = /^\d{4}-\d{2}-\d{2}$/;
            const listed = (value, fallback) => (Array.isArray(value) ? value : value ? listOf(value) : fallback);
            const task = {
                id: nextId([...tasks, ...added]),
                priority: item.priority || "P2",
                effort: item.effort || config.words.efforts.medium,
                to: item.to || config.people[0],
                created: day.test(item.created ?? "") ? item.created : today(),
                goal: item.goal || config.words.noGoal,
                text: split.text,
                after: listed(item.after, split.after),
                see: listed(item.see, split.see),
                parent: item.parent || split.parent,
                issue: split.issue,
                due: item.due || split.due,
                type: typeKey(item.type) ?? split.type,
                by: item.by || creator,
                fields: { ...split.fields, ...item.fields },
                started: null,
                done: state === "done" ? (day.test(item.done ?? "") ? item.done : today()) : null,
                archived: null,
                state,
            };
            added.push(checked(task));
        }

        save([...tasks, ...added], say("imported", { count: added.length, ids: added.map((task) => `${prefix}-${task.id}`).join(", ") }));
    } else if (command === "todos") {
        const open = openTodos(config).filter((todo) => typeof options.to !== "string" || todo.name.toLowerCase() === options.to.toLowerCase());

        if (options.json === true) {
            console.log(JSON.stringify(open.map((todo) => ({ ...todo, file: shown(config, todo.file) })), null, 2));
        } else {
            open.forEach((todo) => console.log(`${todo.ref} · ${todo.priority ?? "-"} · ${todo.created ?? "-"} · ${todo.text}`));
            console.log(say("todosCount", { count: open.length }));
        }
    } else if (command === "take") {
        // A colleague's todo line that is work for the project made a task of the backlog, created by the colleague. The line then cites
        // it where Crew puts its id: ticked, handed over; open with --keep, when the colleague keeps a part of their own (a retest).
        const todo = openTodos(config).find((one) => one.ref === words[0]) ?? fail(say("todoNotFound", { ref: words[0] ?? "" }));
        const task = checked({
            id: nextId(tasks),
            priority: options.p ?? todo.priority ?? "P2",
            effort: options.effort ? effortWord(config.words, options.effort) : config.words.efforts.medium,
            to: options.to ?? config.people[0],
            // Raised the day the line was written, not the day it moved.
            created: todo.created ?? today(),
            goal: options.goal ?? config.words.noGoal,
            ...linked(typeof options.text === "string" ? options.text : todo.text.replaceAll(" · ", " - "), { by: todo.name }),
            done: null,
            archived: null,
            state: "todo",
        });
        const id = `${prefix}-${task.id}`;
        // The line's own id, when it had one, becomes the task's in every wait that named it, in the todos and in the backlog.
        const renamed = (text) => (todo.id ? text.replace(new RegExp(`${escapeRegex(todo.id)}(?![\\w-])`, "g"), id) : text);

        for (const { file } of todoFiles(config)) {
            const old = read(file);
            const newline = old.includes("\r\n") ? "\r\n" : "\n";
            const lines = old.split(/\r?\n/).map((text, index) => {
                const parsed = file === todo.file && index === todo.line - 1 ? parseTodo(text) : null;
                return parsed ? formatTodo({ ...parsed, done: options.keep !== true, text: `${id} · ${renamed(todo.text)}` }) : renamed(text);
            });

            if (lines.join(newline) !== old) {
                write(file, lines.join(newline));
            }
        }

        const waits = (task) => ({ ...task, after: task.after.map((one) => (one === todo.id ? id : one)) });
        save([...tasks.map(waits), task], say("todoTaken", { id, ref: todo.ref, name: todo.name, line: line(task) }));
    } else if (command === "goals") {
        for (const goal of [...new Set(tasks.map((task) => task.goal))]) {
            const own = tasks.filter((task) => task.goal === goal);
            const count = (state) => own.filter((task) => task.state === state).length;
            console.log(say("goalLine", { goal, doing: count("doing"), todo: count("todo"), postponed: count("postponed"), done: own.filter((task) => task.done).length }));
        }
    } else {
        fail(say("backlogUsage"));
    }
}

/** The colleagues' open todo lines that cite no task of the backlog, each with where it is, `matteo-conti:8`, and its own id if any; a
 * line under another is a detail of it, not a line of its own. */
function openTodos(config)
{
    const prefix = config.prefixes.task;
    return todoFiles(config).flatMap(({ id: colleague, name, file }) => read(file).split(/\r?\n/).flatMap((text, index) => {
        const todo = parseTodo(text);
        const own = todo ? todoLinks(todo.text, prefix).id : null;

        if (!todo || todo.done || todo.indent || own?.startsWith(`${prefix}-`)) {
            return [];
        }

        return [{ ref: `${colleague}:${index + 1}`, colleague, name, file, line: index + 1, priority: todo.priority, created: todo.created, id: own, text: own ? todo.text.slice(own.length + 3) : todo.text }];
    }));
}

/** What a task's links would break, among all the tasks: a task or a decision that does not exist, a wait that closes a cycle. */
function linkErrors(task, all, config, say)
{
    const prefix = config.prefixes.task;
    const id = `${prefix}-${task.id}`;
    const tasks = new Set(all.map((one) => `${prefix}-${one.id}`));
    const decisions = new Set(readDecisions(config).decided.map((row) => `${config.prefixes.decision}-${row.number}`));
    const specs = new Set(readSpecs(config).specs.map((spec) => `${config.prefixes.spec}-${spec.number}`));
    const missing = [...task.after, ...task.see, ...(task.parent ? [task.parent] : [])].filter((one) => (one.startsWith(`${prefix}-`) && !tasks.has(one))
        || (one.startsWith(`${config.prefixes.decision}-`) && !decisions.has(one)) || (one.startsWith(`${config.prefixes.spec}-`) && !specs.has(one)));
    const cycles = readDependencies(config, all).cycles().filter((cycle) => cycle.includes(id));
    // Parts one level deep: this task a part of a part, or a part of a large task whose parts would then hold parts.
    const nested = nestedParts(all, prefix).filter((one) => one.id === id || one.parent === id);
    return [
        ...missing.map((other) => say("linkUnknown", { id, other })),
        ...cycles.map((cycle) => say("cycle", { ids: [...cycle, cycle[0]].join(" → ") })),
        ...nested.map((one) => say("inNested", { id: one.id, other: one.parent })),
    ];
}

/** The lines `show` adds under a task: what it waits for and its state, what waits for it, the chain to do first, its links both
 * ways, its note. */
function linksOf(tasks, config, say, stateName)
{
    const prefix = config.prefixes.task;
    const graph = readDependencies(config, tasks);
    const links = taskLinks(config, tasks);
    const byId = new Map(tasks.map((task) => [`${prefix}-${task.id}`, task]));
    const named = (one) => (byId.has(one) ? `${one} (${stateName(byId.get(one))})` : graph.known(one) ? `${one} (${say(graph.isOpen(one) ? "todoOpen" : "todoClosed")})` : `${one} (?)`);
    // The specs a task does, each with its text: what the work must satisfy.
    const specTexts = new Map(readSpecs(config).specs.map((spec) => [`${config.prefixes.spec}-${spec.number}`, spec.text]));

    return (task) => {
        const { after, chain, waitedBy, see, seenFrom, note, parent, parts, partsDone, nextPart, decisions, dueInfo, stale, specs } = links.get(task.id);
        return [
            ...specs.map((spec) => say("specOf", { id: spec, text: specTexts.get(spec) ?? "?" })),
            task.type ? say("typeLabel", { name: config.types[task.type] ?? task.type }) : null,
            ...Object.entries(task.fields ?? {}).map(([key, value]) => `${config.fields[key]?.name ?? key}: ${value}`),
            task.due ? `${say("dueLabel", { day: task.due })}${dueInfo && (dueInfo.isLate || dueInfo.isNear) ? ` (${dueText(dueInfo, say)})` : ""}` : null,
            task.started && task.state === "doing" ? say(stale ? "staleTip" : "startedLabel", { day: task.started }) : null,
            decisions.length > 0 ? say("decisionsOf", { list: decisions.join(", ") }) : null,
            parent ? say("partOf", { id: named(parent) }) : null,
            parts.length > 0 ? say("partsLabel", { done: partsDone, total: parts.length, list: parts.map(named).join(", ") }) : null,
            nextPart ? say("nextPart", { id: nextPart }) : null,
            after.length > 0 ? say("waitsFor", { list: after.map(named).join(", ") }) : null,
            chain.length > 0 ? say("chainFirst", { list: [...chain, `${prefix}-${task.id}`].join(" → ") }) : null,
            waitedBy.length > 0 ? say("waitedBy", { list: waitedBy.join(", ") }) : null,
            see.length > 0 ? say("seeLabel", { list: see.join(", ") }) : null,
            seenFrom.length > 0 ? say("seenFrom", { list: seenFrom.join(", ") }) : null,
            note ? say("noteLabel", { path: note }) : null,
        ].filter(Boolean);
    };
}

/** A due day said from today: late by some days, today, or in some days. */
export function dueText(dueInfo, say)
{
    return dueInfo.isLate ? say("dueLate", { days: -dueInfo.days }) : dueInfo.days === 0 ? say("dueToday") : say("dueIn", { days: dueInfo.days });
}

/** The lines `show` adds for a task's code: how many commits cite it and the latest, each pull request that cites it and its state. */
function codeLines(cited, say)
{
    const { commits, commitCount, pulls } = codeView(cited, 1);
    const state = (pull) => (pull.merged ? say("pullMerged", { day: pull.merged }) : say(pull.state === "open" ? "pullOpen" : "pullClosed"));
    return [
        commitCount > 0 ? say("codeCommits", { count: commitCount, hash: commits[0].hash, day: commits[0].day, subject: commits[0].subject }) : null,
        ...pulls.map((pull) => say("codePull", { number: pull.number, state: state(pull), title: pull.title })),
    ].filter(Boolean);
}

function print(tasks, json, line, footer)
{
    if (json === true) {
        console.log(JSON.stringify(tasks.map(({ file, line: at, ...task }) => task), null, 2));
        return;
    }

    tasks.forEach((task) => console.log(line(task)));

    if (footer) {
        console.log(footer);
    }
}

/** The options and the words of a command line: --json and --done take no value, the others the word after them. */
function optionsOf(args)
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];

        if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const value = args[index + 1];
            options[name] = flags.includes(name) || value === undefined || value.startsWith("--") ? true : (index++, value);
        } else {
            words.push(arg);
        }
    }

    return { options, words };
}

