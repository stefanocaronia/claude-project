// What the user changes from the page: a task written in the list's form, moved, its priority turned, each through the backlog's command
// on the server; and the one set of listeners for every tab's buttons, menus, searches and drags.

// The backlog's command that moves a task into each column.
const moveCommands = { doing: "start", todo: "todo", postponed: "postpone", done: "done" };
// The specs a new task cites, when a spec's ＋ opened the form.
let newTaskSpecs = "";

/** Puts the page's hands on its tabs once, on the element that holds them: every tab's buttons, the menus and the searches, the lanes
 * opened by hand, the cards' drags. */
function setupActions()
{
    const app = document.getElementById("app");

    app.addEventListener("click", (event) => {
        const target = event.target.closest?.("button");

        if (!target) {
            return;
        }

        if (target.dataset.move) {
            moveTask(target.dataset.task, target.dataset.move, true);
        } else if (target.dataset.priority) {
            turnPriority(target.dataset.priority, target.dataset.next, target.id);
        } else if (target.dataset.expand) {
            toggleText(target);
        } else if (target.dataset.taskFilter) {
            taskFilter[target.dataset.taskFilter] = target.dataset.value;
            refreshTaskList(target.id);
        } else if (target.hasAttribute("data-clear-filters")) {
            Object.assign(taskFilter, noFilter);
            refreshTaskList("filter-state-open");
        } else if (target.dataset.fold) {
            const task = data.board.find((one) => String(one.id) === target.dataset.fold);
            folds[task.id] = !isUnfolded(task);
            // The focus stays on the chip pressed, in its own tab: the board and the list each draw one.
            const panel = target.closest("[id^='panel-']")?.id;
            render();
            document.querySelector(`#${panel} [data-fold="${task.id}"]`)?.focus();
        } else if (target.hasAttribute("data-new-task")) {
            openTaskForm("new");
        } else if (target.dataset.editTask) {
            openTaskForm(Number(target.dataset.editTask));
        } else if (target.dataset.saveTask) {
            saveTask(target.dataset.saveTask);
        } else if (target.dataset.commentTask) {
            commentTask(Number(target.dataset.commentTask));
        } else if (target.dataset.editComment) {
            editComment(target.dataset.editComment);
        } else if (target.dataset.saveComment) {
            changeComment(target.dataset.saveComment, false);
        } else if (target.dataset.deleteComment) {
            changeComment(target.dataset.deleteComment, true);
        } else if (target.hasAttribute("data-cancel-task")) {
            editing = null;
            newTaskSpecs = "";
            document.getElementById("task-list").innerHTML = taskListBody();
            reload();
        } else if (target.dataset.archiveTask) {
            const name = taskName({ id: target.dataset.archiveTask });

            if (confirm(t("archiveConfirm", name))) {
                editing = null;
                changeTask({ command: "archive", id: name }, t("taskArchived", name));
            }
        } else if (target.hasAttribute("data-tidy-backlog")) {
            // The backlog's tidying runs from the cleanup, in the Health tab, where its proposals show.
            selectTab(document.getElementById("tab-health"));
            tidyAction("backlog", { cost: null });
        } else if (target.dataset.takePull) {
            changeTask({ command: "pull", pull: target.dataset.takePull, title: target.dataset.title }, t("pullTaken", target.dataset.takePull));
        } else if (target.dataset.closePull) {
            if (confirm(t("pullCloseConfirm", target.dataset.closePull))) {
                changeTask({ command: "pull-close", pull: target.dataset.closePull }, t("pullClosed", target.dataset.closePull));
            }
        } else if (target.dataset.takeIssue) {
            changeTask({ command: "issue", issue: target.dataset.takeIssue, title: target.dataset.title }, t("issueTaken", target.dataset.takeIssue));
        } else if (target.dataset.takeTitle) {
            changeTask({ command: "set", id: target.dataset.takeTitle, text: target.dataset.title }, t("titleTaken", target.dataset.takeTitle));
        } else if (target.dataset.keepTitle) {
            changeTask({ command: "keep-title", issue: target.dataset.keepTitle }, t("titleKept", target.dataset.keepTitle));
        } else if (target.dataset.goLane !== undefined) {
            goToLane(target.dataset.goLane);
        } else if (target.dataset.goTasks !== undefined) {
            goToTasks(target.dataset.goTasks);
        } else if (target.dataset.document) {
            openDocument(Number(target.dataset.document), target);
        } else if (target.id === "decisions-more") {
            const first = matchingDecisions()[decisionLimit];
            decisionLimit += 100;
            document.getElementById("decision-list").innerHTML = decisionListBody();
            document.getElementById(first ? `decision-${first.number}` : "decision-search")?.focus();
        } else if (target.dataset.specFilter) {
            specFilter = target.dataset.specFilter;
            refreshSpecs(target.id);
        } else if (target.dataset.newSpecTask) {
            // A task for a spec: the list's form, opened in the tasks' tab, citing it.
            newTaskSpecs = target.dataset.newSpecTask;
            selectTab(document.getElementById("tab-tasks"));
            openTaskForm("new");
        } else if (target.dataset.goSpec) {
            selectTab(document.getElementById("tab-specs"));
            document.getElementById(`spec-${target.dataset.goSpec.split("-").at(-1)}`)?.scrollIntoView({ block: "center" });
        } else if (target.dataset.goTask) {
            // A task a spec names, in the list of all the tasks, brought into view.
            Object.assign(taskFilter, noFilter, { state: "all" });
            selectTab(document.getElementById("tab-tasks"));
            refreshTaskList();
            document.getElementById(`list-task-${target.dataset.goTask.split("-").at(-1)}`)?.scrollIntoView({ block: "center" });
        }
    });
    app.addEventListener("change", (event) => {
        if (event.target.matches?.("select[data-task-filter]")) {
            taskFilter[event.target.dataset.taskFilter] = event.target.value;
            refreshTaskList(event.target.id);
        }
    });
    app.addEventListener("input", (event) => {
        if (event.target.id === "decision-search") {
            decisionQuery = event.target.value;
            decisionLimit = decisionsShown;
            document.getElementById("decision-list").innerHTML = decisionListBody();
            const found = foundLine(matchingDecisions().length);
            document.getElementById("decision-found").textContent = found;
            announce(found, 600);
        } else if (event.target.id === "spec-search") {
            specQuery = event.target.value;
            refreshSpecs();
        }
    });
    // A goal's lane, opened or closed by hand, stays so; toggle does not bubble, so it is caught on its way down.
    app.addEventListener("toggle", (event) => {
        if (event.target.matches?.("details.lane")) {
            lanesOpen[event.target.dataset.lane] = event.target.open;
            saveLanes();
        }
    }, true);
    app.addEventListener("dragstart", (event) => {
        const card = event.target.closest?.(".task[draggable]");

        if (!card) {
            return;
        }

        dragging = { card, id: card.dataset.task, lane: card.dataset.lane, from: card.dataset.column };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", taskName({ id: card.dataset.task }));
        requestAnimationFrame(() => card.classList.add("dragging"));
        document.querySelectorAll(".cell").forEach((cell) => cell.classList.toggle("can-drop", cell.dataset.lane === dragging.lane && cell.dataset.state !== dragging.from));
    });
    app.addEventListener("dragover", (event) => {
        const cell = dragging && event.target.closest?.(".cell.can-drop");

        if (cell) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        }

        document.querySelectorAll(".cell.target").forEach((other) => other !== cell && other.classList.remove("target"));
        cell?.classList.add("target");
    });
    app.addEventListener("drop", (event) => {
        const cell = dragging && event.target.closest?.(".cell.can-drop");

        if (!cell) {
            return;
        }

        event.preventDefault();
        dragging.card.classList.add("pending");
        cell.querySelector(".cell-list").prepend(dragging.card);
        dragging.dropped = cell.dataset.state;
    });
    app.addEventListener("dragend", () => {
        const { card, id, dropped } = dragging ?? {};
        card?.classList.remove("dragging");
        document.querySelectorAll(".cell.can-drop, .cell.target").forEach((cell) => cell.classList.remove("can-drop", "target"));
        dragging = null;

        if (dropped) {
            moveTask(id, dropped, false);
        } else if (renderWaits) {
            renderWaits = false;
            render();
        }
    });
}

