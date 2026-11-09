// What the check finds in the work: the backlog and the colleagues' todos, their links, the code and the issues that cite them, the
// days past, the plan's goals and the points still to decide.
import { existsSync, readdirSync, statSync } from "node:fs";
import { citedTasks } from "../../lib/backlog.mjs";
import { codeView, issueOf } from "../../lib/code.mjs";
import { dayOf } from "../../lib/decisions.mjs";
import { taskSide } from "../../lib/issues.mjs";
import { partsOf } from "../../lib/links.mjs";
import { planUpdated } from "../../lib/plan.mjs";
import { escapeRegex } from "../../lib/text.mjs";
import { parseTodo } from "../../lib/todos.mjs";
import { readable } from "../../lib/words.mjs";
import { backlogProblems, isClosed, openStates, readBacklog, readDependencies, syncSummary, taskLinks } from "../backlog/index.mjs";
import { readDecisions, readGoals } from "../docs.mjs";
import { read, today } from "../files.mjs";
import { readCode, readIssues } from "../github/index.mjs";
import { readTodos, todoFiles, todoIdsEver } from "../people.mjs";

/** The colleagues' todo lines, as Crew writes them: dated, an open one with its priority, the tasks they cite in the backlog. */
export function checkTodos(config, say, add)
{
    const prefix = config.prefixes.task;
    const backlog = new Map(readBacklog(config).tasks.map((task) => [task.id, task]));

    for (const { file } of todoFiles(config)) {
        let open = 0;

        for (const [index, line] of read(file).split(/\r?\n/).entries()) {
            const task = parseTodo(line);

            if (!task) {
                continue;
            }

            if (!task.created) {
                add("error", "tasks", file, index + 1, say("todoNoDate"));
            }

            if (task.done) {
                // A line ticked whose task the backlog still holds open: the work may be finished, the task not yet closed.
                for (const id of citedTasks(task.text, prefix).filter((cited) => ["doing", "todo"].includes(backlog.get(cited)?.state))) {
                    add("note", "tasks", file, index + 1, say("todoDoneTaskOpen", { id: `${prefix}-${id}` }));
                }

                continue;
            }

            open += 1;

            if (!task.priority) {
                add("error", "tasks", file, index + 1, say("todoNoPriority"));
            }

            for (const id of citedTasks(task.text, prefix)) {
                const cited = backlog.get(id);

                if (!cited) {
                    add("warning", "tasks", file, index + 1, say("todoCitesUnknown", { id: `${prefix}-${id}` }));
                } else if (isClosed(cited)) {
                    add("note", "tasks", file, index + 1, say("todoCitesClosed", { id: `${prefix}-${id}`, state: cited.state === "done" ? config.labels.doneMarker : config.labels.archivedMarker }));
                }
            }
        }

        if (open > config.limits.todoOpen) {
            add("warning", "tasks", file, null, say("todoTooMany", { count: open, limit: config.limits.todoOpen }));
        }
    }
}

/** The backlog's own problems, all errors: a line that does not read, a task wrong in itself, a link to a task that is not there. */
export function checkBacklog(config, say, add)
{
    for (const problem of backlogProblems(config, say)) {
        add("error", "backlog", problem.file, problem.line, problem.message);
    }
}

/** The links of the backlog and the todos read together: a cycle of waits, a todo id nobody gave, a large task out of step with its parts,
 * a note of a task that is not there. */
export function checkLinks(config, say, add)
{
    const prefix = config.prefixes.task;
    const { tasks } = readBacklog(config);
    const graph = readDependencies(config, tasks);
    const todoIds = todoIdsEver(config);
    const todos = readTodos(config);

    for (const cycle of graph.cycles()) {
        // Where the cycle starts: its first task's line, or the first todo line with its id.
        const first = tasks.find((task) => `${prefix}-${task.id}` === cycle[0]) ?? todos.find((todo) => todo.id === cycle[0]);
        add("error", "links", first?.file ?? config.files.tasks, first?.line ?? null, say("cycle", { ids: [...cycle, cycle[0]].join(" → ") }));
    }

    for (const task of tasks) {
        for (const other of task.after.filter((one) => one.startsWith("#") && !todoIds.has(one))) {
            add("warning", "links", task.file, task.line, say("afterUnknownTodo", { id: `${prefix}-${task.id}`, other }));
        }
    }

    // A large task follows its parts: closed while some are open, or open once all are closed.
    const parts = partsOf(tasks, prefix);
    const byId = new Map(tasks.map((task) => [`${prefix}-${task.id}`, task]));

    for (const large of tasks.filter((task) => parts.has(`${prefix}-${task.id}`))) {
        const id = `${prefix}-${large.id}`;
        const open = parts.get(id).filter((part) => !isClosed(byId.get(part)));

        if (isClosed(large) && open.length > 0) {
            add("warning", "links", large.file, large.line, say("partsOpen", { id, state: large.state === "done" ? config.labels.doneMarker : config.labels.archivedMarker, list: open.join(", ") }));
        } else if (!isClosed(large) && open.length === 0) {
            add("note", "links", large.file, large.line, say("partsAllDone", { id }));
        }
    }

    const ids = new Set(tasks.map((task) => task.id));
    const notes = existsSync(config.files.notes) ? readdirSync(config.files.notes) : [];

    for (const name of notes) {
        const id = new RegExp(`^${escapeRegex(prefix)}-(\\d+)\\.md$`).exec(name)?.[1];

        if (id && !ids.has(Number(id))) {
            add("warning", "links", `${config.files.notes}/${name}`, null, say("noteOrphan", { id: `${prefix}-${id}` }));
        }
    }
}

