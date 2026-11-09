// A task as the page draws it, on the board and in the list: its marks (type, priority, effort, who holds it), its waits and links in
// words, the panel's order.

// The states in the list's order, and the board's columns in theirs; the turn of a priority and its rank, as the panel's; the priorities of the chart by owner.
const boardStates = ["doing", "todo", "postponed", "done"];
const boardColumns = ["todo", "doing", "done", "postponed"];
const nextPriority = { P1: "P2", P2: "P3", P3: "P1" };
const priorityRank = { P1: 1, P2: 2, P3: 3 };
const priorityOrder = ["P1", "P2", "P3", "none"];
const priorityColors = { P1: "#184f95", P2: "#3987e5", P3: "#9ec5f4", none: "var(--never)" };
// Crew's marks: a priority as an issue tracker draws it, the effort as four bars, Claude's critter.
const priorityMarks = {
    P1: `<path d="M3.5 7.5L7 4l3.5 3.5M3.5 11L7 7.5l3.5 3.5" stroke="#E5493A"/>`,
    P2: `<path d="M3 5.5h8M3 8.5h8" stroke="#E2852B"/>`,
    P3: `<path d="M3.5 5.5L7 9l3.5-3.5" stroke="#4C8FE0"/>`,
};
const effortBars = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };
const critter = claudeCritter();
// The colors of the task types, as Jira's issue types (lib/schedule.mjs).
const typeColors = { bug: "#E5493A", feature: "#36B37E", chore: "#4C9AFF", research: "#8777D9", test: "#E2852B" };
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

/** Claude as the backlog writes them, the first of the people. */
function claudeOf()
{
    return (data.people ?? [])[0] ?? "Claude";
}

/** A holder's name as the page shows it: Claude's is the coordinator's, where Crew hired one, as they are one person (D-18); a
 * colleague's as their profile writes it, whatever case or accents the task gave it (Nicolo is Nicolò). */
function holderName(name)
{
    if (name === claudeOf() && data.coordinator) {
        return data.coordinator.name;
    }

    const held = (data.board ?? []).find((task) => task.to === name && task.colleague);
    return (held && data.colleagues.find((one) => one.id === held.colleague)?.short) ?? name;
}

/** Who holds a task: Claude, or the coordinator Crew hired in their place, with the coordinator's portrait, else Claude's critter; a
 * colleague's portrait or initials on their color, a person's GitHub picture or initials in gray. */
function face(task)
{
    const isClaude = !task.colleague && task.to === claudeOf();
    const person = task.colleague ? data.colleagues.find((one) => one.id === task.colleague) : isClaude ? data.coordinator ?? null : null;
    const name = person?.name ?? task.to;
    // Claude's role, the coordinator's where their heading gives none: your assistant, as Crew says it.
    const role = person?.role || (isClaude ? t("claudeRole") : "");
    const tip = `data-tip="${attribute(`<b>${escape(name)}</b>${escape(role)}`)}"`;

    if (isClaude && !person?.hasPortrait) {
        return `<span class="face" role="img" aria-label="${attribute(name)}" ${tip}>${critter}</span>`;
    }

    if (person?.hasPortrait) {
        return `<img class="face" src="/portrait/${attribute(person.id)}" alt="${attribute(name)}" ${tip}>`;
    }

    // The owner's GitHub picture, on their tasks and on every decision.
    if (data.owner?.href && task.to === data.owner.name) {
        return `<img class="face" src="${attribute(data.owner.href)}" alt="${attribute(data.owner.fullName)}" data-tip="${attribute(`<b>${escape(data.owner.fullName)}</b>`)}">`;
    }

    // Another person's GitHub picture, where the configuration gives their login.
    const picture = !person ? (data.faces ?? []).find((one) => one.name === task.to) : null;

    if (picture) {
        return `<img class="face" src="${attribute(picture.href)}" alt="${attribute(name)}" ${tip}>`;
    }

    const initials = String(name).split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
    // A colleague's color, as the data gives it; a person without a profile in gray.
    const color = person?.color ?? colors.gray;

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

    // Started by another person of the project, who works on it on their machine.
    if (task.startedByOther && task.started) {
        const said = t("startedByTip", formatDay(task.started), task.startedBy);
        return `<span class="wait" data-tip="${attribute(escape(said))}"><span aria-hidden="true">▸ ${escape(task.startedBy)}</span><span class="visually-hidden">${escape(said)}</span></span>`;
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
        task.started && task.state === "doing" ? `<span><b>${escape(t("linkStarted"))}</b> ${escape(formatDay(task.started))}${task.startedBy ? `, ${escape(t("startedBy", task.startedBy))}` : ""}</span>` : "",
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