/** A task written in the list, new or one there: its text, goal, priority, type, who holds it, when it is due, the project's own fields,
 * the large task it is a part of and the specs it does; save, cancel and, for one there, archive; then its comments, with a field for
 * another. */
function taskForm(task)
{
    const id = task ? task.id : "new";
    const option = (value, label, chosen) => `<option value="${attribute(value)}" ${value === chosen ? "selected" : ""}>${escape(label)}</option>`;
    const goals = [...new Set([data.words.noGoal, ...(data.plan.openGoals ?? []), ...(task ? [task.goal] : [])])];
    const people = [...new Set([...(data.people ?? []), ...data.colleagues.map((person) => person.short ?? person.name), ...(task ? [task.to] : [])])];
    const types = ["", ...Object.keys(data.types ?? {})];
    // A large task takes parts one level deep: the open tasks that are no part themselves, nor this task.
    const parents = ["", ...(data.board ?? []).filter((one) => !one.parent && columnOf(one) !== "done" && one.id !== task?.id && !(task?.parts ?? []).length).map((one) => taskName(one))];
    const parentLabel = (name) => {
        const one = (data.board ?? []).find((each) => taskName(each) === name);
        return one ? `${name} · ${one.text.length > 50 ? `${one.text.slice(0, 50)}…` : one.text}` : name;
    };
    const field = (key, label, control) => `<label class="form-field"><span>${escape(label)}</span>${control}</label>`;

    return `<li class="row task-form" data-form="${id}">
            <span></span><span></span>
            <div>
                <textarea id="form-text-${id}" rows="2" placeholder="${attribute(t("taskTextHint"))}">${escape(task?.text ?? "")}</textarea>
                <div class="form-fields">
                    ${field("goal", t("filterGoal"), `<select id="form-goal-${id}">${goals.map((goal) => option(goal, goal === data.words.noGoal ? t("noGoalLane") : goal, task?.goal ?? data.words.noGoal)).join("")}</select>`)}
                    ${field("priority", t("filterPriority"), `<select id="form-priority-${id}">${["P1", "P2", "P3"].map((key) => option(key, priorityName(key), task?.priority ?? "P2")).join("")}</select>`)}
                    ${field("type", t("filterType"), `<select id="form-type-${id}">${types.map((key) => option(key, key ? data.types[key] : "—", task?.type ?? "")).join("")}</select>`)}
                    ${field("to", t("filterWho"), `<select id="form-to-${id}">${people.map((person) => option(person, person, task?.to ?? people[0])).join("")}</select>`)}
                    ${field("due", t("linkDue"), `<input type="date" id="form-due-${id}" value="${attribute(task?.due ?? "")}">`)}
                    ${Object.entries(data.fields ?? {}).map(([key, own]) => field(key, own.name, own.values
                        ? `<select id="form-field-${key}-${id}">${["", ...own.values].map((value) => option(value, value || "—", task?.fields?.[key] ?? "")).join("")}</select>`
                        : `<input type="text" id="form-field-${key}-${id}" value="${attribute(task?.fields?.[key] ?? "")}">`)).join("")}
                    ${(task?.parts ?? []).length ? "" : field("parent", t("linkPartOf"), `<select id="form-parent-${id}">${[...new Set([...parents, ...(task?.parent ? [task.parent] : [])])].map((name) => option(name, name ? parentLabel(name) : "—", task?.parent ?? "")).join("")}</select>`)}
                    ${data.specs ? field("specs", t("linkSpecs"), `<input type="text" id="form-specs-${id}" list="spec-ids" value="${attribute(task ? (task.specs ?? []).join(", ") : newTaskSpecs)}" placeholder="${attribute(`${data.prefixes.spec}-12, ${data.prefixes.spec}-14`)}"><datalist id="spec-ids">${data.specs.list.filter((spec) => spec.state !== "dropped").map((spec) => `<option value="${attribute(spec.id)}">${escape(spec.text.slice(0, 80))}</option>`).join("")}</datalist>`) : ""}
                </div>
                <div class="actions">
                    <button type="button" class="action primary" data-save-task="${id}">${t("saveTask")}</button>
                    <button type="button" class="action" data-cancel-task>${t("cancelEdit")}</button>
                    ${task ? `<button type="button" class="action" data-archive-task="${task.id}">${t("archiveTask")}</button>` : ""}
                </div>
                ${task ? taskComments(task) : ""}
            </div>
            <span></span>
        </li>`;
}

