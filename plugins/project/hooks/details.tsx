// A task opened in its row: its whole text, then chips for what the row does not show (its goal, its days, its fields, its issue and
// note), then a labeled row of chips for each tie (parts, waits, links both ways, decisions, specs, code). What the row shows already,
// who holds it, its type, priority, effort and number, is not said again. Below, what can be done with it: done, postponed or back to
// do, its text and fields written again, archived.
import type { EngineInterface } from "claude-code";

import type { Pull, Task } from "../types";

import { decisionColor, errorColor, taskColor, warningColor, workColor } from "./draw.ts";
import { noChoice, oneLine } from "./kit.tsx";
import type { Panel } from "./kit.tsx";
import { backlog } from "./project.ts";
import { markDone } from "./start.ts";

// How long «Archive» waits for its second press.
const archiveAskFor = 4000;

export function taskDetails($: EngineInterface, p: Panel)
{
    const { Box, Text, Button, Link, Input, Select, hasForms, isDesktop, view, snapshot, words, prefix, idOf, partsOf, change, chip, dueWords, linkedText } = p;
    const choices = (values: string[]) => values.map((value) => ({ value, label: value }));
    const refColor = (id: string) => (id.startsWith(`${snapshot.prefixes.decision}-`) ? decisionColor : id.startsWith(`${prefix}-`) ? taskColor : undefined);
    // A labeled row of chips, none without one.
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
    const facts = (task: Task, isPart: boolean) => {
        const due = task.dueInfo;
        const issue = task.issueInfo;
        const latest = (task.commits ?? [])[0];
        const pullState = (pull: Pull) => (pull.merged ? words("pullMerged", { day: pull.merged }) : words(pull.state === "open" ? "pullOpen" : "pullClosed"));
        const ties = (name: string, label: string, ids: string[]) => field(`${name}-${task.id}`, label, ids.map((id) => chip(`${name}-${task.id}-${id}`, id, refColor(id))));
        const what = [
            task.goal === snapshot.words.noGoal ? null : chip(`goal-chip-${task.id}`, `⚑ ${task.goal}`),
            task.due ? chip(`due-chip-${task.id}`, due && (due.isLate || due.isNear) ? `⏰ ${dueWords(due)}` : words("dueLabel", { day: task.due }), due?.isLate ? errorColor : due?.isNear ? warningColor : undefined, null, words("dueTip", { day: task.due })) : null,
            task.started && task.state === "doing" ? chip(`started-chip-${task.id}`, words(task.stale ? "staleTip" : "startedLabel", { day: task.started }), task.stale ? warningColor : workColor) : null,
            ...Object.entries(task.fields ?? {}).map(([key, value]) => chip(`field-chip-${task.id}-${key}`, `${snapshot.fields?.[key]?.name ?? key}: ${value}`)),
            chip(`born-chip-${task.id}`, task.by ? words("bornBy", { date: task.created, name: task.by }) : words("born", { date: task.created })),
            // An issue another wrote, in the color of a warning: the task's text is theirs (D-16).
            issue ? chip(`issue-chip-${task.id}`, `◉ #${issue.number} ${words(issue.state === "open" ? "issueStateOpen" : "issueStateClosed")}${issue.another && issue.author ? ` · ${words("issueBy", { author: issue.author })}` : ""}`, issue.another ? warningColor : undefined, issue.url, issue.title) : null,
            task.noteHref ? chip(`note-chip-${task.id}`, words("openNote"), undefined, task.noteHref) : null,
        ].filter((one): one is JSX.Element => one !== null);
        return [
            linkedText(`text-${task.id}`, task.text),
            <Box key={`what-${task.id}`} flexDirection="row" flexWrap="wrap" gap={1}>{what}</Box>,
            ties("part-of", words("labelPartOf"), task.parent && !isPart ? [task.parent] : []),
            ties("parts", words("labelParts", { done: task.partsDone, total: (task.parts ?? []).length }), task.parts ?? []),
            ties("waits", words("labelWaits"), task.after ?? []),
            field(`chain-${task.id}`, words("labelChain"), (task.chain ?? []).length > 0 ? [chip(`chain-chip-${task.id}`, `⛓ ${[...task.chain, idOf(task)].join(" → ")}`, warningColor)] : []),
            ties("waited", words("labelWaitedBy"), task.waitedBy ?? []),
            // A decision it points to is among its decisions: «see» keeps the rest.
            ties("see", words("labelSee"), (task.see ?? []).filter((one) => !(task.decisions ?? []).includes(one))),
            ties("seen", words("labelSeenFrom"), task.seenFrom ?? []),
            ties("decisions", words("labelDecisions"), task.decisions ?? []),
            // The specs it does, each a link to the specifications' tab of the page.
            field(`specs-${task.id}`, words("labelSpecs"), (task.specs ?? []).map((spec) => <Link key={`spec-${task.id}-${spec}`} href={`${snapshot.page}/#specs`}>{spec}</Link>)),
            field(`code-${task.id}`, words("labelCode"), [
                latest ? chip(`commits-${task.id}`, words("commitsCount", { count: task.commitCount, day: latest.day }), undefined, latest.url, latest.subject) : null,
                ...(task.pulls ?? []).map((pull) => chip(`pull-${task.id}-${pull.number}`, `#${pull.number} ${pullState(pull)}`, pull.merged ? workColor : undefined, pull.url, pull.title)),
            ]),
            task.mergedPull ? <Text key={`merged-${task.id}`} color={workColor}>{`✓ ${words("mergedCanClose", { number: task.mergedPull.number })}`}</Text> : null,
        ];
    };
    // Its text written again; its goal, who does it and the project's own fields, each changed at once by the backlog's command.
    const editing = (task: Task) => {
        const set = (option: string) => (value: string) => void backlog($, ["set", idOf(task), `--${option}`, value]);
        const goals = [...new Set([snapshot.words.noGoal, ...snapshot.plan.goals.filter((goal) => !goal.closed).map((goal) => goal.name), task.goal])];
        const holders = [...new Set([...snapshot.people, ...snapshot.colleagues.map((colleague) => colleague.name), task.to])];
        const saveText = (value: string) => {
            const text = oneLine(value);
            void change((old) => ({ ...old, editing: null }));

            if (text && text !== task.text) {
                void backlog($, ["set", idOf(task), "--text", text.replaceAll(" · ", " - ")]);
            }
        };
        return [
            <Input key={`edit-${task.id}`} value={task.text} rows={2} autoFocus submitLabel={words("saveText")} onSubmit={saveText} />,
            <Box key={`edit-fields-${task.id}`} flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
                <Select key={`edit-goal-${task.id}`} label={words("fieldGoal")} value={task.goal} options={choices(goals)} onSelect={set("goal")} />
                <Select key={`edit-to-${task.id}`} label={words("fieldTo")} value={task.to} options={choices(holders)} onSelect={set("to")} />
                {Object.entries(snapshot.fields ?? {}).map(([field, own]) => (own.values
                    ? <Select key={`edit-field-${field}-${task.id}`} label={own.name} value={task.fields?.[field] ?? ""} options={[noChoice, ...choices(own.values)]} onSelect={set(field)} />
                    : <Input key={`edit-field-${field}-${task.id}`} label={own.name} value={task.fields?.[field] ?? ""} submitLabel={words("saveText")} onSubmit={(value) => set(field)(value.trim())} />))}
            </Box>,
        ];
    };
    // A task's id, and for a large task its parts in a state too: a large task postponed or put back to do takes those parts along.
    const withParts = (task: Task, state: Task["state"]) => [idOf(task), ...partsOf(task).filter((part) => part.state === state).map((part) => idOf(part))];
    // A task is archived on a second press; the first asks for a few seconds.
    const askArchive = (task: Task) => {
        void change((old) => ({ ...old, archiving: task.id }));
        $.clock.after(archiveAskFor, () => void change((old) => (old.archiving === task.id ? { ...old, archiving: null } : old)));
    };
    const archive = (task: Task) => {
        void change((old) => ({ ...old, archiving: null, expanded: null }));
        void backlog($, ["archive", idOf(task)]);
    };

    return (task: Task, isPart: boolean) => {
        const key = `task-${task.id}`;
        return (
            <Box key={`details-${task.id}`} flexDirection="column" gap={1} paddingLeft={isDesktop ? 4 : 2}>
                {hasForms && view.editing === key ? editing(task) : facts(task, isPart)}
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                    <Button key={`done-${task.id}`} plain label={words("markDone")} onPress={() => markDone($, snapshot, task)} />
                    {task.state === "postponed"
                        ? <Button key={`resume-${task.id}`} plain label={words("backToDo")} onPress={() => backlog($, ["todo", ...withParts(task, "postponed")])} />
                        : <Button key={`postpone-${task.id}`} plain dimColor label={words("postpone")} onPress={() => backlog($, ["postpone", ...withParts(task, "todo")])} />}
                    {hasForms ? <Button key={`edit-text-${task.id}`} plain dimColor label={words(view.editing === key ? "cancelEdit" : "editText")} onPress={() => void change((old) => ({ ...old, editing: old.editing === key ? null : key }))} /> : null}
                    {view.archiving === task.id
                        ? <Button key={`archive-${task.id}`} plain label={words("archiveSure", { id: idOf(task) })} onPress={() => archive(task)} />
                        : <Button key={`archive-${task.id}`} plain dimColor label={words("archive")} onPress={() => askArchive(task)} />}
                </Box>
            </Box>
        );
    };
}
