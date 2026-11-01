// The GitHub issues in sync with the backlog (D-13): what comes in, and the openings and closings both ways. Pure: the issues as gh
// gives them, the tasks, and the state the last sync left in; out, what to do on each side and the state after it. A change is told
// from the last state in sync, so that it never bounces back: a side that moved since then wins; without one, a closing wins.

/** The issues of `gh issue list --json number,title,state,stateReason,assignees,author,labels,milestone,url,closedAt`, each { number,
 * title, state ("open" | "closed"), reason ("completed" | "not_planned" | null), assignees, author, labels, milestone, url, closed }. */
export function parseSyncIssues(json)
{
    try {
        const list = JSON.parse(json || "[]");
        return Array.isArray(list) ? list.map((issue) => ({
            number: issue.number,
            title: String(issue.title ?? ""),
            state: String(issue.state ?? "").toLowerCase(),
            reason: issue.stateReason ? String(issue.stateReason).toLowerCase() : null,
            assignees: (issue.assignees ?? []).map((one) => String(one.login ?? one)),
            author: issue.author?.login ? { login: String(issue.author.login), name: String(issue.author.name ?? "") } : null,
            labels: (issue.labels ?? []).map((one) => String(one.name ?? one)),
            milestone: issue.milestone?.title ? String(issue.milestone.title) : null,
            url: issue.url ?? null,
            closed: issue.closedAt ? String(issue.closedAt).slice(0, 10) : null,
        })) : [];
    } catch {
        return [];
    }
}

// The labels GitHub and the trade use, by the task's type; and by priority.
const typeLabels = {
    bug: ["bug", "defect", "regression", "crash"],
    feature: ["enhancement", "feature", "feature request", "new feature"],
    chore: ["chore", "maintenance", "refactor", "documentation", "docs", "dependencies", "ci"],
    research: ["question", "research", "investigation", "spike", "discussion"],
    test: ["test", "tests", "testing", "playtest"],
};
const priorityLabels = { P1: ["p1", "p0", "priority: high", "high priority", "high", "critical", "urgent"], P3: ["p3", "priority: low", "low priority", "low"] };

/** The task's type an issue's labels say: one of the project's types by its key or its name, else the trade's labels; null for none. */
export function typeOfLabels(labels, types = {})
{
    const names = labels.map((label) => label.toLowerCase().replace(/^(type|kind)\s*[:/]\s*/, ""));
    const own = Object.entries(types).find(([key, name]) => names.includes(key.toLowerCase()) || names.includes(String(name).toLowerCase()));
    return own?.[0] ?? Object.entries(typeLabels).find(([key, words]) => key in types && words.some((word) => names.includes(word)))?.[0] ?? null;
}

/** The priority an issue's labels say: P1, P3, else P2. */
export function priorityOfLabels(labels)
{
    const names = labels.map((label) => label.toLowerCase());
    return Object.entries(priorityLabels).find(([, words]) => words.some((word) => names.includes(word)))?.[0] ?? "P2";
}

/** A task's side of the sync: open (to do, in progress, postponed), done or archived. */
export function taskSide(task)
{
    return task.state === "done" ? "done" : task.state === "archived" ? (task.done ? "done" : "archived") : "open";
}

/** What a sync does, from the issues, the tasks and the last state in sync, `base` = { "12": { issue, task, id } }:
 * - `incoming`: the open issues `me` wrote that come in as tasks, assigned to them, or to nobody where `takeUnassigned`; `assign`,
 *   those of them assigned to nobody (the issue of a task already there is assigned as its fields say, planFields). Another's issue
 *   never comes in by itself: it waits in the panel's and the page's list for the user's → Backlog (D-16);
 * - `closeIssues` ({ number, id, reason: "completed" | "not planned" }), `reopenIssues` ({ number, id }): a task closed or opened again;
 * - `closeTasks` ({ id, number, state: "done" | "archived" }), `reopenTasks` ({ id, number }): an issue closed or opened again;
 * - `base`, the state once all of it is done. */
