// What the check finds in the backlog's tasks: lines that do not read, numbers twice, links to nothing, parts of a part.
import { taskErrors } from "../../lib/backlog.mjs";
import { nestedParts } from "../../lib/links.mjs";
import { readBacklog, taskRules } from "./tasks.mjs";

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
