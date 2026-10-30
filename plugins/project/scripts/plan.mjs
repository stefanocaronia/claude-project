// The plan's goals, closed and opened again; the rest of the plan is written by hand:
//   node plan.mjs close "<goal>"   (once its tasks are all done or archived: the heading gets « · done YYYY-MM-DD»)
//   node plan.mjs open "<goal>"
//   node plan.mjs goals [--json]
import { closeGoal } from "../lib/plan.mjs";
import { isMain, loadProject, ProjectError, read, readBacklog, readGoals, runCli, today, write } from "./project.mjs";

const openStates = ["doing", "todo", "postponed"];

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

function run(args)
{
    const [command, ...rest] = args;
    const { config, say } = loadProject();
    const goals = readGoals(config);
    const name = rest.filter((arg) => !arg.startsWith("--")).join(" ").trim();
    const goal = goals.find((one) => one.name === name);
    const fail = (message) => {
        throw new ProjectError(message);
    };

    if (command === "goals") {
        const { tasks } = readBacklog(config);
        const rows = goals.map((one) => {
            const own = tasks.filter((task) => task.goal === one.name);
            return { name: one.name, phase: one.phase, closed: one.closed, open: own.filter((task) => openStates.includes(task.state)).length, done: own.filter((task) => task.done).length };
        });
        console.log(rest.includes("--json") ? JSON.stringify(rows, null, 2) : rows.map((row) => say(row.closed ? "goalClosedLine" : "goalOpenLine", { ...row, day: row.closed })).join("\n"));
        return;
    }

    if (!["close", "open"].includes(command)) {
        fail(say("planUsage"));
    }

    if (!goal) {
        fail(say("badGoal", { value: name, list: goals.map((one) => one.name).join("; "), none: config.words.noGoal }));
    }

    if (command === "close") {
        const prefix = config.prefixes.task;
        const open = readBacklog(config).tasks.filter((task) => task.goal === goal.name && openStates.includes(task.state));

        if (open.length > 0) {
            fail(say("goalHasOpen", { goal: goal.name, list: open.map((task) => `${prefix}-${task.id}`).join(", ") }));
        }
    }

    const day = command === "close" ? (goal.closed ?? today()) : null;
    write(config.files.plan, closeGoal(read(config.files.plan), config.words, goal.name, day));
    console.log(say(day ? "goalClosed" : "goalOpened", { goal: goal.name, day }));
}