/** The comments left on a task, the oldest first, each with who wrote it and when: the user's, a colleague's, Claude's, each written
 * again in its place or deleted; then a field for the user's own. */
function taskComments(task)
{
    const left = (task.comments ?? []).map((comment, index) => `<div class="comment" id="comment-${task.id}-${index + 1}"><b>${escape(comment.by)}</b> <span class="comment-day">${escape(formatDay(comment.day))}</span>
                    <button type="button" class="link-button" data-edit-comment="${task.id}-${index + 1}" title="${attribute(t("commentEdit"))}">✎</button>
                    <button type="button" class="link-button" data-delete-comment="${task.id}-${index + 1}" title="${attribute(t("commentDelete"))}">🗑</button>
                    <p>${escape(comment.text)}</p></div>`);
    return `<div class="task-comments">
                    ${left.join("")}
                    <textarea id="form-comment-${task.id}" rows="2" placeholder="${attribute(t("commentHint"))}"></textarea>
                    <div class="actions"><button type="button" class="action" data-comment-task="${task.id}">${t("commentSend")}</button></div>
                </div>`;
}

/** A comment written again in its place: its text in a field, saved through the backlog's command. */
function editComment(which)
{
    const [id, number] = which.split("-").map(Number);
    const comment = data.board.find((task) => task.id === id)?.comments?.[number - 1];
    const box = document.getElementById(`comment-${which}`);

    if (!comment || !box) {
        return;
    }

    box.querySelector("p").outerHTML = `<textarea id="comment-field-${which}" rows="2">${escape(comment.text)}</textarea>
                    <div class="actions"><button type="button" class="action" data-save-comment="${which}">${t("commentSave")}</button></div>`;
    document.getElementById(`comment-field-${which}`)?.focus();
}

