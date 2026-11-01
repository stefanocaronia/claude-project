// The project's panel, drawn: its name and the page's link at the top, then its numbers in colored tiles, the buttons that start the
// next work, and its sections, each opening and closing: the extensions' links and the key documents, the tasks in progress, to do and
// postponed, the GitHub issues, the plan's goals, the points to decide, the specifications and the versions.
import type { EngineInterface, RenderInput } from "claude-code";

import { decisionColor, errorColor, priorities, quietColor, scales, workColor, workMark } from "./draw.ts";
import { goalSection } from "./goals.tsx";
import { panelOf } from "./kit.tsx";
import { askChoice, decisionSection, issueSection, linkSections, proposalsOf, releaseSection, specSection } from "./sections.tsx";
import { reloadPlugins, startTask, submit } from "./start.ts";
import { readBoard, readView, say } from "./state.ts";
import { taskLists } from "./tasks.tsx";

export async function drawPanel($: EngineInterface, e: RenderInput<"Pane">)
{
    const board = await readBoard($);
    const view = await readView($);
    const snapshot = board.snapshot;

    if (!snapshot) {
        const { Text } = $.ui.resolve(e);
        return <Text dimColor>{board.problem ?? say(board)("reading")}</Text>;
    }

    const p = panelOf($, e, board, view, snapshot, await $.clock.now());
    const { Box, Text, Button, Link, isDesktop, words, idOf, byName, isStarting, idleButton, priorityIcon } = p;
    const { doing, rest, postponed, busyWith, nextTask, start, taskSection } = taskLists($, p);
    const proposals = proposalsOf(snapshot);
    const nextProposal = proposals[0];
    const busy = busyWith ? words("busyChat", { id: idOf(busyWith) }) : null;
    const errors = snapshot.health?.errors ?? 0;
    // The project at a glance, in colored tiles as Crew's: each opens its tab of the page.
    const tile = (key: string, value: number, label: string, color: string, anchor: string, mark: string | JSX.Element) => (
        <Box key={`tile-${key}`} flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1} {...(isDesktop ? { borderColor: `${color}66`, backgroundColor: `${color}1a` } : { borderDimColor: true })}>
            <Box flexDirection="row" alignItems="center" columnGap={1}>
                {typeof mark === "string" ? <Text color={color}>{mark}</Text> : mark}
                <Link href={`${snapshot.page}/#${anchor}`}>
                    <Text bold color={color}>{String(value)}</Text>
                </Link>
            </Box>
            <Text dimColor wrap="truncate-end">{label}</Text>
        </Box>
    );
    const tiles = [
        tile("doing", doing.length, words("tileDoing"), workColor, "tasks", "●"),
        ...(["P1", "P2", "P3"] as const).map((priority) => tile(
            priority.toLowerCase(),
            snapshot.tasks.filter((task) => task.state === "todo" && task.priority === priority).length,
            words("priorityLabel", { name: snapshot.words.priorities[priority] ?? priority }),
            priorities[priority].color,
            "tasks",
            priorityIcon(priority),
        )),
        tile("open", proposals.length, words("tileOpen"), decisionColor, "decisions", scales),
        tile("errors", errors, words("tileErrors"), errors > 0 ? errorColor : quietColor, "health", "✕"),
    ];
    // What the buttons above the links start: the first task someone here can start, the first decision to take; a short report of
    // where the project stands; GitHub set up; the backlog and the docs tidied.
    const actions = (
        <Box key="actions" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            {busy && !isDesktop ? <Text key="busy" dimColor>{busy}</Text> : null}
            {nextTask
                ? isStarting(nextTask.id)
                    ? idleButton("next-task", words("starting"))
                    : <Button key="next-task" variant="primary" label={words("nextTask", { id: idOf(nextTask) })} onPress={() => startTask($, snapshot, nextTask, byName.get(nextTask.to))} />
                : idleButton("next-task-idle", words("nextTaskIdle"), busy ?? words("noneToStart"))}
            {nextProposal
                ? <Button key="next-decision" label={words("nextDecision")} onPress={() => askChoice($, p, nextProposal)} />
                : idleButton("next-decision-idle", words("nextDecision"), words("noneOpen"))}
            <Button key="where-we-stand" label={words("whereWeStand")} onPress={() => submit($, words("promptWhereWeStand"))} />
            {snapshot.github && (!snapshot.github.tools || !snapshot.github.repo)
                ? <Button key="github" label={words(snapshot.github.tools ? "githubButton" : "githubSetup")} onPress={() => submit($, "/project:github")} />
                : null}
            <Button key="tidy-backlog" label={words("tidyBacklog")} onPress={() => submit($, words("promptTidyBacklog"))} />
            <Button key="tidy-docs" label={words("tidyDocs")} onPress={() => submit($, words("promptTidy"))} />
        </Box>
    );
    const [links, documents] = linkSections($, p);

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
            {[board.problem, ...(snapshot.problems ?? [])].filter((problem): problem is string => Boolean(problem)).map((problem, index) => <Text key={`problem-${index}`} color={errorColor}>{`⚠ ${problem}`}</Text>)}
            <Box key="tiles" flexDirection="row" flexWrap="wrap" gap={1}>{tiles}</Box>
            {actions}
            {links}
            {documents}
            {taskSection("doing", workMark, words("sectionDoing"), doing, words("noneDoing"))}
            {taskSection("rest", "☰", words("sectionRest"), rest, words("noneRest"))}
            {postponed.length > 0 ? taskSection("postponed", "⏸", snapshot.words.states.postponed ?? "", postponed, "") : null}
            {issueSection($, p)}
            {goalSection(p, start)}
            {decisionSection($, p, proposals)}
            {specSection(p)}
            {releaseSection(p)}
        </Box>
    );
}
