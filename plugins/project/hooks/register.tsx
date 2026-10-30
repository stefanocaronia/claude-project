// The project's panel beside the chat: the tasks in progress and the P1 to do, each with ▶ to start it, the plan's goals with their bars,
// the decisions to take and the latest. It draws what scripts/snapshot.mjs reads from the files, and changes them only through
// scripts/backlog.mjs: the scripts own the files, the panel only asks.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { Board, Goal, Member, Proposal, Snapshot, Task, View } from "../types";

import { barEndSvg, claudeSvg, effortSvg, faceSvg, prioritySvg, wideBarSvg } from "./draw.ts";
import { citedTasks } from "../lib/backlog.mjs";
import { sayer } from "../lib/messages.mjs";

const pane = "project";
const command = "project-panel";
const board = atom({ plugin: "project", key: "board" } as const, { snapshot: null, problem: null, readAt: 0, stamp: "" }, { shape: "board-1" });
const view = atom({ plugin: "project", key: "view" } as const, { sections: {}, expanded: null, whole: {}, starting: {} }, { shape: "view-1" });
// The sections open at the start, as Joseph's sketch has them: the decisions closed, the tile above says how many wait.
const openAtStart: Record<string, boolean> = { links: true, doing: true, rest: true, goals: true, decisions: false };
// How many rows a section shows before "show all".
const rows: Record<string, number> = { doing: 5, rest: 10, goals: 5, open: 3, recent: 3 };
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
const quietColor = "#888780";
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
        await moveCited($, e).catch(() => undefined);
        return spawned;
    });

    // The files are read again once a turn ends, Claude's or a colleague's, when one of them changed.
    on("turn.complete", async ($, e, next) => {
        const completed = await next(e);
        await refresh($, false).catch(() => undefined);
        return completed;
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
        const doing = snapshot.tasks.filter((task) => task.state === "doing");
        // Everything still to do, as Crew's backlog lists it: by priority, then the oldest; the postponed after.
        const order = (task: Task) => `${task.state === "postponed" ? 1 : 0}${task.priority}${task.created}`;
        const rest = snapshot.tasks.filter((task) => task.state === "todo" || task.state === "postponed").sort((first, second) => order(first).localeCompare(order(second)));
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
        // Material's outlined card, with the state layer under the pointer, as Crew's.
        const card = (key: string, children: (JSX.Element | null)[]) => (
            <Box key={key} flexDirection="column" borderStyle="round" {...border} paddingX={1} {...(isDesktop ? { hover: { backgroundColor: stateLayer } } : {})}>
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

            // Nobody starts a person's own task but them.
            if (!member && task.to !== "Claude") {
                return null;
            }

            if (isStarting(key)) {
                return <Box key={`starting-${task.id}`} flexShrink={0}><Text dimColor wrap="truncate">{words("starting")}</Text></Box>;
            }

            return <Button key={`start-${task.id}`} plain dimColor label="▶" onPress={() => startTask($, snapshot, task, member)} />;
        };
        const taskRow = (task: Task) => {
            const key = `task-${task.id}`;
            const isExpanded = panel.expanded === key;
            const member = byName.get(task.to);
            const facts = [`${prefix}-${task.id}`, `${task.priority} ${words("priorityLabel", { name: snapshot.words.priorities[task.priority] ?? "" })}`, `${words("effort")} ${task.effort}`, member?.fullName ?? task.to, task.goal === snapshot.words.noGoal ? null : task.goal, words("born", { date: task.created })];
            return card(key, [
                <Box key={`row-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                    {face(task.to, 24)}
                    {priorityMark(task)}
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                        <Button key={`open-${task.id}`} plain onPress={expand(key)}>
                            <Text wrap="truncate-end">{`${isExpanded ? "▾" : "▸"} ${task.text}`}</Text>
                        </Button>
                    </Box>
                    <Box flexShrink={0}><Text dimColor wrap="truncate">{age(task.created)}</Text></Box>
                    {effortCell(task)}
                    {start(task)}
                </Box>,
                isExpanded
                    ? (
                        <Box key={`details-${task.id}`} flexDirection="column" gap={1} paddingLeft={isDesktop ? 4 : 2}>
                            <Text>{task.text}</Text>
                            <Text dimColor>{facts.filter(Boolean).join(" · ")}</Text>
                            <Box flexDirection="row" columnGap={2}>
                                <Button key={`done-${task.id}`} plain label={words("markDone")} onPress={() => backlog($, ["done", `${prefix}-${task.id}`])} />
                                {task.state === "postponed" ? null : <Button key={`postpone-${task.id}`} plain dimColor label={words("postpone")} onPress={() => backlog($, ["postpone", `${prefix}-${task.id}`])} />}
                            </Box>
                        </Box>
                    )
                    : null,
            ]);
        };
        const taskSection = (key: "doing" | "rest", icon: string, title: string, tasks: Task[], none: string) => section(key, icon, `${title} · ${tasks.length}`, [
            ...(tasks.length === 0 ? [<Text key={`none-${key}`} dimColor>{none}</Text>] : limited(key, tasks).map(taskRow)),
            more(key, tasks.length, "showAllTasks"),
        ]);

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
        const nextTask = rest.find((task) => task.state === "todo" && (task.to === "Claude" || byName.has(task.to)));
        const nextProposal = proposals[0];
        const actions = (
            <Box key="actions" flexDirection="row" flexWrap="wrap" gap={1}>
                {nextTask
                    ? isStarting(`task-${nextTask.id}`)
                        ? <Button key="next-task" label={words("starting")} onPress={() => undefined} />
                        : <Button key="next-task" variant="primary" label={words("nextTask", { id: `${prefix}-${nextTask.id}` })} onPress={() => startTask($, snapshot, nextTask, byName.get(nextTask.to))} />
                    : null}
                {nextProposal ? <Button key="next-decision" label={words("nextDecision")} onPress={() => submit($, words("promptChoice", { line: nextProposal.line, text: nextProposal.whole }))} /> : null}
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
                {taskSection("doing", "⚒︎", words("sectionDoing"), doing, words("noneDoing"))}
                {taskSection("rest", "☰", words("sectionRest"), rest, words("noneRest"))}
                {section("goals", "⚑︎", `${words("sectionGoals")} · ${snapshot.plan.goals.length}`, [
                    card("goals-card", limited("goals", snapshot.plan.goals).map(goalRow)),
                    more("goals", snapshot.plan.goals.length, "showAllTasks"),
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
        await update($, board, () => ({ snapshot, problem: null, readAt, stamp: fresh }));
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
async function moveCited($: EngineInterface, e: { prompt: string; subagentType: string }): Promise<void>
{
    const { snapshot } = await read($, board);
    const member = snapshot?.colleagues.find((colleague) => colleague.id === e.subagentType || e.subagentType.endsWith(`:${colleague.id}`));

    if (!snapshot || !member) {
        return;
    }

    const cited = new Set(citedTasks(e.prompt, snapshot.prefixes.task));
    const ids = snapshot.tasks.filter((task) => cited.has(task.id) && task.to === member.name && task.state !== "doing").map((task) => `${snapshot.prefixes.task}-${task.id}`);

    if (ids.length > 0) {
        await backlog($, ["start", ...ids]);
    }
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

/** ▶: a colleague's task goes to Crew's next command, which starts it; Claude's is asked in the chat, as the user would. */
async function startTask($: EngineInterface, snapshot: Snapshot, task: Task, member: Member | undefined): Promise<void>
{
    const words = sayer(snapshot.language);
    const id = `${snapshot.prefixes.task}-${task.id}`;
    const at = await $.clock.now();
    await update($, view, (old) => ({ ...old, starting: { ...Object.fromEntries(Object.entries(old.starting).filter(([, when]) => at - when < startingFor)), [`task-${task.id}`]: at } }));

    if (member) {
        const started = await $.command.run({ command: "crew:next", args: `${member.name} -- ${id} · ${task.text}` }).then(() => true, () => false);

        if (!started) {
            await submit($, words("promptGive", { id, name: member.name, text: task.text }));
        }

        return;
    }

    await submit($, words("promptWork", { id, text: task.text }));
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
