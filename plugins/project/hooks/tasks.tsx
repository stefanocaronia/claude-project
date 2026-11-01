// The tasks' lists, in progress, to do and postponed: each task a card with who holds it, its type, its priority (a press turns it), its
// number and title (a press opens it), its age or what it waits for, its effort and its ▶; a large task with its parts under it; and in
// the list to do, a new task to write.
import type { EngineInterface } from "claude-code";

import type { Task } from "../types";

import { typeColor } from "../lib/schedule.mjs";
import { taskDetails } from "./details.tsx";
import { addMark, effortMeters, effortSvg, errorColor, idleColor, markOf, prioritySvg, stateLayer, taskColor, typeSvg, warningColor, workColor, workMark } from "./draw.ts";
import { noChoice, oneLine } from "./kit.tsx";
import type { Panel } from "./kit.tsx";
import { backlog } from "./project.ts";
import { startChain, startTask } from "./start.ts";
import { changeView } from "./state.ts";

const nextPriority: Record<string, string | undefined> = { P1: "P2", P2: "P3", P3: "P1" };
// How long the lists keep their order after a priority turns.
const frozenFor = 4000;
// The text of a new task being written: kept across the drawings its pickers cause, not across a reload.
let newText = "";

export function taskLists($: EngineInterface, p: Panel)
{
    const { Box, Text, Button, Input, Select, hasForms, Svg, isDesktop, board, view, snapshot, now, words, prefix, idOf, byName, partsOf, decider, change, limited, isStarting, age, dueWords, rowText, opener, card, section, more, tip, ground, iconButton, face, priorityIcon, isWorking } = p;
    const details = taskDetails($, p);
    const indent = isDesktop ? 4 : 2;
    // A part shows under its large task, whatever its state; on its own only when its large task is not open.
    const shownIds = new Set(snapshot.tasks.map(idOf));
    const isGrouped = (task: Task) => Boolean(task.parent && shownIds.has(task.parent));
    const doing = snapshot.tasks.filter((task) => task.state === "doing" && !isGrouped(task));
    // The task this chat is at work on, itself and not through a colleague: while it holds one, it starts no other.
    const busyWith = doing.concat(snapshot.tasks.filter(isGrouped)).find((task) => {
        const held = board.holds[String(task.id)];
        return task.state === "doing" && held && held.session === board.session && !held.colleague;
    });
    // Everything still to do, as Crew's backlog lists it: by priority, then the oldest; the postponed after. A large task stands where the
    // most urgent of its open parts would: their priority, then the oldest.
    const order = new Map(snapshot.tasks.map((task) => [task.id, `${task.state === "postponed" ? 1 : 0}${[task, ...partsOf(task)].map((one) => `${one.priority}${one.created}`).sort()[0]}`]));
    // Just after a priority turns, the lists keep the order they had, so that the task stays under the pointer; then they sort again.
    const frozen = view.frozen && now < view.frozen.until ? view.frozen.rank : null;
    const byOrder = (first: Task, second: Task) => (frozen ? (frozen[String(first.id)] ?? Number.MAX_SAFE_INTEGER) - (frozen[String(second.id)] ?? Number.MAX_SAFE_INTEGER) : 0)
        || (order.get(first.id) ?? "").localeCompare(order.get(second.id) ?? "") || first.id - second.id;
    const rest = snapshot.tasks.filter((task) => task.state === "todo" && !isGrouped(task)).sort(byOrder);
    // The postponed in a section of their own, after the tasks to do, in the same order.
    const postponed = snapshot.tasks.filter((task) => task.state === "postponed" && !isGrouped(task)).sort(byOrder);
    // Where each task stands now, the parts after their large task: what a priority's turn keeps for a moment.
    const shownRank = new Map([...rest, ...postponed].flatMap((task) => [task, ...[...partsOf(task)].sort(byOrder)]).map((task, index) => [task.id, index]));
    // What the button above the lists starts: the first task someone here can start. A blocked task is skipped: its chain starts from its
    // own ▶.
    const nextTask = busyWith ? undefined : rest.find((task) => task.state === "todo" && !isBlocked(task) && !isLarge(task) && (task.to === "Claude" || byName.has(task.to)));

    // A press on a task's priority turns it, P1, P2, P3 and P1 again: a clear button laid over the drawn mark takes the press.
    const priorityMark = (task: Task) => {
        const turn = async () => {
            await freezeOrder($, Object.fromEntries(snapshot.tasks.map((one) => [String(one.id), shownRank.get(one.id) ?? Number.MAX_SAFE_INTEGER])));
            await backlog($, ["set", idOf(task), "--p", nextPriority[task.priority] ?? "P1"]);
        };

        if (!Svg || !prioritySvg(task.priority)) {
            return <Button key={`priority-${task.id}`} plain label={markOf(task.priority).glyph} onPress={turn} />;
        }

        return (
            <Box key={`priority-box-${task.id}`} flexShrink={0}>
                {priorityIcon(task.priority)}
                <Box position="absolute" top={0} left={0}>
                    <Button key={`priority-${task.id}`} plain label={" "} onPress={turn} />
                </Box>
            </Box>
        );
    };
    const effortCell = (task: Task) => {
        const drawn = Svg ? effortSvg(task.effortKey) : undefined;
        return (
            <Box key={`effort-${task.id}`} width={4} flexShrink={0} justifyContent="flex-end" alignItems="center">
                {drawn && Svg ? <Svg source={drawn} alt={task.effort} width={16} height={12} /> : <Text dimColor>{effortMeters[task.effortKey] ?? ""}</Text>}
            </Box>
        );
    };
    // A task's type as Jira draws it, its name under the pointer; nothing for a task without one.
    const typeMark = (task: { id: number; type?: string | null }) => {
        if (!task.type) {
            return null;
        }

        const name = snapshot.types?.[task.type] ?? task.type;
        const mark = <Box key={`type-${task.id}`} flexShrink={0}>{Svg ? <Svg source={typeSvg(task.type, typeColor(task.type))} alt={name} width={14} height={14} /> : <Text color={typeColor(task.type)}>■</Text>}</Box>;
        return tip(`type-${task.id}`, name, mark);
    };
    // A ▶ that cannot be pressed now stays in its place, gray, its reason under the pointer.
    const idle = (task: Task, reason: string) => tip(`idle-${task.id}`, reason, <Box key={`idle-${task.id}`} flexShrink={0}><Text color={idleColor}>▶</Text></Box>);
    // A ▶ writes to this chat: while its turn runs, it waits.
    const play = (task: Task, onPress: () => Promise<void>) => (isWorking ? idle(task, words("busyTurn")) : <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={onPress} />);
    const start = (task: Task) => {
        const member = byName.get(task.to);

        // A chat at work on a task starts no other: another task is for a new session of the project.
        if (busyWith && busyWith.id !== task.id) {
            return idle(task, words("playBusy", { id: idOf(busyWith) }));
        }

        // A large task is done through its parts: its ▶ starts the next one, by priority and age, free and to do.
        if (isLarge(task)) {
            const part = snapshot.tasks.find((one) => idOf(one) === task.nextPart);
            return part && (part.to === "Claude" || byName.has(part.to)) && !isStarting(part.id) ? play(task, () => startTask($, snapshot, part, byName.get(part.to))) : idle(task, words("playNoPart"));
        }

        // Nobody starts a person's own task but them.
        if (!member && task.to !== "Claude") {
            return idle(task, words("playPerson", { name: task.to }));
        }

        // Who holds it now decides what ▶ does; the user sees only whether there is one. A colleague at work, or this very chat, needs
        // no ▶; another chat goes on through a message here; a task nobody holds is taken up again.
        const held = task.state === "doing" ? board.holds[String(task.id)] : undefined;

        if (held?.colleague) {
            const at = snapshot.colleagues.find((colleague) => colleague.id === held.colleague);
            return <Box key={`working-${task.id}`} flexShrink={0}><Text color={workColor} wrap="truncate">{`${workMark} ${at?.name ?? held.colleague}`}</Text></Box>;
        }

        if (held && held.session === board.session) {
            return idle(task, words("playHere"));
        }

        if (isStarting(task.id)) {
            return <Box key={`starting-${task.id}`} flexShrink={0}><Text dimColor wrap="truncate">{words("starting")}</Text></Box>;
        }

        // A task that waits for others still open: ▶ asks Claude for the whole chain, with one yes.
        if (isBlocked(task) && !held) {
            return play(task, () => startChain($, snapshot, task));
        }

        return play(task, () => startTask($, snapshot, task, member, held?.session));
    };
    // A large task's parts, shown or folded: as the user left them, else shown while one is in progress. Its row has them closed as a chip
    // with an arrow, in place of its age, that shows or folds them.
    const isUnfolded = (task: Task) => view.folds?.[String(task.id)] ?? partsOf(task).some((part) => part.state === "doing");
    const partsChip = (task: Task) => {
        const isDoing = task.state === "doing";
        const text = `${isUnfolded(task) ? "▾" : "▸"} ${task.partsDone}/${task.parts.length}`;
        const label = (
            <Button key={`parts-${task.id}`} plain onPress={() => void change((old) => ({ ...old, folds: { ...old.folds, [String(task.id)]: !isUnfolded(task) } }))}>
                <Text color={isDoing ? workColor : undefined} dimColor={!isDoing}>{isDesktop ? text : `[${text}]`}</Text>
            </Button>
        );
        const button = isDesktop ? ground(`parts-box-${task.id}`, isDoing ? `${workColor}26` : stateLayer, label) : label;
        return tip(`parts-${task.id}`, words("partsTip", { done: task.partsDone, total: task.parts.length }), button);
    };
    // In place of its age, a blocked task shows what it waits for: «⛓ T-62», and how many more; a large task, its parts closed. After
    // those, a due day near or past, «⏰ 3 g», red when late; a task stuck in progress, «⏸ 4 g», in the color of a warning. On the desktop
    // a hint under the pointer says it in words.
    const ageOrWait = (task: Task) => {
        if (isLarge(task)) {
            return partsChip(task);
        }

        const blockers = task.blockedBy ?? [];
        const due = task.dueInfo && (task.dueInfo.isLate || task.dueInfo.isNear) ? task.dueInfo : null;
        const [label, hint, color] = blockers.length > 0 ? [`⛓ ${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ""}`, words("blockedTip", { list: blockers.join(", ") }), undefined]
            : due ? [`⏰ ${dueWords(due)}`, words("dueTip", { day: due.day }), due.isLate ? errorColor : warningColor]
            : task.stale && task.started ? [`⏸ ${age(task.started)}`, words("staleTip", { day: task.started }), warningColor]
            : [age(task.created), null, undefined];
        const cell = <Box key={`age-${task.id}`} flexShrink={0}><Text dimColor={!color} color={color} wrap="truncate">{label}</Text></Box>;
        return hint ? tip(`age-${task.id}`, hint, cell) : cell;
    };
    // A task's row, and below it, opened, its details. A part, under its large task, has a smaller face.
    const taskLines = (task: Task, isPart = false) => [
        <Box key={`row-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
            {face(task.to, isPart ? 18 : 24)}
            {typeMark(task)}
            {priorityMark(task)}
            <Box flexShrink={0}><Text color={taskColor} bold>{idOf(task)}</Text></Box>
            {task.issueInfo?.another ? <Text key={`another-${task.id}`} color={warningColor}>⚠</Text> : null}
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                {opener(`open-${task.id}`, `task-${task.id}`, rowText(task.text))}
            </Box>
            {ageOrWait(task)}
            {effortCell(task)}
            {start(task)}
        </Box>,
        view.expanded === `task-${task.id}` ? details(task, isPart) : null,
    ];
    // A task's card; a large task's unfolded with its parts under it: those closed first, checked and without ▶, in the order they closed;
    // then the open ones, those in progress first.
    const taskRow = (task: Task) => {
        if (!isUnfolded(task)) {
            return card(`task-${task.id}`, taskLines(task));
        }

        const closed = (snapshot.doneParts ?? []).filter((part) => part.parent === idOf(task)).sort((first, second) => (first.done ?? "").localeCompare(second.done ?? "") || first.id - second.id);
        const open = [...partsOf(task)].sort((first, second) => (frozen ? 0 : Number(second.state === "doing") - Number(first.state === "doing")) || byOrder(first, second));
        return card(`task-${task.id}`, [
            ...taskLines(task),
            ...closed.map((part) => (
                <Box key={`done-part-${part.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center" paddingLeft={indent}>
                    {face(part.to, 18)}
                    {typeMark(part)}
                    <Box flexShrink={0}><Text color={workColor}>✓</Text></Box>
                    <Box flexShrink={0}><Text color={taskColor} dimColor>{idOf(part)}</Text></Box>
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden"><Text dimColor strikethrough wrap="truncate-end">{rowText(part.text)}</Text></Box>
                </Box>
            )),
            ...open.map((part) => <Box key={`part-${part.id}`} flexDirection="column" paddingLeft={indent}>{taskLines(part, true)}</Box>),
        ]);
    };
    // A new task, written in the list to do with its priority, its type and the large task it is a part of: its creator is the person
    // the panel is for, as the page's owner. A large task takes parts one level deep: the open tasks that are no part themselves.
    const draft = { priority: "P2", type: "", parent: "", ...view.draft };
    const closeNew = () => {
        newText = "";
        void change((old) => ({ ...old, editing: null, draft: undefined }));
    };
    const addTask = (value: string) => {
        const text = oneLine(value);
        closeNew();

        if (text) {
            void backlog($, ["add", text.replaceAll(" · ", " - "), "--p", draft.priority, ...(draft.type ? ["--type", draft.type] : []), ...(draft.parent ? ["--in", draft.parent] : []), ...(decider ? ["--by", decider] : [])]);
        }
    };
    const pick = (field: "priority" | "type" | "parent") => (value: string) => void change((old) => ({ ...old, draft: { ...draft, ...old.draft, [field]: value } }));
    // Where the surface draws no form (the mobile app), no button opens one.
    const newTask = () => (!hasForms ? null : view.editing === "new"
        ? (
            <Box key="new-task-form" flexDirection="column" gap={1}>
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                    <Select key="new-priority" label={words("fieldPriority")} value={draft.priority} options={(["P1", "P2", "P3"] as const).map((key) => ({ value: key, label: `${key} · ${snapshot.words.priorities[key] ?? key}` }))} onSelect={pick("priority")} />
                    <Select key="new-type" label={words("fieldType")} value={draft.type} options={[noChoice, ...Object.entries(snapshot.types ?? {}).map(([key, name]) => ({ value: key, label: name }))]} onSelect={pick("type")} />
                    <Select key="new-parent" label={words("fieldParent")} value={draft.parent} options={[noChoice, ...snapshot.tasks.filter((task) => !task.parent).sort(byOrder).map((task) => ({ value: idOf(task), label: `${idOf(task)} · ${task.text.length > 40 ? `${task.text.slice(0, 40)}…` : task.text}` }))]} onSelect={pick("parent")} />
                </Box>
                <Input key="new-task" value={newText} placeholder={words("newTaskHint")} autoFocus submitLabel={addMark} onInput={(value) => { newText = value; }} onSubmit={addTask} />
                {iconButton("new-task-cancel", words("cancelEdit"), closeNew, true)}
            </Box>
        )
        : <Button key="new-task" plain dimColor label={words("newTask")} onPress={() => void change((old) => ({ ...old, editing: "new" }))} />);
    const taskSection = (key: "doing" | "rest" | "postponed", icon: string, title: string, tasks: Task[], none: string) => section(key, icon, `${title} · ${tasks.length}`, [
        ...(key === "rest" ? [newTask()] : []),
        ...(tasks.length === 0 ? [<Text key={`none-${key}`} dimColor>{none}</Text>] : limited(key, tasks).map(taskRow)),
        more(key, tasks.length, "showAllTasks"),
    ]);

    return { doing, rest, postponed, busyWith, nextTask, start, taskSection };
}

/** Whether a task holds parts: a large task, done through them. */
function isLarge(task: Task): boolean
{
    return (task.parts ?? []).length > 0;
}

/** Whether a task waits for one still open. */
function isBlocked(task: Task): boolean
{
    return (task.blockedBy ?? []).length > 0;
}

/** Keeps the lists' order for a moment, then lets them sort again: the drawing after the wait reads the order freed. */
async function freezeOrder($: EngineInterface, rank: Record<string, number>): Promise<void>
{
    const until = (await $.clock.now()) + frozenFor;
    await changeView($, (old) => ({ ...old, frozen: { until, rank } }));
    $.clock.after(frozenFor, () => void changeView($, (old) => (old.frozen && old.frozen.until <= until ? { ...old, frozen: null } : old)));
}
