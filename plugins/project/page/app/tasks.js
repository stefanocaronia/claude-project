// The tasks' tab: the list with its filters, the GitHub issues and pull requests, the open tasks by owner, age and urgency, and the
// colleagues. A task itself is drawn by task.js.

// The list's filters, and what they are when none is set.
const noFilter = { state: "open", priority: "all", type: "all", who: "all", goal: "all" };
const taskFilter = { ...noFilter };

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
        ${pullsCard()}

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
        <label>${t("filterWho")} <select id="filter-who" data-task-filter="who">${option("who", "all", t("anyone"))}${people.map((person) => option("who", person, holderName(person))).join("")}</select></label>
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

/** The open pull requests no task does yet (D-17), each a link with who opened it and the buttons that take it into the backlog or close
 * it on GitHub, marked when its title reads like an instruction; nothing without them. */
function pullsCard()
{
    const pulls = data.pulls ?? [];

    if (!pulls.length) {
        return "";
    }

    const mark = (pull) => (pull.instruction ? `<span style="color:var(--warning)" title="${attribute(t("issuesInstruction"))}">⚠</span> ` : "");
    const rows = pulls.map((pull) => `<li class="issue-row"><span>${mark(pull)}${webUrl(pull.url) ? `<a href="${attribute(pull.url)}" target="_blank" rel="noopener"><b>#${pull.number}</b> ${escape(pull.title)}</a>` : `<b>#${pull.number}</b> ${escape(pull.title)}`} <span class="hint">${escape(pull.author ?? "?")}${pull.bot ? ` · ${escape(t("pullBot"))}` : ""}</span></span><span><button type="button" id="pull-take-${pull.number}" data-take-pull="${pull.number}" data-title="${attribute(pull.title)}">${escape(t("issueToBacklog"))}</button> <button type="button" id="pull-close-${pull.number}" data-close-pull="${pull.number}">${escape(t("pullClose"))}</button></span></li>`).join("");
    return `<section class="card span-12">
            <h2>${escape(t("pullsTitle"))} <span class="badge">${pulls.length}</span></h2>
            <p class="hint">${escape(t("pullsHint"))}</p>
            ${pulls.some((pull) => pull.instruction) ? `<p class="hint" style="color:var(--warning)">${escape(t("issuesInstruction"))}</p>` : ""}
            <ul class="issues">${rows}</ul>
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
        const label = names[owner] ?? holderName(owner);
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
        .map((task) => `<li><span class="tag" style="min-width:70px">${escape(names[task.owner] ?? holderName(task.owner))}</span><span style="color:var(--muted)">${formatDay(task.created)}</span> · <span class="clamp" style="display:inline">${escape(task.text)}</span></li>`).join("");
}

/** The colleagues, the busiest first: each with their portrait, role and a bar of their open todo. */
function colleagueCards(colleagues)
{
    const most = Math.max(1, ...colleagues.map((person) => person.open));

    return [...colleagues].sort((first, second) => second.open - first.open).map((person) => {
        const color = person.color ?? colors.gray;
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
