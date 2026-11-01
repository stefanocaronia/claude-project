// The overview: the plan's ring and tiles, and its roadmap of phases with their epics, each opening its lane on the board; and the
// rhythm: the decisions, the commits and the tasks done per day.

// The colors of the repos' commits in the rhythm, one each.
const seriesColors = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-7)"];

/** The overview: the plan's ring; the tiles of the decisions, the points to decide, the commits, the version and the extensions'; the
 * roadmap. */
function overviewPanel()
{
    const { plan, decisions, activity } = data;
    const percent = ratio(plan.done, plan.total);
    const project = activity[0];
    const commits = project ? Object.values(project.days).reduce((sum, count) => sum + count, 0) : 0;

    return `<section class="card span-12">
            <div class="hero">
                ${ring(percent, t("ringCaption", plan.done, plan.total))}
                <div class="tiles">
                    ${tile(t("tileDecisions"), decisions.count, t("tileDecisionsSub", sumSince(decisions.byDay, 7)))}
                    ${tile(t("tileOpen"), decisions.open.length, t("tileOpenSub"))}
                    ${project ? tile(t("tileCommits"), commits, t("tileCommitsSub", project.name, Object.keys(project.days).length)) : ""}
                    ${data.releases ? tile(t("tileVersion"), data.releases.list[0] ? `v${data.releases.list[0].version}` : "—", t("tileVersionSub", data.releases.pending.length, data.releases.suggested.version)) : ""}
                    ${extensionParts("tiles")}
                </div>
            </div>
        </section>

        ${roadmap()}`;
}

/** The plan as a roadmap: the phases of its table in their order, each with its bar, what it lets you do, and its epics as cards in the
 * plan's order; the epics of no phase after, as the cross-cutting ones. */
function roadmap()
{
    const { plan } = data;
    const noGoal = data.words.noGoal;
    const epics = plan.sections.filter((section) => section.name !== noGoal);
    const phased = new Set(plan.phases.map((phase) => phase.number));
    const across = epics.filter((section) => !phased.has(section.phase));
    const loose = (data.board ?? []).filter((task) => (!task.goal || task.goal === noGoal) && columnOf(task) !== "done").length;
    const rows = plan.phases.map((phase) => phaseRow(phase, epics.filter((section) => section.phase === phase.number)));

    if (across.length) {
        const done = across.reduce((sum, section) => sum + section.done, 0);
        const total = across.reduce((sum, section) => sum + section.total, 0);
        rows.push(phaseRow({ number: null, name: t("acrossTitle"), outcome: "", done, total }, across));
    }

    return `<section class="card span-12">
            <h2>${t("planTitle")}</h2>
            <p class="hint">${t("planHint")}</p>
            <ol class="roadmap">${rows.join("")}</ol>
            ${loose ? `<p class="loose">${escape(t("looseTasks", loose))}<button type="button" data-go-lane="">${t("toBoard")}</button></p>` : ""}
        </section>`;
}

/** A phase of the roadmap: its node on the rail, its name, bar and progress in words, what it lets you do, and its epics. */
function phaseRow(phase, epics)
{
    const percent = ratio(phase.done, phase.total);
    // A phase is complete when its tasks are all done, or its goals all closed.
    const complete = phase.isClosed || (phase.total > 0 && phase.done === phase.total);
    const status = complete ? "complete" : phase.total === 0 ? "empty" : "active";
    const working = epics.some((section) => section.items.some((item) => item.state === "doing"));
    const progress = complete ? t("phaseClosed") : phase.total === 0 ? t("phaseNotStarted") : t("phaseProgress", phase.done, phase.total, percent);
    const node = phase.number === null ? "∗" : complete ? "✓" : phase.number;
    const label = phase.number === null ? escape(phase.name) : `<span>${escape(t("phase", phase.number))}</span> ${escape(phase.name)}`;
    const outcome = phase.outcome ? `<p class="outcome"><b>${t("phaseOutcome")}</b> ${escape(phase.outcome)}</p>` : phase.number === null ? `<p class="outcome">${t("acrossHint")}</p>` : "";

    return `<li class="phase-row ${status}">
            <div class="rail"><span class="node" aria-hidden="true">${node}</span></div>
            <div class="phase-body">
                <div class="phase-head">
                    <h3>${label}</h3>
                    <div class="phase-progress">${phase.total ? bar(percent, complete ? "done" : working ? "doing" : "", t("laneDone", phase.done, phase.total)) : "<span></span>"}<span>${escape(progress)}</span></div>
                </div>
                ${outcome}
                ${epics.length ? `<div class="epics">${epics.map(epicCard).join("")}</div>` : ""}
            </div>
        </li>`;
}

