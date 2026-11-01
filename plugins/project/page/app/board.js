// The board's tab: a lane for each goal and a cell for each column, a card for each task; the cards are dragged or moved by keys in
// actions.js.

// The lanes opened or closed by hand, by goal, kept in the browser.
const lanesOpen = savedLanes();

/** The board: a column for each state, a lane for each goal of the plan in its order and, last, the tasks without one. */
function boardPanel()
{
    const tasks = boardTasks();
    const lanes = boardLanes(tasks);
    const head = boardStates.map((state) => {
        const count = tasks.filter((task) => columnOf(task) === state).length;
        const note = state === "done" ? `<span class="days">${escape(t("lastDays", data.boardDays))}</span>` : "";
        return `<div class="column-name"><i class="column-mark ${state}"></i>${escape(stateName(state))}<span class="badge">${count}</span>${note}</div>`;
    }).join("");

    return `<section class="card span-12">
            <h2>${t("boardTitle")}</h2>
            <p class="hint">${escape(t("boardHint", data.boardDays))}</p>
            <div class="board-head" aria-hidden="true">${head}</div>
            ${lanes.map(laneBlock).join("") || `<p class="hint">${t("boardEmpty")}</p>`}
        </section>`;
}

/** The backlog's tasks the board shows: the open ones, and the done ones of its last days. */
function boardTasks()
{
    const since = dayIso(-data.boardDays);

    return (data.board ?? []).filter((task) => columnOf(task) !== "done" || (task.done ?? task.archived ?? "9999") >= since);
}

/** The lanes: the plan's goals in its order, then the goals of tasks the plan no longer has, then the tasks without one; each with its
 * tasks and counts, the empty and the closed left out. */
function boardLanes(tasks)
{
    const goalOf = (task) => (task.goal && task.goal !== data.words.noGoal ? task.goal : "");
    const sections = data.plan.sections.filter((section) => section.name !== data.words.noGoal);
    const names = [...new Set([...sections.map((section) => section.name), ...tasks.map(goalOf).filter(Boolean), ""])];

    return names.map((name) => {
        const own = tasks.filter((task) => goalOf(task) === name);
        const section = sections.find((one) => one.name === name);
        const done = section?.done ?? own.filter((task) => columnOf(task) === "done").length;
        const total = section?.total ?? own.length;
        return { name, title: name ? section?.title ?? name : t("noGoalLane"), own, done, total, closed: section?.closed ?? null };
    }).filter((lane) => lane.own.length > 0 && !lane.closed);
}

/** A goal's lane: its name and bar, which open or fold it, over a cell for each column; open while it has open tasks, unless the user
 * chose. */
function laneBlock(lane)
{
    const percent = ratio(lane.done, lane.total);
    const working = lane.own.some((task) => task.state === "doing");
    const open = lanesOpen[lane.name] ?? lane.own.some((task) => columnOf(task) !== "done");
    const [, name, note] = /^(.*?)(?:\s*\((.*)\))?$/.exec(lane.title);
    const cells = boardStates.map((state) => laneCell(lane, state)).join("");

    return `<details class="lane" data-lane="${attribute(lane.name)}" ${open ? "open" : ""}>
            <summary>
                <span class="chevron" aria-hidden="true"></span>
                <span class="title"><b>${escape(name)}</b>${note ? ` <span>${escape(note)}</span>` : ""}</span>
                <div class="bar ${lane.done === lane.total && lane.total > 0 ? "done" : working ? "doing" : ""}" role="img" aria-label="${attribute(t("laneDone", lane.done, lane.total))}"><i data-width="${percent}%"></i></div>
                <span class="count" aria-hidden="true">${lane.done}/${lane.total}</span>
            </summary>
            <div class="lane-cells">${cells}</div>
        </details>`;
}

/** A lane's cell in one column: its cards in the panel's order, the done ones the latest first, each part under its large task. */
function laneCell(lane, state)
{
    const recent = (first, second) => latestClosed(first, second) || second.id - first.id;
    const own = withPartsUnder(lane.own.filter((task) => columnOf(task) === state).sort(state === "done" ? recent : taskOrder));
    const here = new Set(own.map((task) => taskName(task)));
    const label = `${stateName(state)} · ${lane.name || t("noGoalLane")}`;

    return `<div class="cell" data-state="${state}" data-lane="${attribute(lane.name)}">
            <div class="cell-name column-name" aria-hidden="true"><i class="column-mark ${state}"></i>${escape(stateName(state))}<span class="badge">${own.length}</span></div>
            <ul class="cell-list" aria-label="${attribute(label)}">${own.map((task) => taskCard(task, lane.name, Boolean(task.parent && here.has(task.parent)))).join("")}</ul>
        </div>`;
}

/** A task on the board: its priority, number, effort and who holds it; its text, which opens; where it can move, once it has the focus. */
function taskCard(task, lane, isUnder = false)
{
    const name = taskName(task);
    const column = columnOf(task);
    const worker = workerOf(task);
    const foot = worker !== null
        ? `<span class="work" data-tip="${attribute(escape(t("atWork")))}">⚒︎ ${escape(worker)}</span>`
        : column === "done" ? `<span>✓ ${escape(formatDay(task.done ?? task.archived))}${task.release ? ` · v${escape(task.release)}` : ""}</span>` : waitOrAge(task);
    const moves = boardStates.filter((state) => state !== column)
        .map((state) => `<button type="button" id="move-${name}-${state}" data-move="${state}" data-task="${task.id}" aria-label="${attribute(t("moveTo", name, stateName(state)))}">${escape(stateName(state))}</button>`).join("");

    return `<li class="task ${column} ${isUnder ? "part" : ""} ${expanded.has(`board-${name}`) ? "open" : ""} ${landed === task.id ? "landed" : ""}" draggable="true" data-task="${task.id}" data-lane="${attribute(lane)}" data-column="${column}">
            <div class="task-top">${typeIcon(task)}${priorityControl(task, "board")}<span class="id">${escape(name)}</span>${anotherMark(task)}<span class="grow"></span>${effortMeter(task)}${face(task)}</div>
            ${expandButton(`board-${name}`, escape(task.text))}
            ${taskLinks(task, isUnder)}
            <div class="task-foot">${foot}${fieldSpans(task)}</div>
            <div class="moves" role="group" aria-label="${attribute(t("moveGroup", name))}"><span aria-hidden="true">${escape(t("moveLabel"))}</span>${moves}</div>
        </li>`;
}

/** The lanes opened or closed by hand, as the browser keeps them; none where it keeps nothing. */
function savedLanes()
{
    try {
        return JSON.parse(localStorage.getItem("lanes") ?? "{}");
    } catch {
        return {};
    }
}

function saveLanes()
{
    try {
        localStorage.setItem("lanes", JSON.stringify(lanesOpen));
    } catch {
        // the choice lasts only this visit
    }
}