export function planSync({ issues, tasks, base = {}, me, takeUnassigned = false })
{
    const linked = new Map(tasks.filter((task) => task.issue).map((task) => [Number(task.issue.slice(1)), task]));
    const plan = { incoming: [], assign: [], closeIssues: [], reopenIssues: [], closeTasks: [], reopenTasks: [], base: {} };

    for (const issue of issues) {
        const task = linked.get(issue.number);
        const before = base[String(issue.number)];

        if (!task) {
            const isOwn = Boolean(me) && issue.author?.login === me;
            const isMine = isOwn && issue.assignees.includes(me);
            const isFree = isOwn && issue.assignees.length === 0 && takeUnassigned;

            // An issue whose task was there at the last sync and is gone: taken out by hand, not to come in again.
            if (issue.state === "open" && !before && (isMine || isFree)) {
                plan.incoming.push(issue);
                isFree && plan.assign.push(issue.number);
            }

            continue;
        }

        const side = taskSide(task);
        let issueAfter = issue.state;
        let taskAfter = side;

        if (side !== "open" && issue.state === "open") {
            if (before?.issue === "closed" && before?.task !== "open") {
                plan.reopenTasks.push({ id: task.id, number: issue.number });
                taskAfter = "open";
            } else {
                plan.closeIssues.push({ number: issue.number, id: task.id, reason: side === "archived" ? "not planned" : "completed" });
                issueAfter = "closed";
            }
        } else if (side === "open" && issue.state === "closed") {
            if (before?.task !== undefined && before.task !== "open" && before.issue === "closed") {
                plan.reopenIssues.push({ number: issue.number, id: task.id });
                issueAfter = "open";
            } else {
                const state = issue.reason === "not_planned" ? "archived" : "done";
                plan.closeTasks.push({ id: task.id, number: issue.number, state });
                taskAfter = state;
            }
        }

        plan.base[String(issue.number)] = { issue: issueAfter, task: taskAfter, id: task.id, ...(before?.fields ? { fields: before.fields } : {}) };
    }

    // The issues of tasks gone, or no longer listed, keep their last state: a task taken out by hand does not bring its issue back.
    for (const [number, state] of Object.entries(base)) {
        if (!(number in plan.base)) {
            plan.base[number] = state;
        }
    }

    return plan;
}

/** The fields a task keeps alike with its issue, in GitHub's terms: { title, type, priority, assignee (a login), milestone }. A task of
 * a person with no login of their own (Claude, a colleague, the user) keeps its issue assigned to the user of gh. */
export function taskFields(task, { me, loginOf, noGoal })
{
    return {
        title: task.text,
        type: task.type ?? null,
        priority: task.priority,
        assignee: loginOf(task.to) ?? me ?? null,
        milestone: task.goal && task.goal !== noGoal ? task.goal : null,
    };
}

/** An issue's title as a task's line can hold it, written by anyone on GitHub: on one line, with no " · " (the line's separator), and
 * with no ending the backlog would read as a suffix of its own, `(by: Stefano)` kept as `[by: Stefano]`. */
export function lineTitle(title)
{
    return String(title).replaceAll(" · ", " - ").replace(/\s+/g, " ").trim().replace(/\(([^()]*:[^()]*)\)$/, "[$1]");
}