/** A task still open that a merged pull request cites: the work may be finished, the task not yet closed. */
export function checkCode(config, say, add, given)
{
    const prefix = config.prefixes.task;
    const code = given ?? readCode(config);
    const { tasks } = readBacklog(config);

    for (const task of tasks.filter((one) => openStates.includes(one.state))) {
        const merged = codeView(code.get(task.id)).mergedPull;

        if (merged) {
            add("note", "code", task.file, task.line, say("mergedOpen", { id: `${prefix}-${task.id}`, number: merged.number, day: merged.merged }));
        }
    }

    // A task and its GitHub issue that no longer agree: one closed, the other open; where the issues are in sync, the next sync settles it.
    const issues = config.github?.issues === "sync" ? [] : readIssues(config);

    for (const task of tasks.filter((one) => one.issue)) {
        const issue = issueOf(issues, task);

        if (issue?.state === "open" && isClosed(task)) {
            add("note", "code", task.file, task.line, say("issueDoneOpen", { id: `${prefix}-${task.id}`, issue: task.issue }));
        } else if (issue?.state === "closed" && !isClosed(task)) {
            add("note", "code", task.file, task.line, say("issueClosedTaskOpen", { id: `${prefix}-${task.id}`, issue: task.issue, day: issue.closed ?? "?" }));
        }
    }
}

/** Where the issues are in sync: the last sync that failed, and the open tasks whose issue GitHub no longer lists. */
export function checkIssues(config, say, add)
{
    const sync = syncSummary(config);

    if (!sync) {
        return;
    }

    if (sync.error) {
        add("warning", "code", null, null, say("issuesSyncFailed", { at: sync.at, error: sync.error }));
    }

    const prefix = config.prefixes.task;
    const tasks = new Map(readBacklog(config).tasks.map((task) => [`${prefix}-${task.id}`, task]));

    for (const { id, issue } of sync.missing) {
        const task = tasks.get(id);
        task && taskSide(task) === "open" && add("warning", "code", task.file, task.line, say("issueMissing", { id, issue }));
    }
}

/** Tasks past their due day, and tasks in progress for days that nobody holds. */
export function checkTime(config, say, add)
{
    const prefix = config.prefixes.task;
    const { tasks } = readBacklog(config);
    const links = taskLinks(config, tasks);

    for (const task of tasks) {
        const { dueInfo, stale } = links.get(task.id);
        const id = `${prefix}-${task.id}`;

        if (dueInfo?.isLate) {
            add("warning", "time", task.file, task.line, say("overdue", { id, day: task.due }));
        }

        if (stale) {
            add("warning", "time", task.file, task.line, say("staleTask", { id, day: task.started }));
        }
    }
}

/** The plan: a goal closed while some of its tasks are still open, an «updated» day older than the file's last change by more than the
 * limit. */
export function checkPlan(config, say, add)
{
    const path = config.files.plan;

    if (!existsSync(path)) {
        return;
    }

    const { tasks } = readBacklog(config);
    const prefix = config.prefixes.task;

    for (const goal of readGoals(config).filter((one) => one.closed)) {
        const open = tasks.filter((task) => task.goal === goal.name && openStates.includes(task.state));

        if (open.length > 0) {
            add("warning", "plan", path, null, say("closedGoalOpen", { goal: goal.name, day: goal.closed, list: open.map((task) => `${prefix}-${task.id}`).join(", ") }));
        }
    }

    const text = read(path);
    const updated = planUpdated(text, config.words);
    const modified = today(statSync(path).mtime);

    if (updated && daysBetween(updated, modified) > config.limits.planDays) {
        const line = text.split(/\r?\n/).findIndex((one) => readable(config.words, "updated").some((word) => one.includes(`${word} ${updated}`))) + 1;
        add("warning", "plan", path, line || null, say("planStale", { updated: config.words.updated, date: updated, modified }));
    }
}

/** The points still to decide that carry a day older than the limit: `(…, 12 october)` in the project's months, or a YYYY-MM-DD. */
export function checkOpen(config, say, add)
{
    const { open } = readDecisions(config);
    const now = today();

    for (const point of open) {
        const day = dayOf(point.text, config.words.months, now);

        if (!day) {
            continue;
        }

        const age = daysBetween(day, now);

        if (age > config.limits.proposalDays) {
            add("note", "open", config.files.decisions, point.line, say("oldProposal", { day, age }));
        }
    }
}

function daysBetween(from, to)
{
    return Math.round((new Date(to) - new Date(from)) / 86400000);
}
