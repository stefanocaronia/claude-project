// The project's backlog, changed only through here but for a task's text:
//   node backlog.mjs next
//   node backlog.mjs add "text" [--goal "<goal of the plan>"] [--p P2] [--effort <word>] [--to <name>] [--state todo|doing|postponed|done]
//   node backlog.mjs start|done|postpone|todo T-12 [T-13…]
//   node backlog.mjs archive T-12… | archive --done
//   node backlog.mjs set T-12 [--p P1] [--effort <word>] [--to <name>] [--goal "…"] [--text "…"] [--after "T-3, #giulia-1"] [--see "T-9, D-2"] [--in T-23] [--issue 34] [--due 2026-11-15] [--type bug]
//   node backlog.mjs add --issue 34 ["text"]   (a task from a GitHub issue, its title the text when none is given)
//   node backlog.mjs issue-close T-12   (closes its GitHub issue with a comment: only on the user's yes)
//   node backlog.mjs note T-12   (its note, written when missing: the path)
//   node backlog.mjs show T-12… | list [--atomic] [--state doing] [--to <name>] [--p P1] [--goal "…"] [--json] | find <words>… | goals
import { existsSync } from "node:fs";
import { formatLine, moveTasks, nextId, taskErrors } from "../lib/backlog.mjs";
import { codeView, issueOf } from "../lib/code.mjs";
import { listOf, nestedParts, splitLinks } from "../lib/links.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { stateKeys } from "../lib/words.mjs";
import { closeIssue, readCode, readIssue, readIssues } from "./code.mjs";
import { assignees, isMain, loadProject, notePath, ProjectError, readBacklog, readDecisions, readDependencies, readGoals, runCli, shown, taskLinks, today, withBacklogLock, write, writeBacklog } from "./project.mjs";

// The commands that change the backlog, each alone; and the options that take no value.
const changes = ["add", "start", "done", "postpone", "todo", "archive", "set"];
const flags = ["json", "done", "atomic"];

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

        for (const error of taskErrors(task, { words: config.words, people, goals: archivedGoals, types: Object.keys(config.types), prefix, decisionPrefix: config.prefixes.decision, say })) {
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

function run(args)
{
    const [command, ...rest] = args;
    const { options, words } = optionsOf(rest);
    const { config, say } = loadProject();
    // A change reads the backlog again once it holds the lock, so it never writes over a change made meanwhile.
    return changes.includes(command) ? withBacklogLock(config, () => execute(command, options, words, config, say)) : execute(command, options, words, config, say);
}

function execute(command, options, words, config, say)
{
    const { tasks, unread } = readBacklog(config);
    const prefix = config.prefixes.task;
    const stateName = (task) => (task.state === "archived" ? config.words.archivedMarker : task.state === "done" ? config.words.doneMarker : config.words.states[task.state]);
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
            ...taskErrors(task, { words: config.words, people: assignees(config), goals: readGoals(config).map((goal) => goal.name), types: Object.keys(config.types), prefix, decisionPrefix: config.prefixes.decision, say }),
            ...linkErrors(task, all, config, say),
        ];
        return errors.length > 0 ? fail(errors.join("\n")) : task;
    };
    // The suffixes of a text, `(after: …)`, `(see: …)`, `(in: …)`, `(issue: …)`, `(due: …)` and `(type: …)` at its end, with the options
    // on top: an option given replaces, "" clears.
    const linked = (given, old = {}) => {
        const split = splitLinks(given ?? old.text);
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
            effort: options.effort ?? config.words.efforts.medium,
            to: options.to ?? config.people[0],
            created: today(),
            goal: options.goal ?? config.words.noGoal,
            ...linked(given),
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
        save(moved, [...ids, ...parents].map((id) => say("moved", { id: `${prefix}-${id}`, state: config.words.states[state] })).join("\n"));
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
            ...(options.effort ? { effort: options.effort } : {}),
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
            write(path, `# ${prefix}-${task.id} · ${task.text}\n`);
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

/** What a task's links would break, among all the tasks: a task or a decision that does not exist, a wait that closes a cycle. */
function linkErrors(task, all, config, say)
{
    const prefix = config.prefixes.task;
    const id = `${prefix}-${task.id}`;
    const tasks = new Set(all.map((one) => `${prefix}-${one.id}`));
    const decisions = new Set(readDecisions(config).decided.map((row) => `${config.prefixes.decision}-${row.number}`));
    const missing = [...task.after, ...task.see, ...(task.parent ? [task.parent] : [])].filter((one) => (one.startsWith(`${prefix}-`) && !tasks.has(one)) || (one.startsWith(`${config.prefixes.decision}-`) && !decisions.has(one)));
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

    return (task) => {
        const { after, chain, waitedBy, see, seenFrom, note, parent, parts, partsDone, nextPart, decisions, dueInfo, stale } = links.get(task.id);
        return [
            task.type ? say("typeLabel", { name: config.types[task.type] ?? task.type }) : null,
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

