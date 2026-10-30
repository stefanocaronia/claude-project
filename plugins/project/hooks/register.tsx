// The project's panel beside the chat: the tasks in progress and the P1 to do, each with ▶ to start it, the plan's goals with their bars,
// the decisions to take and the latest. It draws what scripts/snapshot.mjs reads from the files, and changes them only through
// scripts/backlog.mjs: the scripts own the files, the panel only asks.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { Board, Goal, Member, Proposal, Pull, Snapshot, Task, View } from "../types";

import { barEndSvg, claudeSvg, effortSvg, faceSvg, prioritySvg, typeSvg, wideBarSvg } from "./draw.ts";
import { typeColor } from "../lib/schedule.mjs";
import { citedTasks } from "../lib/backlog.mjs";
import { sayer } from "../lib/messages.mjs";

const pane = "project";
const command = "project-panel";
const board = atom({ plugin: "project", key: "board" } as const, { snapshot: null, problem: null, readAt: 0, stamp: "", holds: {}, session: "" }, { shape: "board-2" });
// A chat's holds older than this are of a chat long gone that never said so.
const holdsLast = 24 * 3_600_000;
const view = atom({ plugin: "project", key: "view" } as const, { sections: {}, expanded: null, whole: {}, starting: {} }, { shape: "view-1" });
// The sections open at the start, as Joseph's sketch has them: the decisions closed, the tile above says how many wait.
const openAtStart: Record<string, boolean> = { links: true, documents: true, doing: true, rest: true, issues: true, goals: true, decisions: false };
// How many rows a section shows before "show all".
const rows: Record<string, number> = { doing: 5, rest: 10, issues: 5, goals: 5, open: 3, recent: 3 };
const proposalLength = 400;
// Crew's marks: a priority as an issue tracker draws it, the green of work, the purple of decisions, the red of errors.
const priorities = { P1: { glyph: "⇈", color: "#E5493A" }, P2: { glyph: "=", color: "#E2852B" }, P3: { glyph: "↓", color: "#4C8FE0" } } as const;
const markOf = (priority: string) => priorities[priority as keyof typeof priorities] ?? priorities.P2;
const nextPriority: Record<string, string | undefined> = { P1: "P2", P2: "P3", P3: "P1" };
const workColor = "#4E9A6B";
const decisionColor = "#8A63C9";
// The mark of a decision, taken or to take: the scales, drawn as text so that it stays one color.
const scales = "⚖︎";
const errorColor = "#D0453F";
// Material's outline, its hover state layer, and the gray of a count with nothing wrong, readable in both themes.
const outline = "#8080803d";
const stateLayer = "#80808014";
// Every card's faint gray, the same for all, as Crew's.
const cardTint = "#80808003";
const quietColor = "#888780";
const warningColor = "#E2852B";
// A hint in Material's inverse colors, which read on both themes, as Crew's.
const tooltipBackground = "#2b2b29";
const tooltipText = "#f4f4f1";
const effortMeters: Record<string, string> = { low: "▮▯▯▯", medium: "▮▮▯▯", high: "▮▮▮▯", xhigh: "▮▮▮▮", max: "▮▮▮▮", none: "" };
// The exit code of snapshot.mjs in a folder with no project above it.
const noProject = 3;
// How long a start asked from the panel shows on its button, at most, while Claude starts the work.
const startingFor = 120_000;

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        const started = await next(e);
        await $.command.register({ name: command, description: sayer("en")("panelCommand") }).catch(() => undefined);
        await refresh($, true);

        if ((await read($, board)).snapshot) {
            void $.ui.open({ id: pane, title: say(await read($, board))("pane") }).catch(() => undefined);
        }

        return started;
    });

    on("command.run", { command }, async ($) => {
        const words = say(await read($, board));

        if ((await $.ui.panes()).some((open) => open.id === pane)) {
            await $.ui.close({ id: pane });
            return { text: words("panelClosed") };
        }

        await refresh($, true);
        await $.ui.open({ id: pane, title: words("pane") });
        return { text: words("panelOpened") };
    });

    // A task given to a colleague, its number in the brief, is in progress: the panel moves it there itself. Done is Claude's to say,
    // after reading the report.
    on("agent.spawn", async ($, e, next) => {
        const spawned = await next(e);
        // Whatever goes wrong here, the colleague has started: the backlog waits for the next turn.
        await moveCited($, e, spawned.agentId).catch(() => undefined);
        return spawned;
    });

    // A task this chat starts or closes through the backlog's command line: this chat holds it, or no longer does. Any change through
    // the plugin's commands shows at once, not only when the turn ends: a task Claude starts is in progress while it works on it.
    on("tool.call", async ($, e, next) => {
        const result = await next(e);
        const command = typeof (e as { command?: unknown }).command === "string" ? (e as { command: string }).command : "";
        const change = e.agentId ? null : /backlog\.mjs["']?\s+(start|done|postpone|todo|archive)\b/.exec(command);

        if (change) {
            const { snapshot } = await read($, board);
            const ids = citedTasks(command, snapshot?.prefixes.task ?? "T");
            await hold($, (held) => applyHold(held, ids, change[1] === "start" ? { colleague: null, agentId: null } : null)).catch(() => undefined);
        }

        if (/(backlog|plan)\.mjs["']?\s/.test(command)) {
            await refresh($, false).catch(() => undefined);
        }

        return result;
    });

    // The files are read again once a turn ends, Claude's or a colleague's, when one of them changed; a colleague who finished lets go
    // of the tasks they held.
    on("turn.complete", async ($, e, next) => {
        const completed = await next(e);

        if (e.agentId) {
            const agentId = e.agentId;
            await hold($, (held) => Object.fromEntries(Object.entries(held).filter(([, one]) => one.agentId !== agentId))).catch(() => undefined);
        }

        await refresh($, false).catch(() => undefined);
        return completed;
    });

    // A chat that ends holds nothing any longer.
    on("session.end", async ($, e, next) => {
        await $.fs.write(await holdFile($), JSON.stringify({ root: "", at: 0, tasks: {} })).catch(() => undefined);
        return next(e);
    });

    on("ui.render", { component: "Pane", requestId: pane }, async ($, e) => {
        const ui = $.ui.resolve(e);
        const { Box, Text, Button, Link } = ui;
        const current = await read($, board);
        const panel = await read($, view);
        const words = say(current);
        const snapshot = current.snapshot;

        if (!snapshot) {
            return <Text dimColor>{current.problem ?? words("reading")}</Text>;
        }

        // The drawings are the desktop's: the terminal draws text.
        const Svg = e.surface !== "terminal" && "Svg" in ui ? ui.Svg : null;
        const isDesktop = Svg !== null;
        const now = await $.clock.now();
        const prefix = snapshot.prefixes.task;
        const byName = new Map(snapshot.colleagues.map((colleague) => [colleague.name, colleague]));
        // A part shows under its large task, whatever its state; on its own only when its large task is not open.
        const shownIds = new Set(snapshot.tasks.map((task) => `${snapshot.prefixes.task}-${task.id}`));
        const isGrouped = (task: Task) => Boolean(task.parent && shownIds.has(task.parent));
        const doing = snapshot.tasks.filter((task) => task.state === "doing" && !isGrouped(task));
        // The task this chat is at work on, itself and not through a colleague: while it holds one, it starts no other.
        const busyWith = doing.concat(snapshot.tasks.filter(isGrouped)).find((task) => {
            const held = current.holds[String(task.id)];
            return task.state === "doing" && held && held.session === current.session && !held.colleague;
        });
        // Everything still to do, as Crew's backlog lists it: by priority, then the oldest; the postponed after.
        // A large task stands where the most urgent of its open parts would: their priority, then the oldest.
        const order = (task: Task) => {
            const own = [task, ...snapshot.tasks.filter((part) => part.parent === `${snapshot.prefixes.task}-${task.id}`)].map((one) => `${one.priority}${one.created}`).sort()[0];
            return `${task.state === "postponed" ? 1 : 0}${own}`;
        };
        const rest = snapshot.tasks.filter((task) => (task.state === "todo" || task.state === "postponed") && !isGrouped(task)).sort((first, second) => order(first).localeCompare(order(second)));
        const todoOf = (priority: string) => snapshot.tasks.filter((task) => task.state === "todo" && task.priority === priority).length;
        const isOpen = (section: string) => panel.sections[section] ?? openAtStart[section] ?? false;
        const toggle = (section: string) => () => update($, view, (old) => ({ ...old, sections: { ...old.sections, [section]: !(old.sections[section] ?? openAtStart[section] ?? false) } }));
        const expand = (key: string) => () => update($, view, (old) => ({ ...old, expanded: old.expanded === key ? null : key }));
        const showWhole = (list: string) => () => update($, view, (old) => ({ ...old, whole: { ...old.whole, [list]: !old.whole[list] } }));
        const limited = <T,>(list: string, items: T[]) => (panel.whole[list] ? items : items.slice(0, rows[list] ?? 3));
        const isStarting = (key: string) => now - (panel.starting[key] ?? 0) < startingFor;
        // A space that never breaks: "2 g" stays on one line.
        const age = (day: string | null) => (day ? words("days", { days: Math.max(0, Math.round((Date.parse(snapshot.today) - Date.parse(day)) / 86_400_000)) }).replace(" ", " ") : "");
        const border = isDesktop ? { borderColor: outline } : { borderDimColor: true };
        // Material's outlined card, faintly gray, with the state layer under the pointer, as Crew's.
        const card = (key: string, children: (JSX.Element | null)[]) => (
            <Box key={key} flexDirection="column" borderStyle="round" {...border} paddingX={1} {...(isDesktop ? { backgroundColor: cardTint, hover: { backgroundColor: stateLayer } } : {})}>
                {children}
            </Box>
        );
        // A section: its heading, which opens and closes it, and what it holds, one row of room between them.
        const section = (key: string, icon: string, title: string, items: (JSX.Element | null)[], after: JSX.Element | null = null) => (
            <Box key={key} flexDirection="column" gap={1}>
                <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center">
                    <Button key={`toggle-${key}`} plain label={`${isOpen(key) ? "▾" : "▸"} ${icon} ${title}`} onPress={toggle(key)} />
                    {after}
                </Box>
                {isOpen(key) ? items : null}
            </Box>
        );
        const more = (list: string, count: number, label: "showAllTasks" | "showAllDecisions") =>
            count > (rows[list] ?? 3) && !panel.whole[list] ? <Button key={`more-${list}`} plain dimColor label={words(label, { count })} onPress={showWhole(list)} /> : null;

        // Who holds a task: Claude's critter, a colleague's portrait or initials, a person's initials in gray.
        const face = (name: string, size: number) => {
            const member = byName.get(name);

            if (!Svg) {
                return <Text key={`face-${name}`} color={member?.color} dimColor={!member}>●</Text>;
            }

            const source = name === "Claude" ? claudeSvg(size) : faceSvg(member ?? { id: name, name, fullName: name, role: "", color: "gray" }, member?.portrait, size);
            return <Svg key={`face-${name}`} source={source} alt={member?.fullName ?? name} width={size} height={size} />;
        };
        // A press on a task's priority turns it, P1, P2, P3 and P1 again: a clear button laid over the drawn mark takes the press.
        const priorityMark = (task: Task) => {
            const mark = markOf(task.priority);
            const turn = () => backlog($, ["set", `${prefix}-${task.id}`, "--p", nextPriority[task.priority] ?? "P1"]);
            const drawn = Svg ? prioritySvg(task.priority) : undefined;

            if (!drawn || !Svg) {
                return <Button key={`priority-${task.id}`} plain label={mark.glyph} onPress={turn} />;
            }

            return (
                <Box key={`priority-box-${task.id}`} flexShrink={0}>
                    <Svg source={drawn} alt={task.priority} width={14} height={14} />
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
        const start = (task: Task) => {
            const key = `task-${task.id}`;
            const member = byName.get(task.to);

            // A chat at work on a task starts no other: another task is for a new session of the project.
            if (busyWith && busyWith.id !== task.id) {
                return null;
            }

            // A large task is done through its parts: its ▶ starts the next one, by priority and age, free and to do.
            if (isLarge(task)) {
                const part = snapshot.tasks.find((one) => `${prefix}-${one.id}` === task.nextPart);
                const isStartable = part && (part.to === "Claude" || byName.has(part.to)) && !isStarting(`task-${part.id}`);
                return part && isStartable ? <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={() => startTask($, snapshot, part, byName.get(part.to))} /> : null;
            }

            // Nobody starts a person's own task but them.
            if (!member && task.to !== "Claude") {
                return null;
            }

            // Who holds it now decides what ▶ does; the user sees only whether there is one. A colleague at work, or this very chat, needs
            // no ▶; another chat goes on through a message here; a task nobody holds is taken up again.
            const held = task.state === "doing" ? current.holds[String(task.id)] : undefined;

            if (held?.colleague) {
                const at = snapshot.colleagues.find((colleague) => colleague.id === held.colleague);
                return <Box key={`working-${task.id}`} flexShrink={0}><Text color={workColor} wrap="truncate">{`⚒︎ ${at?.name ?? held.colleague}`}</Text></Box>;
            }

            if (held && held.session === current.session) {
                return null;
            }

            if (isStarting(key)) {
                return <Box key={`starting-${task.id}`} flexShrink={0}><Text dimColor wrap="truncate">{words("starting")}</Text></Box>;
            }

            // A task that waits for others still open: ▶ asks Claude for the whole chain, with one yes.
            if (isBlocked(task) && !held) {
                return <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={() => startChain($, snapshot, task)} />;
            }

            return <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={() => startTask($, snapshot, task, member, held?.session)} />;
        };
        // In place of its age, a blocked task shows what it waits for: «⛓ T-62», and how many more; a large task, its parts closed. On the
        // desktop a hint under the pointer says it in words.
        // After those, a due day near or past, «⏰ 3 g», red when late; a task stuck in progress, «⏸ 4 g», in the color of a warning.
        const ageOrWait = (task: Task) => {
            const blockers = task.blockedBy ?? [];
            const due = task.dueInfo && (task.dueInfo.isLate || task.dueInfo.isNear) ? task.dueInfo : null;
            const [label, hint, color] = isLarge(task) ? [words("partsCount", { done: task.partsDone, total: task.parts.length }), words("partsTip", { done: task.partsDone, total: task.parts.length }), undefined]
                : blockers.length > 0 ? [`⛓ ${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ""}`, words("blockedTip", { list: blockers.join(", ") }), undefined]
                : due ? [`⏰ ${dueWords(due)}`, words("dueTip", { day: due.day }), due.isLate ? errorColor : warningColor]
                : task.stale && task.started ? [`⏸ ${age(task.started)}`, words("staleTip", { day: task.started }), warningColor]
                : [age(task.created), null, undefined];
            const cell = <Box key={`age-${task.id}`} flexShrink={0}><Text dimColor={!color} color={color} wrap="truncate">{label}</Text></Box>;
            return hint ? tip(`age-${task.id}`, hint, cell) : cell;
        };
        const dueWords = (due: NonNullable<Task["dueInfo"]>) => (due.isLate ? words("dueLate", { days: -due.days }) : due.days === 0 ? words("dueToday") : words("dueIn", { days: due.days }));
        // A task's type as Jira draws it, its name under the pointer; nothing for a task without one.
        const typeMark = (task: Task) => {
            if (!task.type) {
                return null;
            }

            const name = snapshot.types?.[task.type] ?? task.type;
            const mark = Svg
                ? <Box key={`type-${task.id}`} flexShrink={0}><Svg source={typeSvg(task.type, typeColor(task.type))} alt={name} width={14} height={14} /></Box>
                : <Box key={`type-${task.id}`} flexShrink={0}><Text color={typeColor(task.type)}>■</Text></Box>;
            return tip(`type-${task.id}`, name, mark);
        };
        // A hint under the pointer, above the control so that the card does not cut it; the terminal draws none.
        const tip = (key: string, hint: string, control: JSX.Element) => (isDesktop
            ? (
                <Box key={`tip-${key}`} flexShrink={0}>
                    {control}
                    <Box position="absolute" bottom={1} right={0} display="none" hover={{ display: "flex" }} backgroundColor={tooltipBackground} borderStyle="round" borderColor={outline} paddingX={1}>
                        <Text color={tooltipText}>{hint}</Text>
                    </Box>
                </Box>
            )
            : control);
        // A task's links, both ways, under its facts: what it waits for and what waits for it, what it points to and what points to it.
        const linkLines = (task: Task) => [
            task.type ? words("typeLabel", { name: snapshot.types?.[task.type] ?? task.type }) : null,
            task.due ? words("dueLabel", { day: task.due }) : null,
            task.started && task.state === "doing" ? words(task.stale ? "staleTip" : "startedLabel", { day: task.started }) : null,
            (task.decisions ?? []).length > 0 ? words("decisionsOf", { list: (task.decisions ?? []).join(", ") }) : null,
            task.parent ? words("partOf", { id: task.parent }) : null,
            isLarge(task) ? words("partsLabel", { done: task.partsDone, total: task.parts.length, list: task.parts.join(", ") }) : null,
            (task.after ?? []).length > 0 ? words("waitsFor", { list: task.after.join(", ") }) : null,
            (task.chain ?? []).length > 0 ? `⛓ ${words("chainFirst", { list: [...task.chain, `${prefix}-${task.id}`].join(" → ") })}` : null,
            (task.waitedBy ?? []).length > 0 ? words("waitedBy", { list: task.waitedBy.join(", ") }) : null,
            (task.see ?? []).length > 0 ? words("seeLabel", { list: task.see.join(", ") }) : null,
            (task.seenFrom ?? []).length > 0 ? words("seenFrom", { list: task.seenFrom.join(", ") }) : null,
        ].filter((line): line is string => Boolean(line)).map((line, index) => <Text key={`link-${task.id}-${index}`} dimColor>{line}</Text>);
        // A task's card; a large task's holds its open parts under it, those in progress first, then as the lists order them.
        // The code that cites a task, under its links: its commits, the latest a link, and each pull request, a link, with its state; a
        // merged one on a task still open says it can close.
        const codeLines = (task: Task) => {
            const latest = (task.commits ?? [])[0];
            const issue = task.issueInfo;
            const state = (pull: Pull) => (pull.merged ? words("pullMerged", { day: pull.merged }) : words(pull.state === "open" ? "pullOpen" : "pullClosed"));
            const line = (key: string, text: string, href: string | null | undefined, color?: string) => (href ? <Link key={key} href={href}>{text}</Link> : <Text key={key} dimColor={!color} color={color}>{text}</Text>);
            return [
                issue ? line(`issue-${task.id}`, words("issueLabel", { issue: `#${issue.number}`, title: issue.title, state: words(issue.state === "open" ? "issueStateOpen" : "issueStateClosed") }), issue.url) : null,
                latest ? line(`commits-${task.id}`, words("commitsCount", { count: task.commitCount, day: latest.day }), latest.url) : null,
                ...(task.pulls ?? []).map((pull) => line(`pull-${task.id}-${pull.number}`, words("codePull", { number: pull.number, state: state(pull), title: pull.title }), pull.url)),
                task.mergedPull ? line(`merged-${task.id}`, `✓ ${words("mergedCanClose", { number: task.mergedPull.number })}`, null, workColor) : null,
            ].filter((element): element is JSX.Element => element !== null);
        };
        const taskRow = (task: Task) => {
            const parts = snapshot.tasks.filter((part) => part.parent === `${prefix}-${task.id}`)
                .sort((first, second) => Number(second.state === "doing") - Number(first.state === "doing") || order(first).localeCompare(order(second)));
            return card(`task-${task.id}`, [
                ...taskLines(task),
                ...parts.map((part) => <Box key={`part-${part.id}`} flexDirection="column" paddingLeft={isDesktop ? 4 : 2}>{taskLines(part, true)}</Box>),
            ]);
        };
        // A part, under its large task, has a smaller face.
        const taskLines = (task: Task, isPart = false) => {
            const key = `task-${task.id}`;
            const isExpanded = panel.expanded === key;
            const member = byName.get(task.to);
            const facts = [`${prefix}-${task.id}`, `${task.priority} ${words("priorityLabel", { name: snapshot.words.priorities[task.priority] ?? "" })}`, `${words("effort")} ${task.effort}`, member?.fullName ?? task.to, task.goal === snapshot.words.noGoal ? null : task.goal, words("born", { date: task.created })];
            return [
                <Box key={`row-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                    {face(task.to, isPart ? 18 : 24)}
                    {typeMark(task)}
                    {priorityMark(task)}
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                        <Button key={`open-${task.id}`} plain onPress={expand(key)}>
                            <Text wrap="truncate-end">{`${isExpanded ? "▾" : "▸"} ${task.text}`}</Text>
                        </Button>
                    </Box>
                    {ageOrWait(task)}
                    {effortCell(task)}
                    {start(task)}
                </Box>,
                isExpanded
                    ? (
                        <Box key={`details-${task.id}`} flexDirection="column" gap={1} paddingLeft={isDesktop ? 4 : 2}>
                            <Text>{task.text}</Text>
                            <Text dimColor>{facts.filter(Boolean).join(" · ")}</Text>
                            {linkLines(task)}
                            {codeLines(task)}
                            <Box flexDirection="row" columnGap={2}>
                                {task.noteHref ? <Link key={`note-${task.id}`} href={task.noteHref}>{words("openNote")}</Link> : null}
                                <Button key={`done-${task.id}`} plain label={words("markDone")} onPress={() => markDone($, snapshot, task)} />
                                {task.state === "postponed" ? null : <Button key={`postpone-${task.id}`} plain dimColor label={words("postpone")} onPress={() => backlog($, ["postpone", `${prefix}-${task.id}`])} />}
                            </Box>
                        </Box>
                    )
                    : null,
            ];
        };
        // The tasks to do come first, by priority and age; the postponed after them, under a line that says so.
        const taskSection = (key: "doing" | "rest", icon: string, title: string, tasks: Task[], none: string) => {
            const shown = limited(key, tasks);
            const firstPostponed = shown.findIndex((task) => task.state === "postponed");
            const postponed = tasks.filter((task) => task.state === "postponed").length;
            const rowsShown = shown.flatMap((task, index) => [
                ...(index === firstPostponed ? [<Text key={`postponed-${key}`} dimColor>{`⏸ ${snapshot.words.states.postponed} · ${postponed}`}</Text>] : []),
                taskRow(task),
            ]);
            return section(key, icon, `${title} · ${tasks.length}`, [
                ...(tasks.length === 0 ? [<Text key={`none-${key}`} dimColor>{none}</Text>] : rowsShown),
                more(key, tasks.length, "showAllTasks"),
            ]);
        };

        // The goals still open have their bars; those closed only a count, the page has them.
        const openGoals = snapshot.plan.goals.filter((goal) => !goal.closed);
        const closedGoals = snapshot.plan.goals.length - openGoals.length;
        // A goal: its name, a bar as wide as the card, its tasks done of all; open, its open tasks.
        const goalRow = (goal: Goal) => {
            const key = `goal-${goal.name}`;
            const isExpanded = panel.expanded === key;
            const own = snapshot.tasks.filter((task) => task.goal === goal.name).sort((first, second) => Number(second.state === "doing") - Number(first.state === "doing"));
            const name = (
                <Button key={`open-${goal.name}`} plain onPress={expand(key)}>
                    <Text wrap="truncate-end" color={goal.isDoing ? workColor : undefined}>{`${isExpanded ? "▾" : "▸"} ${goal.name}`}</Text>
                </Button>
            );
            const count = <Box key={`count-${goal.name}`} flexShrink={0}><Text dimColor tabular>{`${goal.done}/${goal.total}`}</Text></Box>;
            const opened = isExpanded
                ? (
                    <Box key={`goal-tasks-${goal.name}`} flexDirection="column" paddingLeft={2}>
                        <Text dimColor>{words("goalCounts", { done: goal.done, total: goal.total, open: own.length })}</Text>
                        {own.map((task) => (
                            <Box key={`goal-task-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                                {face(task.to, 18)}
                                {Svg && prioritySvg(task.priority) ? <Svg source={prioritySvg(task.priority) ?? ""} alt={task.priority} width={14} height={14} /> : <Text color={markOf(task.priority).color}>{markOf(task.priority).glyph}</Text>}
                                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                                    <Text wrap="truncate-end" color={task.state === "doing" ? workColor : undefined}>{`${prefix}-${task.id} ${task.text}`}</Text>
                                </Box>
                                {start(task)}
                            </Box>
                        ))}
                    </Box>
                )
                : null;

            return (
                <Box key={key} flexDirection="column">
                    {isDesktop
                        ? (
                            <Box flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                                <Box width={22} flexShrink={0} overflow="hidden">{name}</Box>
                                {wideBar(ui, goal.total === 0 ? 0 : goal.done / goal.total, goal.isDoing ? workColor : undefined)}
                                {count}
                            </Box>
                        )
                        : (
                            <Box flexDirection="column">
                                {name}
                                <Box flexDirection="row" flexWrap="nowrap" gap={1}>
                                    {textBar(ui, goal.total === 0 ? 0 : goal.done / goal.total, goal.isDoing ? workColor : undefined)}
                                    {count}
                                </Box>
                            </Box>
                        )}
                    {opened}
                </Box>
            );
        };

        const proposalRow = (proposal: Proposal) => {
            const key = `proposal-${proposal.line}`;
            const isExpanded = panel.expanded === key;
            const cut = proposal.text.length > proposalLength ? `${proposal.text.slice(0, proposalLength)}…` : proposal.text;
            return card(key, [
                <Box key={`proposal-row-${proposal.line}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                    <Box flexShrink={0}><Text color={decisionColor}>{scales}</Text></Box>
                    {proposal.priority && Svg ? <Svg source={prioritySvg(proposal.priority) ?? ""} alt={proposal.priority} width={14} height={14} /> : null}
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                        <Button key={`open-${key}`} plain onPress={expand(key)}>
                            <Text wrap="truncate-end">{`${isExpanded ? "▾" : "▸"} ${proposal.text}`}</Text>
                        </Button>
                    </Box>
                    <Box flexShrink={0}><Text dimColor wrap="truncate">{age(proposal.day)}</Text></Box>
                </Box>,
                isExpanded
                    ? (
                        <Box key={`proposal-details-${proposal.line}`} flexDirection="column" gap={1} paddingLeft={2}>
                            <Text>{cut}</Text>
                            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
                                <Button key={`choice-${key}`} plain label={words("asChoice")} onPress={() => submit($, words("promptChoice", { line: proposal.line, text: proposal.whole }))} />
                                {cut !== proposal.text ? <Link key={`page-${key}`} href={`${snapshot.page}/#decisions`}>{words("continueInPage")}</Link> : null}
                            </Box>
                        </Box>
                    )
                    : null,
            ]);
        };
        const decisionRow = (decision: Snapshot["decisions"]["recent"][number]) => {
            const key = `decision-${decision.number}`;
            const isExpanded = panel.expanded === key;
            return card(key, [
                <Box key={`decision-row-${decision.number}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                    <Box flexShrink={0}><Text color={decisionColor}>{scales}</Text></Box>
                    <Box flexShrink={0}><Text color={decisionColor} bold>{`${snapshot.prefixes.decision}-${decision.number}`}</Text></Box>
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                        <Button key={`open-${key}`} plain onPress={expand(key)}>
                            <Text wrap="truncate-end">{`${isExpanded ? "▾" : "▸"} ${decision.text}`}</Text>
                        </Button>
                    </Box>
                </Box>,
                isExpanded
                    ? (
                        <Box key={`decision-details-${decision.number}`} flexDirection="column" gap={1} paddingLeft={2}>
                            <Text>{decision.text}</Text>
                            {decision.why ? <Text dimColor>{decision.why}</Text> : null}
                            {(decision.tasks ?? []).length > 0 ? <Text dimColor>{words("tasksOf", { list: (decision.tasks ?? []).join(", ") })}</Text> : null}
                        </Box>
                    )
                    : null,
            ]);
        };
        // The proposals ordered as the tasks are: by priority, those without one last, then the oldest (a point without a day by its place
        // in the file, the earlier first).
        const rank = (proposal: Proposal) => (proposal.priority ? Number(proposal.priority.slice(1)) : 4);
        const proposals = snapshot.decisions.open.slice().sort((first, second) => rank(first) - rank(second) || (first.day ?? "9999").localeCompare(second.day ?? "9999") || first.line - second.line);
        // What the buttons above the links start: the first task someone here can start, the first decision to take.
        // A blocked task is skipped: its chain starts from its own ▶.
        const nextTask = busyWith ? undefined : rest.find((task) => task.state === "todo" && !isBlocked(task) && !isLarge(task) && (task.to === "Claude" || byName.has(task.to)));
        const nextProposal = proposals[0];
        const actions = (
            <Box key="actions" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
                {busyWith ? <Text key="busy" dimColor>{words("busyChat", { id: `${prefix}-${busyWith.id}` })}</Text> : null}
                {nextTask
                    ? isStarting(`task-${nextTask.id}`)
                        ? <Button key="next-task" label={words("starting")} onPress={() => undefined} />
                        : <Button key="next-task" variant="primary" label={words("nextTask", { id: `${prefix}-${nextTask.id}` })} onPress={() => startTask($, snapshot, nextTask, byName.get(nextTask.to))} />
                    : null}
                {nextProposal ? <Button key="next-decision" label={words("nextDecision")} onPress={() => submit($, words("promptChoice", { line: nextProposal.line, text: nextProposal.whole }))} /> : null}
                <Button key="where-we-stand" label={words("whereWeStand")} onPress={() => submit($, words("promptWhereWeStand"))} />
                <Button key="tidy-docs" label={words("tidyDocs")} onPress={() => submit($, words("promptTidy"))} />
            </Box>
        );

        // The project at a glance, in colored tiles as Crew's: each opens its tab of the page.
        const errors = snapshot.health?.errors ?? 0;
        const tile = (key: string, value: number, label: string, color: string, anchor: string, mark: JSX.Element | null) => (
            <Box key={`tile-${key}`} flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} {...(isDesktop ? { borderColor: `${color}66`, backgroundColor: `${color}1a` } : { borderDimColor: true })}>
                <Box flexDirection="row" alignItems="center" columnGap={1}>
                    {mark}
                    <Link href={`${snapshot.page}/#${anchor}`}>
                        <Text bold color={color}>{String(value)}</Text>
                    </Link>
                </Box>
                <Text dimColor wrap="truncate-end">{label}</Text>
            </Box>
        );
        const tiles = [
            tile("doing", doing.length, words("tileDoing"), workColor, "tasks", <Text color={workColor}>●</Text>),
            ...(["P1", "P2", "P3"] as const).map((priority) => tile(
                priority.toLowerCase(),
                todoOf(priority),
                words("priorityLabel", { name: snapshot.words.priorities[priority] ?? priority }),
                priorities[priority].color,
                "tasks",
                Svg ? <Svg source={prioritySvg(priority) ?? ""} alt={priority} width={14} height={14} /> : <Text color={priorities[priority].color}>{priorities[priority].glyph}</Text>,
            )),
            tile("open", proposals.length, words("tileOpen"), decisionColor, "decisions", <Text color={decisionColor}>{"⚖︎"}</Text>),
            tile("errors", errors, words("tileErrors"), errors > 0 ? errorColor : quietColor, "health", <Text color={errors > 0 ? errorColor : quietColor}>✕</Text>),
        ];
        return (
            <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center" columnGap={2}>
                    <Box flexDirection="row" flexShrink={1} minWidth={0} overflow="hidden">
                        <Text bold wrap="truncate-end">{snapshot.project}</Text>
                        <Text dimColor wrap="truncate-end">{` · ${words("projectWord")}`}</Text>
                    </Box>
                    <Box flexDirection="row" flexShrink={0} columnGap={2} alignItems="center">
                        <Button key="reload-plugins" plain dimColor label={words("reloadPlugins")} onPress={() => reloadPlugins($)} />
                        <Link href={snapshot.page}>{words("openPage")}</Link>
                    </Box>
                </Box>
                {[current.problem, ...(snapshot.problems ?? [])].filter((problem): problem is string => Boolean(problem)).map((problem, index) => <Text key={`problem-${index}`} color={errorColor}>{`⚠ ${problem}`}</Text>)}
                <Box key="tiles" flexDirection="row" flexWrap="wrap" gap={1}>{tiles}</Box>
                {actions}
                {(snapshot.links ?? []).length > 0
                    ? section("links", "↗", words("sectionLinks"), [
                        <Box key="links-row" flexDirection="row" flexWrap="wrap" gap={1}>
                            {(snapshot.links ?? []).map((link, index) => (
                                <Box key={`link-box-${index}`} borderStyle="round" {...border} paddingX={1} {...(isDesktop ? { hover: { backgroundColor: stateLayer } } : {})}>
                                    {link.href
                                        ? <Link key={`link-${index}`} href={link.href}>{link.label}</Link>
                                        : <Button key={`link-${index}`} plain label={link.label} onPress={() => postLink($, link.post ?? "")} />}
                                </Box>
                            ))}
                        </Box>,
                    ])
                    : null}
                {(snapshot.documents ?? []).length > 0
                    ? section("documents", "📄", words("sectionDocuments"), [
                        <Box key="documents-row" flexDirection="row" flexWrap="wrap" gap={1}>
                            {(snapshot.documents ?? []).map((document, index) => (
                                <Box key={`document-box-${index}`} borderStyle="round" {...border} paddingX={1} {...(isDesktop ? { hover: { backgroundColor: stateLayer } } : {})}>
                                    {document.exists ? <Link key={`document-${index}`} href={document.href}>{document.name}</Link> : <Text key={`document-${index}`} dimColor>{document.name}</Text>}
                                </Box>
                            ))}
                        </Box>,
                    ])
                    : null}
                {taskSection("doing", "⚒︎", words("sectionDoing"), doing, words("noneDoing"))}
                {taskSection("rest", "☰", words("sectionRest"), rest, words("noneRest"))}
                {(snapshot.issues ?? []).length > 0
                    ? section("issues", "◉", `${words("sectionIssues")} · ${(snapshot.issues ?? []).length}`, [
                        <Text key="issues-hint" dimColor>{words("issuesHint")}</Text>,
                        ...limited("issues", snapshot.issues ?? []).map((issue) => card(`issue-${issue.number}`, [
                            <Box key={`issue-row-${issue.number}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                                    {issue.url ? <Link href={issue.url}>{`#${issue.number} ${issue.title}`}</Link> : <Text wrap="truncate-end">{`#${issue.number} ${issue.title}`}</Text>}
                                </Box>
                                <Button key={`issue-take-${issue.number}`} plain dimColor label={words("issueToBacklog")} onPress={() => backlog($, ["add", issue.title.replaceAll(" · ", " - "), "--issue", String(issue.number)])} />
                            </Box>,
                        ])),
                        more("issues", (snapshot.issues ?? []).length, "showAllTasks"),
                    ])
                    : null}
                {section("goals", "⚑︎", `${words("sectionGoals")} · ${openGoals.length}`, [
                    card("goals-card", limited("goals", openGoals).map(goalRow)),
                    more("goals", openGoals.length, "showAllTasks"),
                    closedGoals > 0 ? <Link key="goals-closed" href={`${snapshot.page}/#overview`}>{`✓ ${words("goalsClosed", { count: closedGoals })}`}</Link> : null,
                ], isDesktop && snapshot.plan.updated ? <Text dimColor>{words("planOf", { date: snapshot.plan.updated })}</Text> : null)}
                {section("decisions", "⚖︎", `${words("sectionDecisions")} · ${words("decisionsCount", { count: proposals.length })}`, [
                    <Text key="to-decide" dimColor>{words("toDecide")}</Text>,
                    ...(proposals.length === 0 ? [<Text key="none-open" dimColor>{words("noneOpen")}</Text>] : limited("open", proposals).map(proposalRow)),
                    more("open", proposals.length, "showAllDecisions"),
                    <Text key="decided-lately" dimColor>{words("decidedLately")}</Text>,
                    ...snapshot.decisions.recent.slice(0, rows.recent).map(decisionRow),
                    <Link key="all-decisions" href={`${snapshot.page}/#decisions`}>{words("allInPage")}</Link>,
                ])}
            </Box>
        );
    });
};

/** The panel's words, in the project's language once it is read. */
function say(current: Board)
{
    return sayer(current.snapshot?.language ?? "en");
}

/** Reads the project again through snapshot.mjs: always when forced, else when one of the files it watches changed since. */
async function refresh($: EngineInterface, force: boolean): Promise<void>
{
    const current = await read($, board);
    const stamp = await stampOf($, current.snapshot?.watch ?? []);

    // Without a project, only a session's start or the command looks again; with one, only a change of its files.
    if (!force && (!current.snapshot || stamp === current.stamp)) {
        return;
    }

    const root = await projectRoot($);

    try {
        // The script looks for the configuration from the session's folder up, as every command of the plugin does.
        const { exitCode, stdout, stderr, isStdoutTruncated } = await $.process.run(["node", `${$.plugin.root}/scripts/snapshot.mjs`], { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, timeoutMs: 60_000 });

        if (exitCode === noProject) {
            await update($, board, (old) => ({ ...old, snapshot: null, problem: sayer("en")("paneNoConfig") }));
            return;
        }

        if (exitCode !== 0 || isStdoutTruncated) {
            throw new Error(stderr.trim() || (isStdoutTruncated ? "the snapshot is too large to read" : `exit ${exitCode}`));
        }

        const snapshot = JSON.parse(stdout) as Snapshot;
        const readAt = await $.clock.now();
        const fresh = await stampOf($, snapshot.watch);
        await update($, board, (old) => ({ ...old, snapshot, problem: null, readAt, stamp: fresh }));
        await readHolds($).catch(() => undefined);
    } catch (error) {
        const problem = sayer(current.snapshot?.language ?? "en")("paneProblem", { problem: error instanceof Error ? error.message : String(error) });
        await update($, board, (old) => ({ ...old, problem }));
    }
}

/** The times and sizes of the watched files, as one string: it changes when one of them does. */
async function stampOf($: EngineInterface, files: string[]): Promise<string>
{
    const parts = await Promise.all(files.map(async (file) => {
        const stat = await $.fs.stat(file).catch(() => undefined);
        return stat ? `${file}:${stat.mtimeMs}:${stat.size}` : `${file}:-`;
    }));
    return parts.join("|");
}

/** The tasks of the colleague just started that their brief cites, moved to in progress; nothing for an agent that is no colleague. */
async function moveCited($: EngineInterface, e: { prompt: string; subagentType: string }, agentId: string | undefined): Promise<void>
{
    const { snapshot } = await read($, board);
    const member = snapshot?.colleagues.find((colleague) => colleague.id === e.subagentType || e.subagentType.endsWith(`:${colleague.id}`));

    if (!snapshot || !member) {
        return;
    }

    const cited = new Set(citedTasks(e.prompt, snapshot.prefixes.task));
    const own = snapshot.tasks.filter((task) => cited.has(task.id) && task.to === member.name);
    const ids = own.filter((task) => task.state !== "doing").map((task) => `${snapshot.prefixes.task}-${task.id}`);
    if (ids.length > 0) {
        await backlog($, ["start", ...ids]);
    }

    // The colleague holds their tasks while they work: the panel shows them at work, and nobody starts them twice.
    await hold($, (held) => applyHold(held, own.map((task) => task.id), { colleague: member.id, agentId: agentId ?? null })).catch(() => undefined);
}

/** Where this chat writes what it holds: one file a chat, beside the other chats' of every project, in the system's temporary folder. */
async function holdFile($: EngineInterface): Promise<string>
{
    const isWindows = (await $.env.get("OS")) === "Windows_NT";
    const temp = (isWindows ? (await $.env.get("TEMP")) || (await $.env.get("TMP")) : (await $.env.get("TMPDIR")) || (await $.env.get("TMP"))) || "/tmp";
    return `${temp.replace(/\\/g, "/").replace(/\/+$/, "")}/claude-project/held-${(await $.session.id()).replace(/[^\w-]/g, "_")}.json`;
}

/** Changes what this chat holds, writes it for the other chats to read, and reads every chat's again. */
async function hold($: EngineInterface, change: (held: Record<string, { colleague: string | null; agentId: string | null }>) => Record<string, { colleague: string | null; agentId: string | null }>): Promise<void>
{
    const file = await holdFile($);
    const root = await projectRoot($);
    const mine = await readHoldFile($, file);
    const held = change(mine && mine.root === root ? mine.tasks : {});
    await $.fs.write(file, JSON.stringify({ root, at: await $.clock.now(), tasks: held }));
    await readHolds($);
}

/** Every chat's holds for this project, the fresh ones, by task number: this chat's win over another's. */
async function readHolds($: EngineInterface): Promise<void>
{
    const file = await holdFile($);
    const folder = file.slice(0, file.lastIndexOf("/"));
    const root = await projectRoot($);
    const session = await $.session.id();
    const now = await $.clock.now();
    const holds: Board["holds"] = {};
    const entries = (await $.fs.exists(folder)) ? await $.fs.list(folder) : [];

    for (const entry of entries.filter((one) => /^held-.+\.json$/.test(one.name)).sort((first) => (`${folder}/${first.name}` === file ? 1 : -1))) {
        const content = await readHoldFile($, `${folder}/${entry.name}`);

        if (!content || content.root !== root || now - content.at > holdsLast) {
            continue;
        }

        const owner = entry.name.slice("held-".length, -".json".length);

        for (const [id, one] of Object.entries(content.tasks)) {
            holds[id] = { session: owner, colleague: one.colleague, agentId: one.agentId };
        }
    }

    await update($, board, (old) => ({ ...old, holds, session: session.replace(/[^\w-]/g, "_") }));
}

async function readHoldFile($: EngineInterface, file: string): Promise<{ root: string; at: number; tasks: Record<string, { colleague: string | null; agentId: string | null }> } | null>
{
    try {
        return JSON.parse(await $.fs.read(file));
    } catch {
        return null;
    }
}

/** The holds with these tasks given to a holder, or let go with none. */
function applyHold<T>(held: Record<string, T>, ids: number[], holder: T | null): Record<string, T>
{
    const next = { ...held };

    for (const id of ids) {
        if (holder) {
            next[String(id)] = holder;
        } else {
            delete next[String(id)];
        }
    }

    return next;
}

/** Claude Code's /reload-plugins, as the user would type it: a plugin changed in its folder is read again. */
async function reloadPlugins($: EngineInterface): Promise<void>
{
    const ran = await $.command.run({ command: "reload-plugins" }).then(() => true, () => false);

    if (!ran) {
        await submit($, "/reload-plugins");
    }
}

/** An extension's action in the panel, a start for instance: a POST to its path on the project's page, then the project read again. */
async function postLink($: EngineInterface, url: string): Promise<void>
{
    const answer = await $.http.fetch(url, { method: "POST" }).catch(() => undefined);

    if (!answer?.ok) {
        $.ui.toast(`${url}: ${answer ? answer.status : "?"}`);
    }

    await refresh($, true);
}

/** Changes the backlog through its own command line, then reads the project again. */
async function backlog($: EngineInterface, args: string[]): Promise<void>
{
    const root = await projectRoot($);
    const { exitCode, stderr } = await $.process.run(["node", `${$.plugin.root}/scripts/backlog.mjs`, ...args], { cwd: root, env: { CLAUDE_PROJECT_DIR: root } });

    if (exitCode !== 0) {
        $.ui.toast(stderr.trim().split("\n")[0] ?? `backlog ${args.join(" ")}`);
    }

    await refresh($, true);
}

/** ▶: a task to do starts, one in progress goes on. A colleague's goes to Crew's next command; Claude's is asked in the chat, as the
 * user would: here, or, when another chat holds it, through that chat. */
async function startTask($: EngineInterface, snapshot: Snapshot, task: Task, member: Member | undefined, elsewhere?: string): Promise<void>
{
    const words = sayer(snapshot.language);
    const id = `${snapshot.prefixes.task}-${task.id}`;
    const isGoingOn = task.state === "doing";
    await markStarting($, task.id);

    if (elsewhere) {
        await submit($, words("promptElsewhere", { id, text: task.text, session: elsewhere }));
        return;
    }

    if (member) {
        const started = await $.command.run({ command: "crew:next", args: `${member.name} -- ${id} · ${task.text}` }).then(() => true, () => false);

        if (!started) {
            await submit($, words("promptGive", { id, name: member.name, text: task.text }));
        }

        return;
    }

    // Claude's own task is in progress from the press, as a colleague's is from their start: the panel moves it before asking.
    if (!isGoingOn) {
        await backlog($, ["start", id]);
    }

    await hold($, (held) => applyHold(held, [task.id], { colleague: null, agentId: null })).catch(() => undefined);
    await submit($, words(isGoingOn ? "promptResume" : "promptWork", { id, text: task.text }) + (task.note ? words("promptNote", { path: task.note }) : ""));
}

/** Done: the task closes through the backlog's command; when its GitHub issue is still open, Claude is asked to ask whether to close it. */
async function markDone($: EngineInterface, snapshot: Snapshot, task: Task): Promise<void>
{
    await backlog($, ["done", `${snapshot.prefixes.task}-${task.id}`]);

    if (task.issueInfo?.state === "open") {
        await submit($, sayer(snapshot.language)("promptIssueClose", { id: `${snapshot.prefixes.task}-${task.id}`, issue: `#${task.issueInfo.number}` }));
    }
}

/** ▶ on a task that waits for others: Claude shows the whole chain, the first first, and starts it on one yes. */
async function startChain($: EngineInterface, snapshot: Snapshot, task: Task): Promise<void>
{
    const id = `${snapshot.prefixes.task}-${task.id}`;
    await markStarting($, task.id);
    await submit($, sayer(snapshot.language)("promptChain", { id, text: task.text, chain: [...task.chain, id].join(" → ") }));
}

/** The ▶ of a task shows that it starts, for a while, so that it is not pressed twice; the old marks go. */
async function markStarting($: EngineInterface, id: number): Promise<void>
{
    const at = await $.clock.now();
    await update($, view, (old) => ({ ...old, starting: { ...Object.fromEntries(Object.entries(old.starting).filter(([, when]) => at - when < startingFor)), [`task-${id}`]: at } }));
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

async function submit($: EngineInterface, text: string): Promise<void>
{
    await $.prompt.submit({ text, asUser: true });
}

async function projectRoot($: EngineInterface): Promise<string>
{
    return (await $.session.root()).replace(/\\/g, "/");
}


type Table = ReturnType<EngineInterface["ui"]["resolve"]>;

/** A bar as wide as the room it gets, as Crew's: its square middle stretches between two rounded ends of a fixed size. */
function wideBar(ui: Table, share: number, color: string | undefined)
{
    const { Box } = ui;

    if (!("Svg" in ui)) {
        return textBar(ui, share, color);
    }

    const part = Math.max(0, Math.min(1, share));
    const alt = `${Math.round(part * 100)}%`;
    const end = (key: string, side: "start" | "end", isFilled: boolean, isOverTrack = false) => <ui.Svg key={key} source={barEndSvg(side, color, isFilled, isOverTrack)} alt={alt} width={3} height={6} />;
    const middle = (key: string, isFilled: boolean) => (
        <Box key={key} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <ui.Svg key={`${key}-drawn`} source={wideBarSvg(color, isFilled)} alt={alt} height={6} />
        </Box>
    );
    return (
        <Box key="bar" flexDirection="row" flexWrap="nowrap" flexGrow={1} minWidth={0}>
            {part > 0
                ? (
                    <Box key="bar-filled" flexDirection="row" flexWrap="nowrap" flexShrink={0} width={part < 1 ? `${Math.max(3, Math.round(part * 100))}%` : "100%"}>
                        {end("bar-filled-start", "start", true)}
                        {middle("bar-filled-middle", true)}
                        {end("bar-filled-end", "end", true, part < 1)}
                    </Box>
                )
                : null}
            {part < 1
                ? (
                    <Box key="bar-track" flexDirection="row" flexWrap="nowrap" flexGrow={1} flexShrink={1} minWidth={0}>
                        {part > 0 ? null : end("bar-track-start", "start", false)}
                        {middle("bar-track-middle", false)}
                        {end("bar-track-end", "end", false)}
                    </Box>
                )
                : null}
        </Box>
    );
}

/** The bar on the terminal: twenty blocks, filled in the color of work or dim. */
function textBar(ui: Table, share: number, color: string | undefined)
{
    const { Text } = ui;
    const filled = Math.round(20 * Math.max(0, Math.min(1, share)));
    return <Text key="bar" color={color} dimColor={!color}>{"█".repeat(filled) + "░".repeat(20 - filled)}</Text>;
}