/** An epic of the plan: its name, what it is, its bar, its open tasks and those in progress; the card opens its lane on the board. */
function epicCard(section)
{
    const open = section.items.filter((item) => !item.done).length;
    const doing = section.items.filter((item) => item.state === "doing").length;
    const complete = section.total > 0 && section.done === section.total;
    const percent = ratio(section.done, section.total);
    const note = /\((.*)\)$/.exec(section.title)?.[1];
    const description = section.description ? `<p class="epic-text" data-tip="${attribute(escape(section.description))}">${escape(section.description)}</p>` : "";
    const counts = [doing ? `<span class="work">⚒︎ ${escape(t("epicDoing", doing))}</span>` : "", `<span>${escape(section.closed ? t("epicClosed", formatDay(section.closed)) : open ? t("epicOpen", open) : t("epicAllDone"))}</span>`].join("");

    return `<article class="epic ${doing ? "working" : ""} ${section.isUnplanned ? "out" : ""} ${section.closed ? "closed" : ""}">
            <h4><button type="button" class="epic-go" data-go-lane="${attribute(section.name)}" aria-label="${attribute(t("epicToBoard", section.name))}">${escape(section.name)}${section.isUnplanned ? `<span>· ${escape(t("outOfPlan"))}</span>` : note && section.phase === null ? `<span>· ${escape(note)}</span>` : ""}</button></h4>
            ${description}
            <div class="epic-bar">${bar(percent, complete ? "done" : doing ? "doing" : "", t("laneDone", section.done, section.total))}<span>${section.done}/${section.total}</span></div>
            <div class="epic-foot">${counts}<button type="button" class="to-tasks" data-go-tasks="${attribute(section.name)}">${t("epicTasks")}</button></div>
        </article>`;
}

/** Opens an epic's lane on the board, or, when the board has none, its tasks in the list. */
function goToLane(name)
{
    lanesOpen[name] = true;
    saveLanes();
    selectTab(document.getElementById("tab-board"));
    const lane = [...document.querySelectorAll("details.lane")].find((one) => one.dataset.lane === name);

    if (!lane) {
        goToTasks(name, "all");
        return;
    }

    lane.open = true;
    lane.scrollIntoView({ block: "start" });
    lane.querySelector("summary").focus({ preventScroll: true });
}

/** A goal's tasks in the list, the open ones unless asked otherwise, of any priority and anyone's. */
function goToTasks(name, state = "open")
{
    Object.assign(taskFilter, { state, priority: "all", who: "all", goal: name || "all" });
    selectTab(document.getElementById("tab-tasks"));
    refreshTaskList("filter-goal");
}

/** The rhythm: the decisions, the commits of each repo and the tasks done per day, on the axis the charts share; then the extensions'. */
function rhythmPanel()
{
    const { plan, decisions, activity } = data;
    const repos = activity.map((repo, index) => ({ name: repo.name, color: seriesColors[index % seriesColors.length], values: repo.days }));
    const legend = repos.length > 1 ? `<div class="legend">${repos.map((repo) => `<span><i style="background:${repo.color}"></i>${escape(repo.name)}</span>`).join("")}</div>` : "";

    return `<section class="card span-6">
            <h2>${t("rhythmDecisions")}</h2>
            <p class="hint">${t("rhythmDecisionsHint")}</p>
            ${dayBars(days, [{ name: t("seriesDecisions"), color: "var(--series-7)", values: decisions.byDay }], 190)}
        </section>

        <section class="card span-6">
            <h2>${t("rhythmCommits")}</h2>
            ${legend}
            ${dayBars(days, repos, 190)}
        </section>

        <section class="card span-6">
            <h2>${t("rhythmDone")}</h2>
            <p class="hint">${t("rhythmDoneHint")}</p>
            ${dayBars(days, [{ name: t("seriesDone"), color: "var(--series-3)", values: plan.finishedByDay }], 190)}
        </section>
        ${extensionParts("rhythm")}`;
}
