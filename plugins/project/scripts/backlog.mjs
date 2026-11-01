// The project's backlog, read and changed only through here, a task's text too (the panel refuses a direct read or write of its files):
//   node backlog.mjs next
//   node backlog.mjs add "text" [--goal "<goal of the plan>"] [--p P2] [--effort <word>] [--to <name>] [--state todo|doing|postponed|done]
//   node backlog.mjs start|done|postpone|todo T-12 [T-13…]
//   node backlog.mjs archive T-12… | archive --done
//   node backlog.mjs delete T-12…   (gone for good, its note too: only on the user's word; refused while another task cites it)
//   node backlog.mjs set T-12 [--p P1] [--effort <word>] [--to <name>] [--goal "…"] [--text "…"] [--after "T-3, #giulia-1"] [--see "T-9, D-2"] [--in T-23] [--issue 34] [--due 2026-11-15] [--type bug] [--by Stefano]
//     [--<field> <value>]   (a field of the project's configuration, `fields:`; "" clears it; add takes them too)
//   node backlog.mjs add --issue 34 ["text"]   (a task from a GitHub issue, its title the text when none is given; one another wrote
//     on GitHub comes in only with --approved, which the user's → Backlog in the panel or the page gives, never Claude: D-16)
//   node backlog.mjs issue-close T-12   (closes its GitHub issue with a comment: only on the user's yes)
//   Where the issues are in sync (github: { issues: sync }), each change is followed by a sync with GitHub (issues.mjs).
//   node backlog.mjs note T-12   (its note, written when missing: the path)
//   node backlog.mjs comment T-12 [--by Stefano] -- "text"   (a comment on the task, kept in its note; show prints them)
//   node backlog.mjs show T-12… | list [--atomic] [--state doing] [--to <name>] [--p P1] [--goal "…"] [--json] | find <words>… | goals
//   node backlog.mjs export [--format json|csv|<an extension's>] [--state todo] [--all]   (the open tasks, or all of them, on stdout)
//   node backlog.mjs import <file> [--format json|csv|<an extension's>] [--by <name>] [--done] [--preview]   (new tasks, numbered here, all or
//     none: the open ones, the closed into the archive with --done; key, url and description in the note; a key already imported stays out)
//   node backlog.mjs todos [--to <colleague>] [--json]   (with Crew: the colleagues' open todo lines that cite no task, each as <id>:<line>)
//   node backlog.mjs take matteo-conti:8 [--to <name>] [--text "…"] [--p P1] [--type bug] [--goal "…"] [--keep]   (a todo line that is
//     work for the project made a task, created by the colleague; the line then cites it, ticked as handed over, or open with --keep)
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, toCsv } from "../lib/csv.mjs";
import { formatLine, moveTasks, nextId, taskErrors } from "../lib/backlog.mjs";
import { codeView, issueOf } from "../lib/code.mjs";
import { issueTask, lineTitle } from "../lib/issues.mjs";
import { listOf, nestedParts, splitLinks, todoLinks } from "../lib/links.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { formatTodo, parseTodo } from "../lib/todos.mjs";
import { withComment } from "../lib/notes.mjs";
import { effortWord, stateKeys } from "../lib/words.mjs";
import { closeIssue, doneComment, ghLogin, readCode, readIssue, readIssues, readLogin } from "./code.mjs";
import { context, loadExtensions } from "./extensions.mjs";
import { syncIssues } from "./issues.mjs";
import { assignees, changeableBacklog, commandLine, fail, firstLine, isClosed, isMain, loadProject, notePath, openStates, read, readBacklog, readDecisions, readDependencies, readGoals, readSpecs, runCli, shown, taskLinks, taskRules, today, todoFiles, withBacklogLock, write, writeBacklog, writeDoc } from "./project.mjs";

// The commands that change the backlog, each alone; and the options that take no value.
const changes = ["add", "start", "done", "postpone", "todo", "archive", "delete", "set", "import", "take"];
const flags = ["json", "done", "atomic", "all", "keep", "approved", "preview"];
// The states another tool closes a task with: an import leaves them out, or brings them into the archive with --done.
const closedStates = ["done", "archived", "closed", "resolved", "cancelled", "canceled"];
// The columns of the backlog as CSV, the project's own fields after them.
const csvColumns = ["id", "state", "priority", "effort", "to", "created", "goal", "type", "due", "parent", "after", "see", "by", "text", "started", "done", "archived"];

