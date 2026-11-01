// A task as the page draws it, on the board and in the list: its marks (type, priority, effort, who holds it), its waits and links in
// words, the panel's order; then the tasks' tab: the list with its filters, the GitHub issues, the open tasks by owner, age and urgency,
// and the colleagues.

// The board's columns, in order; the turn of a priority and its rank, as the panel's; the priorities of the chart by owner.
const boardStates = ["doing", "todo", "postponed", "done"];
const nextPriority = { P1: "P2", P2: "P3", P3: "P1" };
const priorityRank = { P1: 1, P2: 2, P3: 3 };
const priorityOrder = ["P1", "P2", "P3", "none"];
const priorityColors = { P1: "#184f95", P2: "#3987e5", P3: "#9ec5f4", none: "var(--never)" };
// Crew's marks: a priority as an issue tracker draws it, the effort as four bars, a colleague's color for their initials, Claude's critter.
const priorityMarks = {
    P1: `<path d="M3.5 7.5L7 4l3.5 3.5M3.5 11L7 7.5l3.5 3.5" stroke="#E5493A"/>`,
    P2: `<path d="M3 5.5h8M3 8.5h8" stroke="#E2852B"/>`,
    P3: `<path d="M3.5 5.5L7 9l3.5-3.5" stroke="#4C8FE0"/>`,
};
const effortBars = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };
const tints = { red: "#b42318", blue: "#1d4ed8", green: "#15803d", yellow: "#8a6100", purple: "#7e22ce", orange: "#c2410c", pink: "#be185d", cyan: "#0e7490" };
const critter = claudeCritter();
// The colors of the task types, as Jira's issue types (lib/schedule.mjs).
const typeColors = { bug: "#E5493A", feature: "#36B37E", chore: "#4C9AFF", research: "#8777D9", test: "#E2852B" };
// The list's filters, and what they are when none is set.
const noFilter = { state: "open", priority: "all", type: "all", who: "all", goal: "all" };
const taskFilter = { ...noFilter };
// A large task's parts shown (true) or folded (false), by task number, as the user left them.
const folds = {};

/** The column a task sits in: an archived task is a done one. */
function columnOf(task)
{
    return task.state === "archived" ? "done" : task.state;
}

/** A state in the project's words. */
function stateName(state)
{
    return data.words.states[state] ?? state;
}

/** A task's name with the project's prefix, «T-12». */
function taskName(task)
{
    return `${data.prefixes.task}-${task.id}`;
}

/** The panel's order: by priority, then the oldest, then by number; a large task stands where its most urgent open part would. */
function taskOrder(first, second)
{
    return byUrgency(mostUrgent(first), mostUrgent(second)) || first.id - second.id;
}

/** Two tasks by priority, those without one last, then the oldest first. */
function byUrgency(first, second)
{
    return (priorityRank[first.priority] ?? 4) - (priorityRank[second.priority] ?? 4) || (first.created ?? "").localeCompare(second.created ?? "");
}

/** A task, or for a large task the most urgent of it and its open parts. */
function mostUrgent(task)
{
    const parts = (data.board ?? []).filter((part) => part.parent === taskName(task) && columnOf(part) !== "done");
    return [task, ...parts].sort(byUrgency)[0];
}

/** Two tasks closed, the latest first. */
function latestClosed(first, second)
{
    return (second.done ?? second.archived ?? "").localeCompare(first.done ?? first.archived ?? "");
}

/** The tasks in their order with each part moved right under its large task, when that is among them: the parts in progress first. */
function withPartsUnder(tasks)
{
    const ids = new Set(tasks.map((task) => taskName(task)));
    const isUnder = (task) => Boolean(task.parent && ids.has(task.parent));
    const partsOf = (task) => (isUnfolded(task) ? tasks.filter((part) => part.parent === taskName(task)).sort((first, second) => Number(second.state === "doing") - Number(first.state === "doing")) : []);
    return tasks.filter((task) => !isUnder(task)).flatMap((task) => [task, ...partsOf(task)]);
}

