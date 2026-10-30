// The project's backlog, changed only through here but for a task's text:
//   node backlog.mjs next
//   node backlog.mjs add "text" [--goal "<goal of the plan>"] [--p P2] [--effort <word>] [--to <name>] [--state todo|doing|postponed|done]
//   node backlog.mjs start|done|postpone|todo T-12 [T-13…]
//   node backlog.mjs archive T-12… | archive --done
//   node backlog.mjs set T-12 [--p P1] [--effort <word>] [--to <name>] [--goal "…"] [--text "…"]
//   node backlog.mjs show T-12… | list [--state doing] [--to <name>] [--p P1] [--goal "…"] [--json] | find <words>… | goals
import { formatLine, moveTasks, nextId, taskErrors } from "../lib/backlog.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { stateKeys } from "../lib/words.mjs";
import { assignees, isMain, loadProject, ProjectError, readBacklog, readGoals, runCli, shown, today, withBacklogLock, writeBacklog } from "./project.mjs";

// The commands that change the backlog, each alone; and the options that take no value.
const changes = ["add", "start", "done", "postpone", "todo", "archive", "set"];
const flags = ["json", "done"];

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

        for (const error of taskErrors(task, { words: config.words, people, goals: archivedGoals, prefix, say })) {
            problems.push({ ...at, message: `${id}: ${error}` });
        }

        if (task.state === "done" && !task.done) {
            problems.push({ ...at, message: say("doneNoDate", { id, marker: config.words.doneMarker }) });
        }
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
    const checked = (task) => {
        const errors = taskErrors(task, { words: config.words, people: assignees(config), goals: readGoals(config).map((goal) => goal.name), prefix, say });
        return errors.length > 0 ? fail(errors.join("\n")) : task;
    };
    const save = (all, said) => {
        writeBacklog(config, all);
        console.log(said);
    };

    if (command === "next") {
        console.log(`${prefix}-${nextId(tasks)}`);
    } else if (command === "add") {
        const text = words.join(" ").trim() || fail(say("noText"));
        const state = options.state ?? "todo";
        const task = checked({
            id: nextId(tasks),
            priority: options.p ?? "P2",
            effort: options.effort ?? config.words.efforts.medium,
            to: options.to ?? config.people[0],
            created: today(),
            goal: options.goal ?? config.words.noGoal,
            text,
            done: state === "done" ? today() : null,
            archived: null,
            state,
        });
        save([...tasks, task], say("added", { id: `${prefix}-${task.id}`, line: line(task) }));
    } else if (["start", "done", "postpone", "todo"].includes(command)) {
        const state = { start: "doing", done: "done", postpone: "postponed", todo: "todo" }[command];
        const ids = words.map(find).map((task) => task.id);
        save(moveTasks(tasks, ids, state, today()).tasks, ids.map((id) => say("moved", { id: `${prefix}-${id}`, state: config.words.states[state] })).join("\n"));
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
            ...(options.text ? { text: options.text } : {}),
        });
        save(tasks.map((one) => (one.id === task.id ? changed : one)), line(changed));
    } else if (command === "show") {
        const shownTasks = words.map(find);
        print(shownTasks, options.json, (task) => `${line(task)}\n  ${say("stateLabel", { state: stateName(task) })}`);
    } else if (command === "list") {
        const shownTasks = tasks.filter((task) => (options.state ? task.state === options.state : task.state !== "archived" && task.state !== "done"))
            .filter((task) => !options.to || task.to === options.to)
            .filter((task) => !options.p || task.priority === options.p)
            .filter((task) => !options.goal || task.goal === options.goal);
        print(shownTasks, options.json, line, say("count", { count: shownTasks.length }));
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

