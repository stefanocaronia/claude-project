// The plan's goals, closed and opened again; the rest of the plan is written by hand:
//   node plan.mjs close "<goal>"   (once its tasks are all done or archived: the heading gets « · done YYYY-MM-DD»)
//   node plan.mjs open "<goal>"
//   node plan.mjs goals [--json]   (by phase, each saying whether its goals are all closed)
//   node plan.mjs phases [--json]
import { closeGoal, phaseStates, planPhases } from "../lib/plan.mjs";
import { fail, isMain, loadProject, openStates, read, readBacklog, readGoals, runCli, today, writeDoc } from "./project.mjs";

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
    const phases =phaseStates(planPhases(read(config.files.plan)), goals);
    const phaseLine = (phase) => say(phase.isClosed ? "phaseClosedLine" : "phaseOpenLine", { number: phase.number, name: phase.name, closed: phase.closedGoals, total: phase.goals });

    if (command === "phases") {
        console.log(rest.includes("--json") ? JSON.stringify(phases, null, 2) : phases.map(phaseLine).join("\n"));
        return;
    }

    if (command === "goals") {
        const { tasks } = readBacklog(config);
        const rows = goals.map((one) => {
            const own = tasks.filter((task) => task.goal === one.name);
            return { name: one.name, phase: one.phase, closed: one.closed, open: own.filter((task) => openStates.includes(task.state)).length, done: own.filter((task) => task.done).length };
        });

        if (rest.includes("--json")) {
            console.log(JSON.stringify(rows, null, 2));
            return;
        }

        // Each phase's line, then its goals; the goals of no phase after.
        const goalLine = (row) => `  ${say(row.closed ? "goalClosedLine" : "goalOpenLine", { ...row, day: row.closed })}`;
        const lines = [...phases.flatMap((phase) => [phaseLine(phase), ...rows.filter((row) => row.phase === phase.number).map(goalLine)]), ...rows.filter((row) => !phases.some((phase) => phase.number === row.phase)).map((row) => goalLine(row).trim())];
        console.log(lines.join("\n"));
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
    writeDoc(config, config.files.plan, closeGoal(read(config.files.plan), config.words, goal.name, day));
    console.log(say(day ? "goalClosed" : "goalOpened", { goal: goal.name, day }));
}