/** Saves a comment written again, or deletes one on the user's yes; then opens the task's form again. */
async function changeComment(which, isDelete)
{
    const [id, number] = which.split("-").map(Number);
    const name = taskName({ id });

    if (isDelete) {
        if (!confirm(t("commentDeleteConfirm", name))) {
            return;
        }

        editing = null;
        await changeTask({ command: "comment-delete", id: name, number }, t("commentDeleted", name));
    } else {
        const text = document.getElementById(`comment-field-${which}`)?.value.trim() ?? "";

        if (!text) {
            return;
        }

        editing = null;
        await changeTask({ command: "comment-edit", id: name, number, text }, t("commentChanged", name));
    }

    openTaskForm(id);
}

/** Adds the user's comment to a task through the backlog's command, then opens its form again with the comment in it. */
async function commentTask(id)
{
    const field = document.getElementById(`form-comment-${id}`);
    const text = field?.value.trim() ?? "";

    if (!text) {
        field?.focus();
        return;
    }

    const name = taskName({ id });
    editing = null;
    await changeTask({ command: "comment", id: name, text }, t("commentAdded", name));
    openTaskForm(id);
    document.getElementById(`form-comment-${id}`)?.focus();
}

/** Opens the list's form for a new task ("new") or for one there (its number), its text in focus; the page does not draw itself again
 * while it is open. */
function openTaskForm(which)
{
    editing = which;
    document.getElementById("task-list").innerHTML = taskListBody();
    document.getElementById(`form-text-${which}`)?.focus();
}

