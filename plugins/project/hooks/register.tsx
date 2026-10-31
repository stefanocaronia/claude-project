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
const view = atom({ plugin: "project", key: "view" } as const, { sections: {}, expanded: null, whole: {}, starting: {}, frozen: null }, { shape: "view-1" });
// The sections open at the start, as Joseph's sketch has them: the decisions closed, the tile above says how many wait.
const openAtStart: Record<string, boolean> = { links: true, documents: true, doing: true, rest: true, postponed: false, issues: true, goals: true, decisions: true };
// How many rows a section shows before "show all".
const rows: Record<string, number> = { doing: 5, rest: 10, postponed: 5, issues: 5, goals: 5, open: 3 };
const proposalLength = 400;
// The text of a new task being written: kept across the drawings its pickers cause, not across a reload.
let newText = "";
// How long «Archive» waits for its second press.
const archiveAskFor = 4000;
// Crew's marks: a priority as an issue tracker draws it, the green of work, the purple of decisions, the red of errors.
const priorities = { P1: { glyph: "⇈", color: "#E5493A" }, P2: { glyph: "=", color: "#E2852B" }, P3: { glyph: "↓", color: "#4C8FE0" } } as const;
const markOf = (priority: string) => priorities[priority as keyof typeof priorities] ?? priorities.P2;
const nextPriority: Record<string, string | undefined> = { P1: "P2", P2: "P3", P3: "P1" };
const workColor = "#4E9A6B";
const decisionColor = "#8A63C9";
// A task's number beside its title, as a decision's is beside its own, in a color of its own.
const taskColor = "#2E9AA6";
// The mark of a decision, taken or to take: the scales, drawn as text so that it stays one color.
const scales = "⚖︎";
const errorColor = "#D0453F";
// Material's outline, its hover state layer, and the gray of a count with nothing wrong, readable in both themes.
const outline = "#8080803d";
const stateLayer = "#80808014";
// A link's or a document's chip under the pointer: one line high, no border, a stronger gray.
const chipHover = "#80808029";
// Every card's faint gray, the same for all, as Crew's.
const cardTint = "#80808003";
const quietColor = "#888780";
// A ▶ that cannot be pressed now: gray, fainter than a dim one.
const idleColor = "#80808040";
// How long the lists keep their order after a priority turns.
const frozenFor = 4000;
const warningColor = "#E2852B";
// A hint in Material's inverse colors, which read on both themes, as Crew's.
const tooltipBackground = "#2b2b29";
const tooltipText = "#f4f4f1";
const effortMeters: Record<string, string> = { low: "▮▯▯▯", medium: "▮▮▯▯", high: "▮▮▮▯", xhigh: "▮▮▮▮", max: "▮▮▮▮", none: "" };
// The exit code of snapshot.mjs in a folder with no project above it.
const noProject = 3;
// How long a start asked from the panel shows on its button, at most, while Claude starts the work.
const startingFor = 120_000;
// Whether this module has read the project since it was loaded: a reload of the plugins keeps the panel's state, not this, so the first
// drawing after one reads the project again, as a new session would.
let hasRead = false;

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
        if (!hasRead) {
            hasRead = true;
            void refresh($, true).catch(() => undefined);
        }

        const ui = $.ui.resolve(e);
        const { Box, Text, Button, Link, Input, Select } = ui;
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
        // Just after a priority turns, the lists keep the order they had, so that the task stays under the pointer; then they sort again.
        const frozen = panel.frozen && now < panel.frozen.until ? panel.frozen.rank : null;
        const byOrder = (first: Task, second: Task) => (frozen ? (frozen[String(first.id)] ?? Number.MAX_SAFE_INTEGER) - (frozen[String(second.id)] ?? Number.MAX_SAFE_INTEGER) : 0) || order(first).localeCompare(order(second)) || first.id - second.id;
        const rest = snapshot.tasks.filter((task) => task.state === "todo" && !isGrouped(task)).sort(byOrder);
        // The postponed in a section of their own, after the tasks to do, in the same order.
        const postponed = snapshot.tasks.filter((task) => task.state === "postponed" && !isGrouped(task)).sort(byOrder);
        // Where each task stands now, the parts after their large task: what a priority's turn keeps for a moment.
        const shownRank = new Map([...rest, ...postponed].flatMap((task) => [task, ...snapshot.tasks.filter((part) => part.parent === `${prefix}-${task.id}`).sort(byOrder)]).map((task, index) => [task.id, index]));
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

        // Who holds a task: Claude's critter, a colleague's portrait or initials, the owner's GitHub picture, a person's initials in gray.
        const owner = snapshot.owner;
        const decider = owner?.name ?? snapshot.people.find((person) => person !== "Claude") ?? null;
        const face = (name: string, size: number) => {
            const member = byName.get(name) ?? (owner && name === owner.name ? { id: name, name, fullName: owner.fullName, role: "", color: "gray", portrait: owner.portrait } : undefined);

            if (!Svg) {
                return <Text key={`face-${name}`} color={member?.color} dimColor={!member}>●</Text>;
            }

            const source = name === "Claude" ? claudeSvg(size) : faceSvg(member ?? { id: name, name, fullName: name, role: "", color: "gray" }, member?.portrait, size);
            return <Svg key={`face-${name}`} source={source} alt={member?.fullName ?? name} width={size} height={size} />;
        };
        // A press on a task's priority turns it, P1, P2, P3 and P1 again: a clear button laid over the drawn mark takes the press.
        const priorityMark = (task: Task) => {
            const mark = markOf(task.priority);
            const turn = async () => {
                await freezeOrder($, Object.fromEntries(snapshot.tasks.map((one) => [String(one.id), shownRank.get(one.id) ?? Number.MAX_SAFE_INTEGER])));
                await backlog($, ["set", `${prefix}-${task.id}`, "--p", nextPriority[task.priority] ?? "P1"]);
            };
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
                return idle(task, words("playBusy", { id: `${prefix}-${busyWith.id}` }));
            }

            // A large task is done through its parts: its ▶ starts the next one, by priority and age, free and to do.
            if (isLarge(task)) {
                const part = snapshot.tasks.find((one) => `${prefix}-${one.id}` === task.nextPart);
                const isStartable = part && (part.to === "Claude" || byName.has(part.to)) && !isStarting(`task-${part.id}`);
                return part && isStartable ? <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={() => startTask($, snapshot, part, byName.get(part.to))} /> : idle(task, words("playNoPart"));
            }

            // Nobody starts a person's own task but them.
            if (!member && task.to !== "Claude") {
                return idle(task, words("playPerson", { name: task.to }));
            }

            // Who holds it now decides what ▶ does; the user sees only whether there is one. A colleague at work, or this very chat, needs
            // no ▶; another chat goes on through a message here; a task nobody holds is taken up again.
            const held = task.state === "doing" ? current.holds[String(task.id)] : undefined;

            if (held?.colleague) {
                const at = snapshot.colleagues.find((colleague) => colleague.id === held.colleague);
                return <Box key={`working-${task.id}`} flexShrink={0}><Text color={workColor} wrap="truncate">{`⚒︎ ${at?.name ?? held.colleague}`}</Text></Box>;
            }

            if (held && held.session === current.session) {
                return idle(task, words("playHere"));
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
        // A button that cannot be pressed now keeps its place and its size, the surface's own button drawn dim, a press doing nothing;
        // its reason under the pointer.
        const idleButton = (key: string, label: string, reason: string) => tip(key, reason, <Button key={key} label={label} onPress={() => undefined}><Text color={idleColor}>{label}</Text></Button>);
        // A ▶ that cannot be pressed now stays in its place, gray, its reason under the pointer.
        const idle = (task: Task, reason: string) => tip(`idle-${task.id}`, reason, <Box key={`idle-${task.id}`} flexShrink={0}><Text color={idleColor}>▶</Text></Box>);
        // In place of its age, a blocked task shows what it waits for: «⛓ T-62», and how many more; a large task, its parts closed. On the
        // desktop a hint under the pointer says it in words.
        // After those, a due day near or past, «⏰ 3 g», red when late; a task stuck in progress, «⏸ 4 g», in the color of a warning.
        // A large task's parts, shown or folded: as the user left them, else shown while one is in progress.
        const isUnfolded = (task: Task) => panel.folds?.[String(task.id)] ?? snapshot.tasks.some((part) => part.parent === `${prefix}-${task.id}` && part.state === "doing");
        const toggleParts = (task: Task) => () => void update($, view, (old) => ({ ...old, folds: { ...old.folds, [String(task.id)]: !isUnfolded(task) } }));
        // In a large task's row, its parts closed as a chip with an arrow, that shows or folds them.
        const partsChip = (task: Task) => {
            const isDoing = task.state === "doing";
            const text = `${isUnfolded(task) ? "▾" : "▸"} ${task.partsDone}/${task.parts.length}`;
            const label = <Button key={`parts-${task.id}`} plain onPress={toggleParts(task)}><Text color={isDoing ? workColor : undefined} dimColor={!isDoing}>{isDesktop ? text : `[${text}]`}</Text></Button>;
            const button = isDesktop ? <Box key={`parts-box-${task.id}`} flexShrink={0} paddingX={1} backgroundColor={isDoing ? `${workColor}26` : stateLayer}>{label}</Box> : label;
            return tip(`parts-${task.id}`, words("partsTip", { done: task.partsDone, total: task.parts.length }), button);
        };
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
        // A task opened: its whole text, then chips for what the row does not show (its goal, its days, its issue and note), then a
        // labeled row of chips for each tie (parts, waits, links both ways, decisions, code). What the row shows already, who holds it,
        // its type, priority, effort and number, is not said again. A chip is one line high: a tinted background, no border.
        const chip = (key: string, text: string, color?: string, href?: string | null, hint?: string) => {
            const label = href ? <Link key={`${key}-link`} href={href}>{text}</Link> : <Text key={`${key}-text`} color={color} dimColor={!color}>{text}</Text>;
            const drawn = isDesktop
                ? <Box key={key} flexShrink={0} paddingX={1} backgroundColor={color ? `${color}26` : stateLayer}>{label}</Box>
                : <Box key={key} flexShrink={0}>{href ? label : <Text color={color} dimColor={!color}>{`[${text}]`}</Text>}</Box>;
            return hint ? tip(key, hint, drawn) : drawn;
        };
        const refColor = (id: string) => (id.startsWith(`${snapshot.prefixes.decision}-`) ? decisionColor : id.startsWith(`${prefix}-`) ? taskColor : undefined);
        const refs = (key: string, ids: string[]) => ids.map((id) => chip(`${key}-${id}`, id, refColor(id)));
        const field = (key: string, label: string, chips: (JSX.Element | null)[]) => {
            const shown = chips.filter((one): one is JSX.Element => one !== null);
            return shown.length > 0
                ? (
                    <Box key={key} flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
                        <Box width={13} flexShrink={0}><Text dimColor>{label}</Text></Box>
                        {shown}
                    </Box>
                )
                : null;
        };
        // A part drawn under its large task does not name it again.
        const taskDetails = (task: Task, isPart = false) => {
            const id = `${prefix}-${task.id}`;
            const due = task.dueInfo;
            const issue = task.issueInfo;
            const latest = (task.commits ?? [])[0];
            const pullState = (pull: Pull) => (pull.merged ? words("pullMerged", { day: pull.merged }) : words(pull.state === "open" ? "pullOpen" : "pullClosed"));
            const what = [
                task.goal === snapshot.words.noGoal ? null : chip(`goal-chip-${task.id}`, `⚑ ${task.goal}`),
                task.due ? chip(`due-chip-${task.id}`, due && (due.isLate || due.isNear) ? `⏰ ${dueWords(due)}` : words("dueLabel", { day: task.due }), due?.isLate ? errorColor : due?.isNear ? warningColor : undefined, null, words("dueTip", { day: task.due })) : null,
                task.started && task.state === "doing" ? chip(`started-chip-${task.id}`, words(task.stale ? "staleTip" : "startedLabel", { day: task.started }), task.stale ? warningColor : workColor) : null,
                ...Object.entries(task.fields ?? {}).map(([key, value]) => chip(`field-chip-${task.id}-${key}`, `${snapshot.fields?.[key]?.name ?? key}: ${value}`)),
                chip(`born-chip-${task.id}`, task.by ? words("bornBy", { date: task.created, name: task.by }) : words("born", { date: task.created })),
                issue ? chip(`issue-chip-${task.id}`, `◉ #${issue.number} ${words(issue.state === "open" ? "issueStateOpen" : "issueStateClosed")}`, undefined, issue.url, issue.title) : null,
                task.noteHref ? chip(`note-chip-${task.id}`, words("openNote"), undefined, task.noteHref) : null,
            ].filter((one): one is JSX.Element => one !== null);
            return [
                <Text key={`text-${task.id}`}>{task.text}</Text>,
                <Box key={`what-${task.id}`} flexDirection="row" flexWrap="wrap" gap={1}>{what}</Box>,
                field(`part-of-${task.id}`, words("labelPartOf"), task.parent && !isPart ? refs(`part-of-${task.id}`, [task.parent]) : []),
                field(`parts-${task.id}`, words("labelParts", { done: task.partsDone, total: (task.parts ?? []).length }), refs(`parts-${task.id}`, task.parts ?? [])),
                field(`waits-${task.id}`, words("labelWaits"), refs(`waits-${task.id}`, task.after ?? [])),
                field(`chain-${task.id}`, words("labelChain"), (task.chain ?? []).length > 0 ? [chip(`chain-chip-${task.id}`, `⛓ ${[...task.chain, id].join(" → ")}`, warningColor)] : []),
                field(`waited-${task.id}`, words("labelWaitedBy"), refs(`waited-${task.id}`, task.waitedBy ?? [])),
                // A decision it points to is among its decisions: «see» keeps the rest.
                field(`see-${task.id}`, words("labelSee"), refs(`see-${task.id}`, (task.see ?? []).filter((one) => !(task.decisions ?? []).includes(one)))),
                field(`seen-${task.id}`, words("labelSeenFrom"), refs(`seen-${task.id}`, task.seenFrom ?? [])),
                field(`decisions-${task.id}`, words("labelDecisions"), refs(`decisions-${task.id}`, task.decisions ?? [])),
                field(`code-${task.id}`, words("labelCode"), [
                    latest ? chip(`commits-${task.id}`, words("commitsCount", { count: task.commitCount, day: latest.day }), undefined, latest.url, latest.subject) : null,
                    ...(task.pulls ?? []).map((pull) => chip(`pull-${task.id}-${pull.number}`, `#${pull.number} ${pullState(pull)}`, pull.merged ? workColor : undefined, pull.url, pull.title)),
                ]),
                task.mergedPull ? <Text key={`merged-${task.id}`} color={workColor}>{`✓ ${words("mergedCanClose", { number: task.mergedPull.number })}`}</Text> : null,
            ];
        };
        // A task's id, and for a large task its parts in a state too: a large task postponed or put back to do takes those parts along.
        const withParts = (task: Task, state: Task["state"]) => [`${prefix}-${task.id}`, ...snapshot.tasks.filter((part) => part.parent === `${prefix}-${task.id}` && part.state === state).map((part) => `${prefix}-${part.id}`)];
        // A task's text written again, in the open task; a task archived on a second press, the first asks for a few seconds.
        const saveText = (task: Task, value: string) => {
            const text = value.replace(/\s+/g, " ").trim();
            void update($, view, (old) => ({ ...old, editing: null }));

            if (text && text !== task.text) {
                void backlog($, ["set", `${prefix}-${task.id}`, "--text", text.replaceAll(" · ", " - ")]);
            }
        };
        const askArchive = (task: Task) => {
            void update($, view, (old) => ({ ...old, archiving: task.id }));
            $.clock.after(archiveAskFor, () => void update($, view, (old) => (old.archiving === task.id ? { ...old, archiving: null } : old)));
        };
        const archive = (task: Task) => {
            void update($, view, (old) => ({ ...old, archiving: null, expanded: null }));
            void backlog($, ["archive", `${prefix}-${task.id}`]);
        };
        // A new task, written in the list to do with its priority, its type and the large task it is a part of: its creator is the
        // person the panel is for, as the page's owner.
        const draft = { priority: "P2", type: "", parent: "", ...panel.draft };
        const addTask = (value: string) => {
            const text = value.replace(/\s+/g, " ").trim();
            newText = "";
            void update($, view, (old) => ({ ...old, editing: null, draft: undefined }));

            if (text) {
                void backlog($, ["add", text.replaceAll(" · ", " - "), "--p", draft.priority, ...(draft.type ? ["--type", draft.type] : []), ...(draft.parent ? ["--in", draft.parent] : []), ...(decider ? ["--by", decider] : [])]);
            }
        };
        const pick = (field: "priority" | "type" | "parent") => (value: string) => void update($, view, (old) => ({ ...old, draft: { ...draft, ...old.draft, [field]: value } }));
        // A large task takes parts one level deep: the open tasks that are no part themselves.
        const parents = snapshot.tasks.filter((task) => !task.parent).sort(byOrder);
        const newTask = () => (panel.editing === "new"
            ? (
                <Box key="new-task-form" flexDirection="column" gap={1}>
                    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                        <Select key="new-priority" label={words("fieldPriority")} value={draft.priority} options={(["P1", "P2", "P3"] as const).map((key) => ({ value: key, label: `${key} · ${snapshot.words.priorities[key] ?? key}` }))} onSelect={pick("priority")} />
                        <Select key="new-type" label={words("fieldType")} value={draft.type} options={[{ value: "", label: "—" }, ...Object.entries(snapshot.types ?? {}).map(([key, name]) => ({ value: key, label: name }))]} onSelect={pick("type")} />
                        <Select key="new-parent" label={words("fieldParent")} value={draft.parent} options={[{ value: "", label: "—" }, ...parents.map((task) => ({ value: `${prefix}-${task.id}`, label: `${prefix}-${task.id} · ${task.text.length > 40 ? `${task.text.slice(0, 40)}…` : task.text}` }))]} onSelect={pick("parent")} />
                    </Box>
                    <Input key="new-task" value={newText} placeholder={words("newTaskHint")} autoFocus submitLabel={words("addTask")} onInput={(value) => { newText = value; }} onSubmit={addTask} />
                    <Button key="new-task-cancel" plain dimColor label={words("cancelEdit")} onPress={() => { newText = ""; void update($, view, (old) => ({ ...old, editing: null, draft: undefined })); }} />
                </Box>
            )
            : <Button key="new-task" plain dimColor label={words("newTask")} onPress={() => void update($, view, (old) => ({ ...old, editing: "new" }))} />);
        const taskRow = (task: Task) => {
            const parts = snapshot.tasks.filter((part) => part.parent === `${prefix}-${task.id}`)
                .sort((first, second) => (frozen ? 0 : Number(second.state === "doing") - Number(first.state === "doing")) || byOrder(first, second));
            // Its parts closed first, checked and without ▶, in the order they closed; then the open ones.
            const closed = (snapshot.doneParts ?? []).filter((part) => part.parent === `${prefix}-${task.id}`)
                .sort((first, second) => (first.done ?? "").localeCompare(second.done ?? "") || first.id - second.id);
            return card(`task-${task.id}`, !isUnfolded(task) ? taskLines(task) : [
                ...taskLines(task),
                ...closed.map((part) => (
                    <Box key={`done-part-${part.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center" paddingLeft={isDesktop ? 4 : 2}>
                        {face(part.to, 18)}
                        {typeMark({ id: part.id, type: part.type } as Task)}
                        <Box flexShrink={0}><Text color={workColor}>✓</Text></Box>
                        <Box flexShrink={0}><Text color={taskColor} dimColor>{`${prefix}-${part.id}`}</Text></Box>
                        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden"><Text dimColor strikethrough wrap="truncate-end">{part.text}</Text></Box>
                    </Box>
                )),
                ...parts.map((part) => <Box key={`part-${part.id}`} flexDirection="column" paddingLeft={isDesktop ? 4 : 2}>{taskLines(part, true)}</Box>),
            ]);
        };
        // A part, under its large task, has a smaller face.
        const taskLines = (task: Task, isPart = false) => {
            const key = `task-${task.id}`;
            const isExpanded = panel.expanded === key;
            return [
                <Box key={`row-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                    {face(task.to, isPart ? 18 : 24)}
                    {typeMark(task)}
                    {priorityMark(task)}
                    <Box flexShrink={0}><Text color={taskColor} bold>{`${prefix}-${task.id}`}</Text></Box>
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
                            {panel.editing === key
                                ? <Input key={`edit-${task.id}`} value={task.text} rows={2} autoFocus submitLabel={words("saveText")} onSubmit={(value) => saveText(task, value)} />
                                : taskDetails(task, isPart)}
                            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                                <Button key={`done-${task.id}`} plain label={words("markDone")} onPress={() => markDone($, snapshot, task)} />
                                {task.state === "postponed"
                                    ? <Button key={`resume-${task.id}`} plain label={words("backToDo")} onPress={() => backlog($, ["todo", ...withParts(task, "postponed")])} />
                                    : <Button key={`postpone-${task.id}`} plain dimColor label={words("postpone")} onPress={() => backlog($, ["postpone", ...withParts(task, "todo")])} />}
                                <Button key={`edit-text-${task.id}`} plain dimColor label={words(panel.editing === key ? "cancelEdit" : "editText")} onPress={() => void update($, view, (old) => ({ ...old, editing: old.editing === key ? null : key }))} />
                                {panel.archiving === task.id
                                    ? <Button key={`archive-${task.id}`} plain label={words("archiveSure", { id: `${prefix}-${task.id}` })} onPress={() => archive(task)} />
                                    : <Button key={`archive-${task.id}`} plain dimColor label={words("archive")} onPress={() => askArchive(task)} />}
                            </Box>
                        </Box>
                    )
                    : null,
            ];
        };
        const taskSection = (key: "doing" | "rest" | "postponed", icon: string, title: string, tasks: Task[], none: string) => section(key, icon, `${title} · ${tasks.length}`, [
            ...(key === "rest" ? [newTask()] : []),
            ...(tasks.length === 0 ? [<Text key={`none-${key}`} dimColor>{none}</Text>] : limited(key, tasks).map(taskRow)),
            more(key, tasks.length, "showAllTasks"),
        ]);

        // The goals by phase: each phase's line, then its open goals; a phase whose goals are all closed, one line that says so.
        const goalItems = () => {
            const phases = snapshot.plan.phases ?? [];
            const shown = limited("goals", openGoals);
            return [
                ...phases.flatMap((phase) => {
                    if (phase.isClosed) {
                        return [<Text key={`phase-${phase.number}`} color={workColor}>{words("phaseClosedLabel", { number: phase.number, name: phase.name })}</Text>];
                    }

                    const own = shown.filter((goal) => goal.phase === phase.number);
                    return own.length > 0 ? [<Text key={`phase-${phase.number}`} dimColor bold>{words("phaseLabel", { number: phase.number, name: phase.name })}</Text>, ...own.map(goalRow)] : [];
                }),
                ...shown.filter((goal) => !phases.some((phase) => phase.number === goal.phase)).map(goalRow),
            ];
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
                    {decider ? face(decider, 24) : null}
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
                {busyWith && !isDesktop ? <Text key="busy" dimColor>{words("busyChat", { id: `${prefix}-${busyWith.id}` })}</Text> : null}
                {nextTask
                    ? isStarting(`task-${nextTask.id}`)
                        ? <Button key="next-task" label={words("starting")} onPress={() => undefined} />
                        : <Button key="next-task" variant="primary" label={words("nextTask", { id: `${prefix}-${nextTask.id}` })} onPress={() => startTask($, snapshot, nextTask, byName.get(nextTask.to))} />
                    : idleButton("next-task-idle", words("nextTaskIdle"), busyWith ? words("busyChat", { id: `${prefix}-${busyWith.id}` }) : words("noneToStart"))}
                {nextProposal
                    ? <Button key="next-decision" label={words("nextDecision")} onPress={() => submit($, words("promptChoice", { line: nextProposal.line, text: nextProposal.whole }))} />
                    : idleButton("next-decision-idle", words("nextDecision"), words("noneOpen"))}
                <Button key="where-we-stand" label={words("whereWeStand")} onPress={() => submit($, words("promptWhereWeStand"))} />
                <Button key="tidy-backlog" label={words("tidyBacklog")} onPress={() => submit($, words("promptTidyBacklog"))} />
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
                                <Box key={`link-box-${index}`} paddingX={1} {...(isDesktop ? { backgroundColor: stateLayer, hover: { backgroundColor: chipHover } } : {})}>
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
                                <Box key={`document-box-${index}`} paddingX={1} {...(isDesktop ? { backgroundColor: stateLayer, hover: { backgroundColor: chipHover } } : {})}>
                                    {document.exists ? <Link key={`document-${index}`} href={document.href}>{document.name}</Link> : <Text key={`document-${index}`} dimColor>{document.name}</Text>}
                                </Box>
                            ))}
                        </Box>,
                    ])
                    : null}
                {taskSection("doing", "⚒︎", words("sectionDoing"), doing, words("noneDoing"))}
                {taskSection("rest", "☰", words("sectionRest"), rest, words("noneRest"))}
                {postponed.length > 0 ? taskSection("postponed", "⏸", snapshot.words.states.postponed, postponed, "") : null}
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
                    card("goals-card", goalItems()),
                    more("goals", openGoals.length, "showAllTasks"),
                    closedGoals > 0 ? <Link key="goals-closed" href={`${snapshot.page}/#overview`}>{`✓ ${words("goalsClosed", { count: closedGoals })}`}</Link> : null,
                ], isDesktop && snapshot.plan.updated ? <Text dimColor>{words("planOf", { date: snapshot.plan.updated })}</Text> : null)}
                {section("decisions", "⚖︎", `${words("toDecide")} · ${proposals.length}`, [
                    ...(proposals.length === 0 ? [<Text key="none-open" dimColor>{words("noneOpen")}</Text>] : limited("open", proposals).map(proposalRow)),
                    more("open", proposals.length, "showAllDecisions"),
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

/** Keeps the lists' order for a moment, then lets them sort again: the drawing after the wait reads the order freed. */
async function freezeOrder($: EngineInterface, rank: Record<string, number>): Promise<void>
{
    const until = (await $.clock.now()) + frozenFor;
    await update($, view, (old) => ({ ...old, frozen: { until, rank } }));
    $.clock.after(frozenFor, () => void update($, view, (old) => (old.frozen && old.frozen.until <= until ? { ...old, frozen: null } : old)));
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

/** A prompt asked as the user would ask it; one that is a slash command, `/project:tidy …`, runs that command, so that its skill is loaded. */
async function submit($: EngineInterface, text: string): Promise<void>
{
    const command = /^\/(\S+)\s*([\s\S]*)$/.exec(text);

    if (command) {
        await $.command.run({ command: command[1], args: command[2] });
        return;
    }

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