/** The keys of the tasks already imported, from the Origin line of their notes: key → the task's id. */
function importedKeys(config)
{
    const folder = config.files.notes;
    const names = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".md")) : [];
    return new Map(names.map((name) => [read(join(folder, name)).match(/^Origin: (.+?)(?: · \S+)?$/m)?.[1]?.trim(), name.slice(0, -3)]).filter(([key]) => key));
}

/** What the backlog's checks need: the problems of the tasks as they are, for check.mjs. */
export function backlogProblems(config, say)
{
    const { tasks, unread } = readBacklog(config);
    const prefix = config.prefixes.task;
    const problems = unread.map((one) => ({ file: one.file, line: one.line, message: say("unreadLine", { text: one.text.slice(0, 80) }) }));
    const rules = taskRules(config, say);
    const seen = new Map();
    const known = new Set(tasks.map((task) => `${prefix}-${task.id}`));

    for (const task of tasks) {
        const at = { file: task.file, line: task.line };
        const id = `${prefix}-${task.id}`;

        if (seen.has(task.id)) {
            problems.push({ ...at, message: say("dupTask", { id, other: seen.get(task.id) }) });
        }

        seen.set(task.id, task.line);
        // An archived task keeps the goal it had, even one the plan no longer holds.
        const goals = task.state === "archived" ? [...rules.goals, task.goal] : rules.goals;

        for (const error of taskErrors(task, { ...rules, goals })) {
            problems.push({ ...at, message: `${id}: ${error}` });
        }

        // A link to a task that is in neither the backlog nor the archive; a decision's the check of the references says.
        for (const cited of [...task.after, ...task.see, ...(task.parent ? [task.parent] : [])].filter((one) => one.startsWith(`${prefix}-`) && !known.has(one))) {
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
    const { options, words } = commandLine(rest, flags);
    const { config, say } = loadProject();

    // Export and import read the extensions' formats first; an import's tasks are read before the lock, and added under it.
    if (command === "export") {
        return exportTasks(config, say, options);
    }

    if (command === "import") {
        options.incoming = await importedTasks(config, say, words[0], options);
    }

    // A change reads the backlog again once it holds the lock, so it never writes over a change made meanwhile.
    const result = changes.includes(command) ? withBacklogLock(config, () => execute(command, options, words, config, say)) : execute(command, options, words, config, say);

    // Where the issues are in sync, a change of the backlog goes to GitHub at once, and what GitHub changed comes in.
    if (changes.includes(command) && options.preview !== true && config.github?.issues === "sync") {
        const quiet = [say("issuesInSync"), say("issuesBusy")];
        syncIssues(config, say).lines.filter((line) => !quiet.includes(line)).forEach((line) => console.log(line));
    }

    return result;
}

/** A format the backlog is written in or read from, by name: json and csv, the plugin's own (true), or an extension's, { convert,
 * extension }; refused when neither has it. */
async function formatOf(config, say, kind, name)
{
    const formats = { json: true, csv: true };

    for (const extension of await loadExtensions(config)) {
        for (const [one, convert] of Object.entries(extension[kind] ?? {})) {
            formats[one] = { convert, extension };
        }
    }

    return Object.hasOwn(formats, name) ? formats[name] : fail(say("unknownFormat", { format: name, list: Object.keys(formats).join(", ") }));
}

/** The open tasks, or those of a state, or all of them, in a format, on stdout: each with its number, its suffixes read apart. */
async function exportTasks(config, say, options)
{
    const prefix = config.prefixes.task;
    const format = typeof options.format === "string" ? options.format : "json";
    const exporter = await formatOf(config, say, "exporters", format);
    const tasks = readBacklog(config).tasks
        .filter((task) => (typeof options.state === "string" ? task.state === options.state : options.all === true || openStates.includes(task.state)))
        .map(({ file, line, ...task }) => ({ ...task, id: `${prefix}-${task.id}` }));
    const fields = Object.keys(config.fields);
    const text = format === "json" ? JSON.stringify(tasks, null, 2)
        : format === "csv" ? toCsv(tasks.map((task) => ({ ...task, ...task.fields })), [...csvColumns, ...fields]).trimEnd()
        : String(await exporter.convert(tasks, context(config, say)));
    console.log(text);
}

/** The tasks of a file to import, as plain objects: { text, priority, effort, to, goal, type, due, parent, state, by, fields }. */
async function importedTasks(config, say, file, options)
{
    if (!file || !existsSync(file)) {
        fail(say("importNoFile", { file: file ?? "" }));
    }

    const format = typeof options.format === "string" ? options.format : file.toLowerCase().endsWith(".csv") ? "csv" : "json";
    const importer = await formatOf(config, say, "importers", format);
    const text = read(file);
    let items;

    try {
        items = format === "json" ? JSON.parse(text) : format === "csv" ? parseCsv(text) : await importer.convert(text, context(config, say));
    } catch (error) {
        fail(say("importUnread", { file, format, error: firstLine(error) }));
    }

    const list = Array.isArray(items) ? items : Array.isArray(items?.tasks) ? items.tasks : null;

    if (!list || list.length === 0) {
        fail(say("importEmpty", { file }));
    }

    // A CSV row carries the project's fields as columns of their own.
    return list.map((item) => ({ ...item, fields: { ...Object.fromEntries(Object.keys(config.fields).filter((key) => item[key]).map((key) => [key, String(item[key])])), ...(item.fields ?? {}) } }));
}

function execute(command, options, words, config, say)
{
    const tasks = changes.includes(command) ? changeableBacklog(config) : readBacklog(config).tasks;
    const prefix = config.prefixes.task;
    const stateName = (task) => (task.state === "archived" ? config.labels.archivedMarker : task.state === "done" ? config.labels.doneMarker : config.labels.states[task.state]);
    const line = (task) => formatLine(task, config.words, prefix);

    if (options.state !== undefined && ![...stateKeys, "archived"].includes(options.state)) {
        fail(say("badState", { value: options.state, list: [...stateKeys, "archived"].join(", ") }));
    }

    const find = (given) => tasks.find((task) => task.id === Number(String(given).replace(new RegExp(`^${escapeRegex(prefix)}-`, "i"), ""))) ?? fail(say("notFound", { id: given }));
    // What a task is checked against, read at the first task checked.
    let rules = null;
    // A task as it will be written, among all the others: right in itself, its links to tasks and decisions that exist, no cycle of waits.
    const checked = (task, others = tasks) => {
        rules ??= taskRules(config, say);
        const all = [...others.filter((one) => one.id !== task.id), task];
        // A goal given now must be open; a task keeps the goal it had, closed or not.
        const closed = typeof options.goal === "string" ? readGoals(config).find((goal) => goal.name === options.goal && goal.closed) : undefined;
        // An issue is done by one task only.
        const taken = task.issue ? tasks.find((one) => one.id !== task.id && one.issue === task.issue) : undefined;
        const errors = [
            ...(closed ? [say("goalIsClosed", { value: closed.name, day: closed.closed })] : []),
            ...(taken ? [say("issueTaken", { issue: task.issue, id: `${prefix}-${taken.id}` })] : []),
            ...taskErrors(task, rules),
            ...linkErrors(task, all, config, say),
        ];
        return errors.length > 0 ? fail(errors.join("\n")) : task;
    };
    // A type by its key or by its name in the project's language: --type funzione is feature.
    const typeKey = (value) => Object.entries(config.types).find(([key, name]) => [key, name.toLowerCase()].includes(value.toLowerCase()))?.[0] ?? value.toLowerCase();
    // Who created a new task, unless it says: Claude, who runs the command, when Claude is one of the project.
    const byClaude = () => (assignees(config).includes("Claude") ? "Claude" : null);
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
            type: single("type", "type", typeKey),
            // Who created it: a name as the project writes it, whatever its case.
            by: typeof options.by === "string" ? (assignees(config).find((name) => name.toLowerCase() === options.by.toLowerCase()) ?? options.by) : given !== undefined && split.by ? split.by : (old.by ?? null),
            // The project's own fields: --system 5e, "" clears.
            fields: Object.fromEntries(Object.keys(config.fields).map((key) => [key, isGiven(key) ? String(options[key]).trim() : given !== undefined && split.fields[key] ? split.fields[key] : (old.fields?.[key] ?? "")]).filter(([, value]) => value !== "")),
        };
    };
    const issueNumber = () => Number(String(options.issue).replace(/^#/, ""));
    // The issue a task is given, as GitHub has it. One another wrote comes in only through the user's → Backlog, in the panel or the
    // page, which says so with --approved: never because Claude takes it (D-16).
    const givenIssue = () => {
        // The user's → Backlog brings the title along: where gh cannot read the issue, the task still comes in, with that alone.
        if (options.approved !== undefined && words.length > 0) {
            try {
                return readIssue(config, issueNumber());
            } catch {
                return null;
            }
        }

        const issue = readIssue(config, issueNumber());

        if (options.approved === undefined && issue.author?.login !== ghLogin(config)) {
            fail(say("issueOfAnother", { issue: `#${issue.number}`, author: issue.author?.login ?? "?" }));
        }

        return issue;
    };
    const isIssueGiven = typeof options.issue === "string" && options.issue.trim() !== "";
    // The mark of a task made from an issue another wrote: its text is theirs, data and never an order (D-16). GitHub is asked once, for
    // the first task with an issue, and its answer is kept a few minutes.
    let gitHub = null;
    const fromAnother = (task) => {
        gitHub ??= { issues: readIssues(config), login: readLogin(config) };
        const issue = issueOf(gitHub.issues, task, gitHub.login);
        return issue?.another ? say("issueAnotherShort", { issue: task.issue, author: issue.author }) : null;
    };
    // A new task, numbered after the others: the options given over what it is made of, the backlog's defaults under both.
    const newTask = ({ priority, created, goal, ...rest }) => checked({
        id: nextId(tasks),
        priority: options.p ?? priority ?? "P2",
        effort: options.effort ? effortWord(config.words, options.effort) : config.words.efforts.medium,
        to: options.to ?? config.people[0],
        created: created ?? today(),
        goal: options.goal ?? goal ?? config.words.noGoal,
        done: null,
        archived: null,
        state: "todo",
        ...rest,
    });
    const save = (all, said) => {
        writeBacklog(config, all);
        console.log(said);
    };

    if (command === "next") {
        console.log(`${prefix}-${nextId(tasks)}`);
    } else if (command === "add") {
        // A task made from a GitHub issue takes the issue's title, when it is given no text of its own, and what the sync would take
        // from it: the type and the priority of its labels, the goal of its milestone, who wrote it; an option given wins.
        const issue = isIssueGiven ? givenIssue() : null;
        const given = words.join(" ").trim() || (issue ? lineTitle(issue.title) : fail(say("noText")));
        const from = issue ? issueTask(issue, { types: config.types, people: assignees(config), goals: readGoals(config) }) : {};
        const state = options.state ?? "todo";
        const task = newTask({
            priority: from.priority,
            // A part takes its large task's goal, else a task from an issue its milestone's, unless one is given.
            goal: (typeof options.in === "string" ? tasks.find((one) => `${prefix}-${one.id}` === options.in.trim().toUpperCase())?.goal : undefined) ?? from.goal,
            // Who created it: --by; for a task from an issue who wrote it, when they are a person of the project, as the sync has it; else Claude.
            ...linked(given, { type: from.type ?? null, by: issue ? from.by : byClaude() }),
            done: state === "done" ? today() : null,
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
        // A task done whose GitHub issue is still open: Claude asks whether to close it, and closes it on a yes; where the issues are in
        // sync, the sync closes it.
        const issues = state === "done" && config.github?.issues !== "sync" ? readIssues(config) : [];

        for (const task of ids.map((id) => moved.find((one) => one.id === id)).filter((one) => one.issue)) {
            if (issues.find((issue) => `#${issue.number}` === task.issue)?.state === "open") {
                console.log(say("issueAskClose", { id: `${prefix}-${task.id}`, issue: task.issue }));
            }
        }

        // A large task whose parts are now all closed: done is still to say, as for any task.
        for (const parent of new Set(ids.map((id) => moved.find((task) => task.id === id).parent).filter(Boolean))) {
            if (moved.filter((task) => task.parent === parent).every(isClosed) && !isClosed(moved.find((task) => `${prefix}-${task.id}` === parent))) {
                console.log(say("partsAllDone", { id: parent }));
            }
        }
    } else if (command === "archive") {
        const chosen = options.done === true ? tasks.filter((task) => task.state === "done") : words.map(find);
        const ids = new Set(chosen.map((task) => task.id));
        save(tasks.map((task) => (ids.has(task.id) ? { ...task, state: "archived", archived: today() } : task)), say("archivedCount", { count: ids.size }));
    } else if (command === "delete") {
        const ids = new Set(words.map(find).map((task) => `${prefix}-${task.id}`));
        const kept = tasks.filter((task) => !ids.has(`${prefix}-${task.id}`));

        // A task another still waits for, sees or is a part of stays: its links would point nowhere.
        for (const id of ids) {
            const others = kept.filter((task) => [...task.after, ...task.see, task.parent].includes(id)).map((task) => `${prefix}-${task.id}`);
            others.length > 0 && fail(say("deleteCited", { id, others: others.join(", ") }));
        }

        save(kept, say("deletedCount", { count: ids.size, ids: [...ids].join(", ") }));
        [...ids].map((id) => notePath(config, id.slice(prefix.length + 1))).filter(existsSync).forEach((path) => unlinkSync(path));
    } else if (command === "set") {
        const task = find(words[0]);
        isIssueGiven && options.approved === undefined && task.issue !== `#${issueNumber()}` && givenIssue();
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
        closeIssue(config, number, doneComment(config, say, task.id));
        console.log(say("issueClosed", { issue: task.issue, id: `${prefix}-${task.id}` }));
    } else if (command === "note") {
        const task = find(words[0]);
        const path = notePath(config, task.id);

        if (!existsSync(path)) {
            writeDoc(config, path, `# ${prefix}-${task.id} · ${task.text}\n`);
        }

        console.log(shown(config, path));
    } else if (command === "comment") {
        // A person's words on a task, which Claude reads with it: in its note, written when missing. Who: --by, else the first person of
        // the project who is not Claude.
        const task = find(words[0]);
        const text = words.slice(1).join(" ").trim() || fail(say("commentEmpty"));
        const given = typeof options.by === "string" ? options.by.replace(/\s+/g, " ").replaceAll(" · ", " - ").trim() : "";
        const by = given ? (assignees(config).find((name) => name.toLowerCase() === given.toLowerCase()) ?? given) : (config.people.find((person) => person !== "Claude") ?? "Claude");
        const path = notePath(config, task.id);
        writeDoc(config, path, withComment(existsSync(path) ? read(path) : `# ${prefix}-${task.id} · ${task.text}\n`, { day: today(), by, text }));
        console.log(say("commentAdded", { id: `${prefix}-${task.id}`, path: shown(config, path) }));
    } else if (command === "show") {
        const shownTasks = words.map(find);
        const links = linksOf(tasks, config, say, stateName);
        const code = readCode(config);
        const issues = shownTasks.some((task) => task.issue) ? readIssues(config) : [];
        const login = issues.length > 0 ? readLogin(config) : null;
        const issueLine = (task) => {
            const issue = issueOf(issues, task, login);
            return issue ? [say(issue.another ? "issueLabelAnother" : "issueLabel", { issue: task.issue, title: issue.title, state: say(issue.state === "open" ? "issueStateOpen" : "issueStateClosed"), author: issue.author })] : [];
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
                task.issue ? fromAnother(task) : null,
            ].filter(Boolean);
            return `${line(task)}${marks.map((mark) => `  ${mark}`).join("")}`;
        };
        print(shownTasks, options.json, marked, say("count", { count: shownTasks.length }));
    } else if (command === "find" && words.length > 0) {
        const wanted = words.map(plain);
        const shownTasks = tasks.filter((task) => wanted.every((word) => plain(`${task.text} ${task.goal} ${task.to}`).includes(word)));
        print(shownTasks, options.json, (task) => [`${line(task)} [${stateName(task)}]`, task.issue ? fromAnother(task) : null].filter(Boolean).join("  "), say("count", { count: shownTasks.length }));
    } else if (command === "import") {
        // Each item a new task, numbered after the others; a wrong one stops them all, so that nothing is half imported. One already
        // imported (its key in a note's Origin line) stays out; so do the closed ones, which --done brings into the archive.
        const creator = typeof options.by === "string" ? options.by : byClaude();
        const known = importedKeys(config);
        const day = /^\d{4}-\d{2}-\d{2}$/;
        const keyOf = (item) => String(item.key ?? item.url ?? "").replace(/\s+/g, " ").replaceAll(" · ", " - ").trim();
        const isShut = (item) => closedStates.includes(String(item.state ?? "").toLowerCase());
        const already = options.incoming.filter((item) => keyOf(item) && known.has(keyOf(item)));
        const shut = options.incoming.filter((item) => !already.includes(item) && isShut(item) && options.done !== true);
        const kept = options.incoming.filter((item) => !already.includes(item) && !shut.includes(item))
            .filter((item, at, all) => !keyOf(item) || all.findIndex((other) => keyOf(other) === keyOf(item)) === at);
        // Every item numbered first, so that one may be a part of, wait for or see another by its key: an epic a large task.
        const first = nextId(tasks);
        const ids = new Map(kept.map((item, at) => [keyOf(item), `${prefix}-${first + at}`]).filter(([key]) => key));
        // A key cites the task made of it, here or in an earlier import; one closed and left out, nothing: a wait already over.
        const outKeys = new Set(shut.map(keyOf));
        const resolved = (one) => (outKeys.has(String(one).trim()) ? null : ids.get(String(one).trim()) ?? known.get(String(one).trim()) ?? one);
        const listed = (value, fallback) => (Array.isArray(value) ? value : value ? listOf(value) : fallback).map(resolved).filter(Boolean);
        const fresh = kept.map((item, at) => {
            const split = splitLinks(String(item.text ?? "").replace(/\s+/g, " ").replaceAll(" · ", " - ").trim(), config.words.fields);
            const closed = isShut(item);
            const state = closed ? "archived" : stateKeys.includes(item.state) ? item.state : "todo";
            return {
                id: first + at,
                priority: item.priority || "P2",
                effort: item.effort || config.words.efforts.medium,
                to: item.to || config.people[0],
                created: day.test(item.created ?? "") ? item.created : today(),
                goal: item.goal || config.words.noGoal,
                text: split.text,
                after: listed(item.after, split.after),
                see: listed(item.see, split.see),
                parent: (item.parent ? resolved(item.parent) : split.parent) || null,
                issue: split.issue,
                due: item.due || split.due,
                type: item.type ? typeKey(String(item.type)) : split.type,
                by: item.by || creator,
                fields: { ...split.fields, ...item.fields },
                started: null,
                done: state === "done" || closed ? (day.test(item.done ?? "") ? item.done : today()) : null,
                archived: closed ? today() : null,
                state,
            };
        });
        // Checked among all the imported ones, which may cite each other.
        fresh.forEach((task) => checked(task, [...tasks, ...fresh]));
        // The note of each: the description, then where it comes from.
        const notes = kept.map((item, at) => {
            const description = String(item.description ?? "").trim();
            const url = String(item.url ?? "").trim();
            const origin = keyOf(item) ? `Origin: ${keyOf(item)}${url && url !== keyOf(item) ? ` · ${url}` : ""}` : "";
            const task = fresh[at];
            return description || origin ? { id: task.id, text: `# ${prefix}-${task.id} · ${task.text}\n${description ? `\n${description}\n` : ""}${origin ? `\n${origin}\n` : ""}` } : null;
        }).filter(Boolean);
        const left = [
            ...(already.length > 0 ? [say("importAlready", { count: already.length, keys: already.map((item) => `${keyOf(item)} (${known.get(keyOf(item))})`).join(", ") })] : []),
            ...(shut.length > 0 ? [say("importClosedOut", { count: shut.length })] : []),
        ];

        if (options.preview === true) {
            fresh.forEach((task) => console.log(`${line(task)} [${stateName(task)}]${notes.some((note) => note.id === task.id) ? `  ${say("importWithNote")}` : ""}`));
            [...left, say("importPreview", { count: fresh.length })].forEach((one) => console.log(one));
        } else if (fresh.length === 0) {
            [...left, say("importNothing")].forEach((one) => console.log(one));
        } else {
            save([...tasks, ...fresh], [say("imported", { count: fresh.length, ids: fresh.map((task) => `${prefix}-${task.id}`).join(", ") }), ...left].join("\n"));
            notes.forEach((note) => writeDoc(config, notePath(config, note.id), note.text));
        }
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
        const task = newTask({
            priority: todo.priority,
            // Raised the day the line was written, not the day it moved.
            created: todo.created,
            ...linked(typeof options.text === "string" ? options.text : todo.text.replaceAll(" · ", " - "), { by: todo.name }),
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
 * ways, its note and the comments in it, whole. */
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
        const { after, chain, waitedBy, see, seenFrom, note, comments, parent, parts, partsDone, nextPart, decisions, dueInfo, stale, specs } = links.get(task.id);
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
            ...comments.flatMap((comment) => [say("commentLabel", { by: comment.by, day: comment.day }), ...comment.text.split("\n").map((line) => `  ${line}`)]),
        ].filter(Boolean);
    };
}

/** A due day said from today: late by some days, today, or in some days. */
function dueText(dueInfo, say)
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

/** Tasks on stdout, a line each and the footer after them, or as JSON with --json. */
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