/** Saves a task written in the list: a new one added, one there changed in what changed. */
async function saveTask(id)
{
    const value = (field) => document.getElementById(`form-${field}-${id}`)?.value ?? "";
    const text = value("text").trim();

    if (!text) {
        alert(t("taskTextHint"));
        return;
    }

    const task = id === "new" ? null : data.board.find((one) => String(one.id) === String(id));
    const fields = { text, goal: value("goal"), priority: value("priority"), type: value("type"), to: value("to"), due: value("due"), parent: value("parent") };
    // The project's own fields, by key: those that changed for a task there, those given for a new one; "" clears one.
    const own = Object.keys(data.fields ?? {}).map((key) => [key, value(`field-${key}`).trim()]);
    fields.fields = Object.fromEntries(own.filter(([key, given]) => given !== (task?.fields?.[key] ?? "")));

    // A part without a goal of its own takes its large task's.
    if (fields.parent && fields.goal === data.words.noGoal) {
        fields.goal = data.board.find((one) => taskName(one) === fields.parent)?.goal ?? fields.goal;
    }

    const changed = task ? Object.fromEntries(Object.entries(fields).filter(([key, current]) => (key === "fields" ? Object.keys(current).length > 0 : current !== String((key === "priority" ? task.priority : task[key]) ?? "")))) : fields;
    // The specs it does go in its see, beside the tasks and decisions it points to; written only when they changed.
    const specs = (value("specs").match(new RegExp(`\\b${data.prefixes.spec}-\\d+\\b`, "gi")) ?? []).map((one) => one.toUpperCase());

    if (data.specs && specs.join(", ") !== (task?.specs ?? []).join(", ")) {
        changed.see = [...(task?.see ?? []), ...new Set(specs)].join(", ");
    }

    newTaskSpecs = "";
    editing = null;

    if (task && Object.keys(changed).length === 0) {
        await reload();
        return;
    }

    await changeTask(task ? { command: "set", id: taskName(task), ...changed } : { command: "add", ...fields }, task ? t("taskSaved", taskName(task)) : t("taskAdded"));
}

/** Moves a task to a column through the backlog's command; from the keys, the focus follows the card to its new column. */
function moveTask(id, state, byKeys)
{
    const task = data.board.find((one) => String(one.id) === String(id));

    if (!task || columnOf(task) === state) {
        return;
    }

    const name = taskName(task);
    focusAfter = byKeys ? { id: `board-${name}`, scroll: true } : null;
    landed = task.id;
    changeTask({ command: moveCommands[state], id: name }, t("moved", name, stateName(state)));
}

/** Turns a task's priority to the next through the backlog's command, the focus kept on its button. */
function turnPriority(id, next, buttonId)
{
    const name = taskName({ id });
    focusAfter = { id: buttonId };
    changeTask({ command: "set", id: name, priority: next }, t("priorityNow", name, priorityName(next)));
}

/** Asks the page's server to change the backlog; a refusal is shown with its message. The page reads the project again after. */
async function changeTask(payload, done)
{
    let answer;

    try {
        const response = await fetch("/backlog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        answer = await response.json().catch(() => ({ ok: false, message: `${response.status} ${response.statusText}` }));
    } catch (error) {
        answer = { ok: false, message: String(error?.message ?? error) };
    }

    if (answer.ok) {
        announce(done);
    } else {
        focusAfter = null;
        landed = null;
        alert(t("failed", answer.message));
    }

    renderWaits = false;
    await reload();
}

/** Opens or closes a text that opens; a decision is drawn again, with its reasons or without. */
function toggleText(button)
{
    const id = button.dataset.expand;
    const open = !expanded.has(id);
    open ? expanded.add(id) : expanded.delete(id);
    button.setAttribute("aria-expanded", open);
    button.closest(".task")?.classList.toggle("open", open);

    // A decision's reasons show only while it is open.
    if (id.startsWith("decision-")) {
        document.getElementById("decision-list").innerHTML = decisionListBody();
        document.getElementById(id)?.focus();
    }
}

/** The list and its filters drawn again, the focus where asked, and how many tasks it shows said to a screen reader. */
function refreshTaskList(focusId)
{
    document.getElementById("task-filters").innerHTML = taskFilters();
    document.getElementById("task-list").innerHTML = taskListBody();
    document.getElementById(focusId)?.focus();
    announce(t("listCount", filteredTasks().length));
}
