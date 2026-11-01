// The plan's goals by phase: each phase's line, then its open goals, each with a bar as wide as the card and its tasks done of all, and
// opened, its open tasks with their ▶; a phase whose goals are all closed, one line. The goals closed are only counted: the page has them.
import type { Goal, Task } from "../types";

import { barEndSvg, goalMark, wideBarSvg, workColor } from "./draw.ts";
import type { Panel } from "./kit.tsx";

export function goalSection(p: Panel, start: (task: Task) => JSX.Element | null)
{
    const { Box, Text, Link, Svg, isDesktop, snapshot, view, words, idOf, opener, card, section, more, limited, face, priorityIcon } = p;
    const openGoals = snapshot.plan.goals.filter((goal) => !goal.closed);
    const closedGoals = snapshot.plan.goals.length - openGoals.length;
    const shown = limited("goals", openGoals);
    const phases = snapshot.plan.phases ?? [];
    // A bar as wide as the room it gets, as Crew's: its square middle stretches between two rounded ends of a fixed size.
    const wideBar = (Drawing: NonNullable<Panel["Svg"]>, share: number, color: string | undefined) => {
        const part = Math.max(0, Math.min(1, share));
        const alt = `${Math.round(part * 100)}%`;
        const end = (key: string, side: "start" | "end", isFilled: boolean, isOverTrack = false) => <Drawing key={key} source={barEndSvg(side, color, isFilled, isOverTrack)} alt={alt} width={3} height={6} />;
        const middle = (key: string, isFilled: boolean) => (
            <Box key={key} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                <Drawing key={`${key}-drawn`} source={wideBarSvg(color, isFilled)} alt={alt} height={6} />
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
    };
    // The bar on the terminal: twenty blocks, filled in the color of work or dim.
    const textBar = (share: number, color: string | undefined) => {
        const filled = Math.round(20 * Math.max(0, Math.min(1, share)));
        return <Text key="bar" color={color} dimColor={!color}>{"█".repeat(filled) + "░".repeat(20 - filled)}</Text>;
    };
    // A goal: its name, a bar as wide as the card, its tasks done of all; opened, its open tasks, those in progress first.
    const goalRow = (goal: Goal) => {
        const key = `goal-${goal.name}`;
        const share = goal.total === 0 ? 0 : goal.done / goal.total;
        const color = goal.isDoing ? workColor : undefined;
        const name = opener(`open-${goal.name}`, key, goal.name, color);
        const count = <Box key={`count-${goal.name}`} flexShrink={0}><Text dimColor tabular>{`${goal.done}/${goal.total}`}</Text></Box>;
        const own = snapshot.tasks.filter((task) => task.goal === goal.name).sort((first, second) => Number(second.state === "doing") - Number(first.state === "doing"));
        return (
            <Box key={key} flexDirection="column">
                {Svg
                    ? (
                        <Box flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                            <Box width={22} flexShrink={0} overflow="hidden">{name}</Box>
                            {wideBar(Svg, share, color)}
                            {count}
                        </Box>
                    )
                    : (
                        <Box flexDirection="column">
                            {name}
                            <Box flexDirection="row" flexWrap="nowrap" gap={1}>
                                {textBar(share, color)}
                                {count}
                            </Box>
                        </Box>
                    )}
                {view.expanded === key
                    ? (
                        <Box key={`goal-tasks-${goal.name}`} flexDirection="column" paddingLeft={2}>
                            <Text dimColor>{words("goalCounts", { done: goal.done, total: goal.total, open: own.length })}</Text>
                            {own.map((task) => (
                                <Box key={`goal-task-${task.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                                    {face(task.to, 18)}
                                    {priorityIcon(task.priority)}
                                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                                        <Text wrap="truncate-end" color={task.state === "doing" ? workColor : undefined}>{`${idOf(task)} ${task.text}`}</Text>
                                    </Box>
                                    {start(task)}
                                </Box>
                            ))}
                        </Box>
                    )
                    : null}
            </Box>
        );
    };

    return section("goals", goalMark, `${words("sectionGoals")} · ${openGoals.length}`, [
        card("goals-card", [
            ...phases.flatMap((phase) => {
                if (phase.isClosed) {
                    return [<Text key={`phase-${phase.number}`} color={workColor}>{words("phaseClosedLabel", { number: phase.number, name: phase.name })}</Text>];
                }

                const own = shown.filter((goal) => goal.phase === phase.number);
                return own.length > 0 ? [<Text key={`phase-${phase.number}`} dimColor bold>{words("phaseLabel", { number: phase.number, name: phase.name })}</Text>, ...own.map(goalRow)] : [];
            }),
            ...shown.filter((goal) => !phases.some((phase) => phase.number === goal.phase)).map(goalRow),
        ]),
        more("goals", openGoals.length, "showAllTasks"),
        closedGoals > 0 ? <Link key="goals-closed" href={`${snapshot.page}/#overview`}>{`✓ ${words("goalsClosed", { count: closedGoals })}`}</Link> : null,
    ], isDesktop && snapshot.plan.updated ? <Text dimColor>{words("planOf", { date: snapshot.plan.updated })}</Text> : null);
}