/** A large task's parts shown: as the user left them, else while one is in progress. */
function isUnfolded(task)
{
    return folds[task.id] ?? (data.board ?? []).some((part) => part.parent === taskName(task) && part.state === "doing");
}

/** A task's type as Jira draws an issue type: a rounded square in its color with a white sign, its name under the pointer and to a
 * screen reader; nothing without one. */
function typeIcon(task)
{
    if (!task.type) {
        return "";
    }

    const signs = {
        bug: `<circle cx="7" cy="7" r="2.6" fill="#fff"/>`,
        feature: `<path d="M4.5 3.5h5v7L7 8.6 4.5 10.5z" fill="#fff"/>`,
        chore: `<path d="M4 7.2l2 2 4-4.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
        research: `<circle cx="6.3" cy="6.3" r="2.4" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M8.1 8.1l2.2 2.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
        test: `<path d="M5.4 3.2h3.2M6 3.2v2.9L3.7 10.2a.7.7 0 0 0 .6 1h5.4a.7.7 0 0 0 .6-1L8 6.1V3.2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    };
    const name = data.types?.[task.type] ?? task.type;
    const sign = signs[task.type] ?? `<text x="7" y="10" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${escape(task.type.slice(0, 1).toUpperCase())}</text>`;
    return `<svg class="type-icon" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="${attribute(name)}" data-tip="${attribute(escape(name))}"><rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="${typeColors[task.type] ?? "#8993A4"}"/>${sign}</svg>`;
}

/** A priority as Crew draws it: a button that turns it, P1, P2, P3 and P1 again; only a mark on a task already done. */
function priorityControl(task, where)
{
    const key = task.priority;
    const name = priorityName(key);

    if (columnOf(task) === "done" || !priorityMarks[key]) {
        return `<span class="prio" role="img" aria-label="${attribute(name)}" data-tip="${attribute(escape(name))}">${priorityMark(key)}</span>`;
    }

    const next = nextPriority[key];
    const id = `${where}-priority-${taskName(task)}`;

    return `<button type="button" class="prio" id="${id}" data-priority="${task.id}" data-next="${next}" aria-label="${attribute(t("priorityTurn", taskName(task), name, priorityName(next)))}" data-tip="${attribute(`<b>${escape(name)}</b>${escape(t("priorityClick", priorityName(next)))}`)}">${priorityMark(key)}</button>`;
}

/** A priority's arrows, a drawing only: whatever holds it says the priority in words. */
function priorityMark(key)
{
    const mark = priorityMarks[key];

    return mark ? `<svg class="icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mark}</svg>` : "";
}

/** «P1, high priority», in the project's words. */
function priorityName(key)
{
    return key ? `${key}, ${t("priorityName", data.words.priorities[key] ?? key)}` : t("noPriority");
}

/** A priority as the chart's legend says it, «P1 high»; none is «no priority». */
function priorityLabel(key)
{
    return key === "none" ? t("noPriority") : `${key} ${data.words.priorities[key] ?? ""}`.trim();
}

/** The effort a task needs as four bars, low to max; nothing for none. */
function effortMeter(task)
{
    const filled = effortBars[task.effortKey];

    if (!filled) {
        return "";
    }

    const bars = [0, 1, 2, 3].map((index) => `<rect x="${index * 4}" y="1" width="3" height="10" rx="1" fill="currentColor" fill-opacity="${index < filled ? 1 : 0.3}"/>`).join("");
    const label = t("effortName", task.effort);

    return `<span class="effort" role="img" aria-label="${attribute(label)}" data-tip="${attribute(escape(label))}"><svg class="icon" width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">${bars}</svg></span>`;
}

/** Who holds a task: Claude's critter, a colleague's portrait or initials on their color, a person's initials in gray. */
function face(task)
{
    const person = task.colleague ? data.colleagues.find((one) => one.id === task.colleague) : null;
    const name = person?.name ?? task.to;
    const tip = `data-tip="${attribute(`<b>${escape(name)}</b>${person ? escape(person.role) : ""}`)}"`;

    if (task.to === "Claude") {
        return `<span class="face" role="img" aria-label="Claude" ${tip}>${critter}</span>`;
    }

    if (person?.hasPortrait) {
        return `<img class="face" src="/portrait/${attribute(person.id)}" alt="${attribute(name)}" ${tip}>`;
    }

    // The owner's GitHub picture, on their tasks and on every decision.
    if (data.owner?.href && task.to === data.owner.name) {
        return `<img class="face" src="${attribute(data.owner.href)}" alt="${attribute(data.owner.fullName)}" data-tip="${attribute(`<b>${escape(data.owner.fullName)}</b>`)}">`;
    }

    const initials = String(name).split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
    const color = person ? tints[person.color] ?? "#6b6b67" : "#8a8a86";

    return `<span class="face" role="img" aria-label="${attribute(name)}" style="background:${color}" ${tip}>${escape(initials)}</span>`;
}

/** The first name of the colleague at work on a task in progress, as the holds say; null when none is. */
function workerOf(task)
{
    const held = columnOf(task) === "doing" ? data.holds?.[String(task.id)] : null;
    const person = held?.colleague ? data.colleagues.find((one) => one.id === held.colleague) : null;
    return held?.colleague ? (person?.name ?? held.colleague).split(" ")[0] : null;
}

/** Claude: an orange pixel critter on a round cream background, as Crew draws it. */
function claudeCritter()
{
    const rows = [".X........X.", "..X......X..", "..XXXXXXXX..", ".XXXXXXXXXX.", ".XXEEXXEEXX.", "XXXEEXXEEXXX", "XXXXXXXXXXXX", ".XXXXXXXXXX.", "..X.X..X.X..", "..X.X..X.X.."];
    const runs = rows.flatMap((row, y) => [...row.matchAll(/X+|E+/g)].map((run) => `<rect x="${run.index + 2}" y="${y + 3}" width="${run[0].length}" height="1" fill="${run[0][0] === "E" ? "#2B1D17" : "#D97757"}"/>`));

    return `<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#F3E6DC"/><g shape-rendering="crispEdges">${runs.join("")}</g></svg>`;
}

/** In place of a task's age: what a blocked task still waits for, «⛓ T-62», or a large task's parts closed, each said in words under
 * the pointer and to a screen reader; else its age. */
function waitOrAge(task)
{
    const blockers = task.blockedBy ?? [];
    const parts = task.parts ?? [];

    if (parts.length > 0) {
        const said = t("partsTip", task.partsDone, parts.length);
        const isOpen = isUnfolded(task);
        return `<button type="button" class="parts-chip ${task.state === "doing" ? "doing" : ""}" id="fold-${taskName(task)}" data-fold="${task.id}" aria-expanded="${isOpen}" data-tip="${attribute(escape(said))}"><span aria-hidden="true">${isOpen ? "▾" : "▸"} ${task.partsDone}/${parts.length}</span><span class="visually-hidden">${escape(said)}</span></button>`;
    }

    if (blockers.length > 0) {
        const said = t("blockedTip", blockers.join(", "));
        return `<span class="wait blocked" data-tip="${attribute(escape(said))}"><span aria-hidden="true">⛓ ${escape(blockers[0])}${blockers.length > 1 ? ` +${blockers.length - 1}` : ""}</span><span class="visually-hidden">${escape(said)}</span></span>`;
    }

    const due = task.dueInfo && (task.dueInfo.isLate || task.dueInfo.isNear) ? task.dueInfo : null;

    if (due) {
        const when = due.isLate ? t("dueLate", -due.days) : due.days === 0 ? t("dueToday") : t("dueIn", due.days);
        return `<span class="wait ${due.isLate ? "late" : "near"}" data-tip="${attribute(escape(t("dueTip", formatDay(due.day))))}"><span aria-hidden="true">⏰ </span>${escape(when)}</span>`;
    }

    if (task.stale && task.started) {
        const said = t("staleTip", formatDay(task.started));
        return `<span class="wait stale" data-tip="${attribute(escape(said))}"><span aria-hidden="true">⏸ ${escape(age(task.started))}</span><span class="visually-hidden">${escape(said)}</span></span>`;
    }

    return `<span data-tip="${attribute(escape(t("bornOn", formatDay(task.created))))}">${escape(age(task.created))}</span>`;
}

/** A task's links in words, both ways, under its text: the large task it is a part of, what it waits for, what waits for it, what it
 * points to and what points to it; its note, which opens; its comments, which its form shows. Nothing when it has none. */
function taskLinks(task, isUnder = false)
{
    const line = (label, list) => (list?.length ? `<span><b>${escape(label)}</b> ${escape(list.join(", "))}</span>` : "");
    const parts = [
        task.due ? `<span><b>${escape(t("linkDue"))}</b> ${escape(formatDay(task.due))}</span>` : "",
        task.started && task.state === "doing" ? `<span><b>${escape(t("linkStarted"))}</b> ${escape(formatDay(task.started))}</span>` : "",
        line(t("linkDecisions"), task.decisions),
        // A part drawn under its large task does not name it again.
        line(t("linkPartOf"), task.parent && !isUnder ? [task.parent] : []),
        line(t("linkParts"), task.parts),
        line(t("linkWaitsFor"), task.after),
        line(t("linkWaitedBy"), task.waitedBy),
        // The specs it does, each a link to its row in the specifications' tab.
        task.specs?.length ? `<span><b>${escape(t("linkSpecs"))}</b> ${task.specs.map((spec) => `<button type="button" class="link-button" data-go-spec="${attribute(spec)}" data-tip="${attribute(escape(specText(spec)))}">${escape(spec)}</button>`).join(" ")}</span>` : "",
        line(t("linkSee"), task.see),
        line(t("linkSeenFrom"), task.seenFrom),
        task.noteHref ? `<a href="${attribute(task.noteHref)}" target="_blank" rel="noopener">${escape(t("openNote"))}</a>` : "",
        task.comments?.length ? `<button type="button" class="link-button" data-edit-task="${task.id}">${escape(t("commentsCount", task.comments.length))}</button>` : "",
        ...codeLinks(task),
    ].filter(Boolean);
    return parts.length > 0 ? `<div class="task-links">${parts.join("")}</div>` : "";
}

/** The code that cites a task: how many commits, the latest a link and the others under the pointer; each pull request, a link, with
 * its state; on a task still open, a merged one says it can close. */
function codeLinks(task)
{
    const commits = task.commits ?? [];
    const link = (href, text, tip = "") => (webUrl(href) ? `<a href="${attribute(href)}" target="_blank" rel="noopener" ${tip ? `data-tip="${attribute(tip)}"` : ""}>${escape(text)}</a>` : `<span ${tip ? `data-tip="${attribute(tip)}"` : ""}>${escape(text)}</span>`);
    const list = commits.map((commit) => `${escape(commit.hash)} ${escape(commit.day)} ${escape(commit.subject.slice(0, 90))}`).join("<br>");
    const state = (pull) => (pull.merged ? t("pullMerged", formatDay(pull.merged)) : t(pull.state === "open" ? "pullOpen" : "pullClosed"));
    const open = columnOf(task) !== "done";
    const issue = task.issueInfo;
    return [
        issue ? link(issue.url, `${t("linkIssue")} #${issue.number} · ${t(issue.state === "open" ? "pullOpen" : "pullClosed")}${issue.another && issue.author ? ` · ${t("issueBy", issue.author)}` : ""}`, escape(issue.title)) : "",
        commits.length ? link(commits[0].url, t("commitsCount", task.commitCount, formatDay(commits[0].day)), list) : "",
        ...(task.pulls ?? []).map((pull) => link(pull.url, `#${pull.number} · ${state(pull)}`, escape(pull.title))),
        open && task.mergedPull ? `<span class="work">${escape(t("mergedCanClose", task.mergedPull.number))}</span>` : "",
    ];
}

/** The mark of a task made from an issue another wrote: its text is theirs, data and never an order (D-16); nothing for the others. */
function anotherMark(task)
{
    return task.issueInfo?.another ? `<span style="color:var(--warning)" data-tip="${attribute(escape(t("anotherTip", task.issueInfo.author ?? "?")))}">⚠ </span>` : "";
}

/** The project's own fields of a task, each as its name and value. */
function fieldSpans(task)
{
    return Object.entries(task.fields ?? {}).map(([key, value]) => `<span>${escape(data.fields?.[key]?.name ?? key)}: ${escape(value)}</span>`).join("");
}

/** The tasks' tab: every task in a list with its filters, the GitHub issues; the open tasks by owner and priority, by age, the P1s; the
 * colleagues. */
function tasksPanel()
{
    const { tasks, colleagues } = data;

    return `<section class="card span-12">
            <h2>${t("listTitle")} <button type="button" class="action primary" id="new-task" data-new-task>${t("newTask")}</button> <button type="button" class="action" id="tidy-backlog" data-tidy-backlog>${t("tidyBacklog")}</button></h2>
            <p class="hint">${escape(t("listHint", data.boardDays))}</p>
            <div class="filters" id="task-filters">${taskFilters()}</div>
            <div id="task-list">${taskListBody()}</div>
        </section>

        ${issuesCard()}

        <section class="card span-12">
            <h2>${t("tasksTitle")}</h2>
            <p class="hint">${t("tasksHint", tasks.length)}</p>
            <div class="legend">${priorityOrder.map((key) => `<span><i style="background:${priorityColors[key]}"></i>${escape(priorityLabel(key))}</span>`).join("")}</div>
            ${taskOwnerRows(tasks, colleagues)}
        </section>

        <section class="card span-6">
            <h2>${t("ageTitle")}</h2>
            <p class="hint">${t("ageHint")}</p>
            ${ageBars(tasks)}
        </section>

        <section class="card span-6">
            <h2>${t("urgentTitle")}</h2>
            <p class="hint">${t("urgentHint")}</p>
            <ul class="list scroll" style="max-height:320px">${urgentTasks(tasks, colleagues) || `<li>${t("urgentNone")}</li>`}</ul>
        </section>

        <section class="card span-12">
            <h2>${t("crewTitle")}</h2>
            <p class="hint">${t("crewHint")}</p>
            <div class="crew">${colleagueCards(colleagues)}</div>
        </section>`;
}

/** The filters of the list of tasks: state, priority and type as buttons that stay pressed, who and goal as menus. */
function taskFilters()
{
    const all = data.board ?? [];
    const countOf = (keep) => all.filter(keep).length;
    const chip = (kind, value, label, count) => `<button type="button" id="filter-${kind}-${attribute(value)}" data-task-filter="${kind}" data-value="${attribute(value)}" aria-pressed="${taskFilter[kind] === value}">${label}${count === undefined ? "" : `<span class="count">${count}</span>`}</button>`;
    const states = [["open", t("filterOpenTasks"), (task) => columnOf(task) !== "done"], ...boardStates.map((state) => [state, escape(stateName(state)), (task) => columnOf(task) === state]), ["all", t("filterEvery"), () => true]];
    const types = [...new Set(all.map((task) => task.type).filter(Boolean))].sort();
    const priorities = [chip("priority", "all", t("filterAnyPriority")), ...["P1", "P2", "P3"].map((key) => chip("priority", key, `${priorityMark(key)}${escape(key)}`, countOf((task) => task.priority === key && columnOf(task) !== "done")))];
    const people = [...new Set(all.map((task) => task.to))].sort((first, second) => countOf((task) => task.to === second) - countOf((task) => task.to === first));
    const goals = [...new Set([...data.plan.sections.map((section) => section.name), ...all.map((task) => task.goal)])].filter((goal) => goal !== data.words.noGoal && all.some((task) => task.goal === goal));
    const option = (kind, value, label) => `<option value="${attribute(value)}" ${taskFilter[kind] === value ? "selected" : ""}>${escape(label)}</option>`;
    const noGoal = all.some((task) => task.goal === data.words.noGoal) ? option("goal", data.words.noGoal, t("noGoalLane")) : "";

    return `<div class="chips" role="group" aria-labelledby="filter-state-name"><span class="filter-name" id="filter-state-name">${t("filterState")}</span>${states.map(([value, label, keep]) => chip("state", value, label, countOf(keep))).join("")}</div>
        <div class="chips" role="group" aria-labelledby="filter-priority-name"><span class="filter-name" id="filter-priority-name">${t("filterPriority")}</span>${priorities.join("")}</div>
        ${types.length ? `<div class="chips" role="group" aria-labelledby="filter-type-name"><span class="filter-name" id="filter-type-name">${t("filterType")}</span>${chip("type", "all", t("anyType"))}${types.map((type) => chip("type", type, `${typeIcon({ type })}${escape(data.types?.[type] ?? type)}`, countOf((task) => task.type === type && columnOf(task) !== "done"))).join("")}</div>` : ""}
        <label>${t("filterWho")} <select id="filter-who" data-task-filter="who">${option("who", "all", t("anyone"))}${people.map((person) => option("who", person, person)).join("")}</select></label>
        <label>${t("filterGoal")} <select id="filter-goal" data-task-filter="goal">${option("goal", "all", t("anyGoal"))}${goals.map((goal) => option("goal", goal, goal)).join("")}${noGoal}</select></label>`;
}

/** Every task the filters keep, as the panel orders them: in progress, to do, postponed, each by priority and then the oldest; the done
 * last, the latest first. */
function filteredTasks()
{
    const keep = (task) => {
        const column = columnOf(task);
        const state = taskFilter.state === "all" || (taskFilter.state === "open" ? column !== "done" : column === taskFilter.state);
        return state && (taskFilter.type === "all" || task.type === taskFilter.type) && (taskFilter.priority === "all" || task.priority === taskFilter.priority) && (taskFilter.who === "all" || task.to === taskFilter.who) && (taskFilter.goal === "all" || task.goal === taskFilter.goal);
    };
    const closedLast = (first, second) => boardStates.indexOf(columnOf(first)) - boardStates.indexOf(columnOf(second));
    const recent = (first, second) => (columnOf(first) === "done" ? latestClosed(first, second) : 0);

    return withPartsUnder((data.board ?? []).filter(keep).sort((first, second) => closedLast(first, second) || recent(first, second) || taskOrder(first, second)));
}

/** The list: how many tasks the filters keep, and a button that clears them; each task, or its form while it is written. */
function taskListBody()
{
    const tasks = filteredTasks();
    const ids = new Set(tasks.map((task) => taskName(task)));
    const rows = (editing === "new" ? taskForm(null) : "") + tasks.map((task) => (editing === task.id ? taskForm(task) : taskRow(task, Boolean(task.parent && ids.has(task.parent))))).join("");
    const filtered = Object.entries(taskFilter).some(([kind, value]) => value !== noFilter[kind]);

    return `<p class="found">${escape(t("listCount", tasks.length))}${filtered ? ` · <button type="button" id="filters-clear" data-clear-filters>${t("clearFilters")}</button>` : ""}</p>
        <ul class="rows">${rows || `<li class="row"><span></span><span></span><span class="hint">${t("listNone")}</span></li>`}</ul>`;
}

/** A task in the list: who holds it, its type and priority, its text, which opens; its state, who is at work on it, its goal, its age or
 * wait, its fields and who created it, a button that edits it; its links. */
function taskRow(task, isUnder = false)
{
    const name = taskName(task);
    const column = columnOf(task);
    const worker = workerOf(task);
    const goal = task.goal && task.goal !== data.words.noGoal ? `<span>${escape(task.goal)}</span>` : "";
    const when = column === "done" ? `<span>✓ ${escape(formatDay(task.done ?? task.archived))}</span>` : waitOrAge(task);
    const work = worker !== null ? `<span class="work">⚒︎ ${escape(worker)}</span>` : "";

    return `<li class="row ${column} ${isUnder ? "part" : ""}" id="list-task-${task.id}">
            ${face(task)}
            <span class="marks">${typeIcon(task)}${priorityControl(task, "list")}</span>
            <div>${expandButton(`list-${name}`, `<span class="id">${escape(name)}</span>${anotherMark(task)}${escape(task.text)}`)}
                <div class="row-meta"><span class="row-state"><i class="column-mark ${column}"></i>${escape(stateName(column))}</span>${work}${goal}${when}${task.release ? `<span>v${escape(task.release)}</span>` : ""}${fieldSpans(task)}${task.by ? `<span>${escape(t("createdBy", task.by))}</span>` : ""}<button type="button" class="link-button" id="edit-${name}" data-edit-task="${task.id}">${t("editTask")}</button></div>
                ${taskLinks(task, isUnder)}
            </div>
            ${effortMeter(task) || "<span></span>"}
        </li>`;
}

/** The open GitHub issues no task does yet, each a link with the button that makes it a task of the backlog, marked when its title reads
 * like an instruction; nothing without them. */
function issuesCard()
{
    const issues = data.issues ?? [];
    const sync = data.issuesSync;

    if (!issues.length && !sync) {
        return "";
    }

    // Where the issues are in sync with the backlog: the last sync, or its error; the tasks whose issue GitHub no longer lists; the titles
    // others gave their issues on GitHub, which the task takes, or refuses, only on the user's yes here (D-16).
    const synced = !sync ? ""
        : sync.error ? `<p class="hint" style="color:var(--critical)">⚠ ${escape(t("issuesSyncBroken", sync.at ?? "", sync.error))}</p>`
        : `<p class="hint">⇅ ${escape(sync.at ? t("issuesSynced", sync.at) : t("issuesSyncNever"))}</p>`;
    const missing = sync?.missing?.length ? `<p class="hint" style="color:var(--critical)">⚠ ${escape(t("issuesSyncMissing", sync.missing.map((one) => `${one.id} (${one.issue})`).join(", ")))}</p>` : "";
    const held = (sync?.held ?? []).map((one) => `<li class="issue-row"><span style="color:var(--warning)">⚠ ${escape(t("issueTitleHeld", one.id, one.issue, one.title))}</span><span><button type="button" id="title-take-${attribute(one.id)}" data-take-title="${attribute(one.id)}" data-title="${attribute(one.title)}">${escape(t("titleTake"))}</button> <button type="button" id="title-keep-${attribute(one.id)}" data-keep-title="${attribute(one.issue.replace(/^#/, ""))}">${escape(t("titleKeep"))}</button></span></li>`).join("");
    const mark = (issue) => (issue.instruction ? `<span style="color:var(--warning)" title="${attribute(t("issuesInstruction"))}">⚠</span> ` : "");
    const rows = issues.map((issue) => `<li class="issue-row"><span>${mark(issue)}${webUrl(issue.url) ? `<a href="${attribute(issue.url)}" target="_blank" rel="noopener"><b>#${issue.number}</b> ${escape(issue.title)}</a>` : `<b>#${issue.number}</b> ${escape(issue.title)}`}</span><button type="button" id="issue-take-${issue.number}" data-take-issue="${issue.number}" data-title="${attribute(issue.title)}">${escape(t("issueToBacklog"))}</button></li>`).join("");
    return `<section class="card span-12">
            <h2>${escape(t("issuesTitle"))} <span class="badge">${issues.length}</span></h2>
            ${synced}${missing}
            ${held ? `<ul class="issues">${held}</ul>` : ""}
            ${issues.length ? `<p class="hint">${escape(t("issuesHint"))}</p>
            ${issues.some((issue) => issue.instruction) ? `<p class="hint" style="color:var(--warning)">${escape(t("issuesInstruction"))}</p>` : ""}
            <ul class="issues">${rows}</ul>` : ""}
        </section>`;
}

/** The open tasks by who holds them, the most first: a bar each, in segments by priority. */
function taskOwnerRows(tasks, colleagues)
{
    const names = Object.fromEntries(colleagues.map((person) => [person.id, person.name]));
    const count = (owner) => tasks.filter((task) => task.owner === owner).length;
    const owners = [...new Set(tasks.map((task) => task.owner))].sort((first, second) => count(second) - count(first));
    const most = Math.max(1, ...owners.map(count));

    return owners.map((owner) => {
        const own = tasks.filter((task) => task.owner === owner);
        const label = names[owner] ?? owner;
        const segments = priorityOrder.map((key) => [key, own.filter((task) => (task.priority ?? "none") === key).length]).filter(([, value]) => value > 0)
            .map(([key, value]) => `<span style="flex:${value};background:${priorityColors[key]}" data-tip="${attribute(`<b>${escape(label)}: ${value} ${escape(priorityLabel(key))}</b>`)}"></span>`).join("");

        return `<div class="coverage-row"><div>${escape(label)}</div><div style="width:${(own.length / most) * 100}%"><div class="stack">${segments}</div></div><div style="text-align:right;color:var(--ink-2)">${own.length}</div></div>`;
    }).join("");
}

/** The open tasks by how long they have been open, in five bins from under three days to over three weeks. */
function ageBars(tasks)
{
    const bins = [[0, 3], [3, 7], [7, 14], [14, 21], [21, Infinity]];
    const labels = t("ageBins");
    const ages = tasks.filter((task) => task.created).map((task) => (Date.now() - new Date(`${task.created}T12:00:00`)) / 86400000);
    const values = bins.map(([from, to]) => ages.filter((age) => age >= from && age < to).length);
    const width = 520;
    const height = 200;
    const top = niceMax(Math.max(1, ...values));
    const slot = (width - 28) / bins.length;
    const y = (value) => 10 + (height - 40) * (1 - value / top);
    const bars = bins.map((_, index) => {
        const x = 28 + index * slot + slot * 0.18;
        const barHeight = Math.max(1, y(0) - y(values[index]));

        return `<rect x="${x}" y="${y(values[index])}" width="${slot * 0.64}" height="${barHeight}" rx="4" fill="var(--series-1)" data-tip="${attribute(`<b>${escape(labels[index])}</b>${escape(t("tasksCount", values[index]))}`)}"/>`
            + `<text x="${x + slot * 0.32}" y="${y(values[index]) - 6}" text-anchor="middle" style="fill:var(--ink-2)">${values[index]}</text>`
            + `<text x="${x + slot * 0.32}" y="${height - 12}" text-anchor="middle">${escape(labels[index])}</text>`;
    }).join("");

    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${attribute(t("ageLabel"))}"><line x1="28" x2="${width}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>${bars}</svg>`;
}

/** The P1 tasks, the oldest first, each with who holds it and the day it was created. */
function urgentTasks(tasks, colleagues)
{
    const names = Object.fromEntries(colleagues.map((person) => [person.id, person.name.split(" ")[0]]));

    return tasks.filter((task) => task.priority === "P1").sort((first, second) => (first.created ?? "").localeCompare(second.created ?? ""))
        .map((task) => `<li><span class="tag" style="min-width:70px">${escape(names[task.owner] ?? task.owner)}</span><span style="color:var(--muted)">${formatDay(task.created)}</span> · <span class="clamp" style="display:inline">${escape(task.text)}</span></li>`).join("");
}

/** The colleagues, the busiest first: each with their portrait, role and a bar of their open todo. */
function colleagueCards(colleagues)
{
    const most = Math.max(1, ...colleagues.map((person) => person.open));

    return [...colleagues].sort((first, second) => second.open - first.open).map((person) => {
        const color = colors[person.color] ?? colors.gray;
        const portrait = person.hasPortrait ? `<img src="/portrait/${attribute(person.id)}" alt="">` : `<div class="avatar" style="background:${color}"></div>`;

        return `<div class="person" style="--person:${color}" data-tip="${attribute(`<b>${escape(person.name)}</b>${escape(person.role)}<br>${escape(t("crewTip", person.open, person.done))}`)}">
            ${portrait}
            <div style="min-width:0">
                <div class="name">${escape(person.name)}</div>
                <div class="role">${escape(person.role)}</div>
                <div class="bar"><i data-width="${(person.open / most) * 100}%"></i></div>
                <div class="open">${escape(t("crewOpen", person.open))}</div>
            </div>
        </div>`;
    }).join("");
}