// What makes a title read like an instruction to its reader rather than the name of some work: a link; a command that fetches, runs or
// takes rights, or a shell's chaining; words that tell the reader to set its rules aside, or speak to it as a model.
const instructionSigns = [
    /\b(https?|ftp):\/\/|\bwww\.\w/i,
    /\$\(|&&|\|\|?\s*(ba|z)?sh\b|\b(curl|wget|sudo|chmod|chown|rm\s+-\w+|powershell|pwsh|iex|invoke-(webrequest|expression)|(ba)?sh\s+-c|eval|exec|node\s+-e|python3?\s+-c|base64)\b/i,
    /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|all|any|instructions?|rules?|guidelines?|system|prompt|user)\b/i,
    /\b(ignora|ignorate|ignori|dimentica|dimenticate|trascura|scavalca)\b.{0,40}\b(precedent\w*|istruzion\w*|regol\w*|tutt\w*|sopra|sistema|prompt|utente)/i,
    /\b(system prompt|you are now|act as|as an ai|language model|prompt di sistema|agisci come|d'ora in poi sei)\b/i,
];

/** Whether an issue's title reads like an instruction (a link, a command, «ignore the rules…»): the panel and the page mark it, for the
 * user to read before taking it (D-16). A sign, not a verdict. */
export function readsAsInstruction(title)
{
    return instructionSigns.some((sign) => sign.test(String(title ?? "")));
}

/** The same fields of an issue: its title as a task's line can hold it, the type and the priority its labels say, its first assignee. */
export function issueFields(issue, types)
{
    return {
        title: lineTitle(issue.title),
        type: typeOfLabels(issue.labels, types),
        priority: priorityOfLabels(issue.labels),
        assignee: issue.assignees[0] ?? null,
        milestone: issue.milestone,
    };
}

/** What a task made from an issue takes from it besides its title, whether the sync brings it in or the backlog adds it: the type and
 * the priority its labels say, the goal its milestone names when the plan has it open (else null), who created it when its author is a
 * person of the project (else null). */
export function issueTask(issue, { types, people, goals })
{
    const author = issue.author ? people.find((person) => [issue.author.login, issue.author.name.split(/\s+/)[0]].some((name) => name && name.toLowerCase() === person.toLowerCase())) ?? null : null;
    return {
        priority: priorityOfLabels(issue.labels),
        type: typeOfLabels(issue.labels, types),
        goal: goals.find((one) => !one.closed && issue.milestone && one.name.toLowerCase() === issue.milestone.toLowerCase())?.name ?? null,
        by: author,
    };
}

/** What makes a task and its issue agree, field by field: the side that changed since the last sync wins; both changed, or no last
 * sync, the backlog wins, but for a field only one side holds, which fills the other. { push, change, taken, held, agreed }: push the
 * fields to write on GitHub, in its terms; change those to write on the task, in the backlog's (text, type, priority, to, goal), taken
 * the fields they come from; held those GitHub changed that wait for the user's yes, `hold` naming them (the title of an issue another
 * wrote, D-16), the task keeping its own; agreed the fields as both sides will hold them, for the next sync. A value GitHub holds that
 * the backlog cannot (a login of no person, a milestone the plan has no open goal for) is left on GitHub and not taken: the task keeps
 * its own. */
export function planFields({ task, issue, before = {}, me, loginOf, personOf, goalOf, noGoal, types, hold = [] })
{
    const local = taskFields(task, { me, loginOf, noGoal });
    const remote = issueFields(issue, types);
    const plan = { push: {}, change: {}, taken: [], held: {}, agreed: {} };
    const take = {
        title: (value) => (value ? { text: value } : null),
        type: (value) => ({ type: value }),
        priority: (value) => ({ priority: value }),
        assignee: (value) => (value && personOf(value) ? { to: personOf(value) } : null),
        milestone: (value) => (value === null ? { goal: noGoal } : goalOf(value) ? { goal: goalOf(value) } : null),
    };

    for (const key of Object.keys(local)) {
        const [mine, theirs, was] = [local[key], remote[key], before[key]];

        if (mine === theirs) {
            plan.agreed[key] = mine;
            continue;
        }

        const isTheirs = was !== undefined ? mine === was : mine === null;
        const taken = isTheirs ? take[key](theirs) : null;

        // Held, the last state in sync stays as it was: until the user says yes, every sync finds the change again.
        if (taken && hold.includes(key)) {
            plan.held[key] = theirs;
            plan.agreed[key] = mine;
        } else if (isTheirs && taken) {
            Object.assign(plan.change, taken);
            plan.taken.push(key);
            plan.agreed[key] = theirs;
        } else if (isTheirs) {
            plan.agreed[key] = mine;
        } else {
            plan.push[key] = mine;
            plan.agreed[key] = mine;
        }
    }

    return plan;
}

/** The label of a type or a priority to put on an issue: the repo's own label for it, when it has one, else the trade's word; null for
 * P2, which has none. */
export function labelFor(kind, value, repoLabels, types = {})
{
    const words = kind === "type" ? [value, types[value], ...(typeLabels[value] ?? [])].filter(Boolean).map((word) => String(word).toLowerCase())
        : value === "P2" ? [] : [value.toLowerCase(), ...(priorityLabels[value] ?? [])];

    if (words.length === 0) {
        return null;
    }

    const own = repoLabels.find((label) => words.includes(label.toLowerCase().replace(/^(type|kind)\s*[:/]\s*/, "")));
    return own ?? (kind === "type" ? typeLabels[value]?.[0] ?? value : value);
}

/** The labels of an issue that say a type, or a priority: those a change of it takes away. */
export function labelsOf(kind, labels, types = {})
{
    return labels.filter((label) => (kind === "type" ? typeOfLabels([label], types) !== null : priorityOfLabels([label]) !== "P2"));
}
