// A task opened in its row: its whole text, then chips for what the row does not show (its goal, its days, its fields, its issue and
// note) and, after them, one for each tie, its kind a mark with its words under the pointer (its large task, waits, links both ways,
// decisions, specs, the code that does it), then the comments left on it and a field for another. What the row shows already, who holds it, its type, priority, effort and number, is not said again. Below,
// what can be done with it, on the desktop each a mark with its words under the pointer: done, postponed or back to do, its text and
// fields written again, archived.
import type { EngineInterface } from "claude-code";

import type { Pull, Task } from "../types";

import { decisionColor, errorColor, saveMark, sendMark, taskColor, tieMarks, warningColor, workColor } from "./draw.ts";
import { noChoice, oneLine } from "./kit.tsx";
import type { Panel } from "./kit.tsx";
import { backlog } from "./project.ts";
import { markDone } from "./start.ts";

// How long «Archive» waits for its second press.
const archiveAskFor = 4000;

export function taskDetails($: EngineInterface, p: Panel)
{
    const { Box, Text, Button, Input, Select, hasForms, isDesktop, view, snapshot, words, prefix, idOf, partsOf, change, chip, iconButton, dueWords, linkedText, face, decider, holderName } = p;
    const choices = (values: string[]) => values.map((value) => ({ value, label: value }));
    // Who may hold a task, Claude by the coordinator's name where Crew hired one (D-18).
    const holderChoices = (values: string[]) => values.map((value) => ({ value, label: holderName(value) }));
    const refColor = (id: string) => (id.startsWith(`${snapshot.prefixes.decision}-`) ? decisionColor : id.startsWith(`${prefix}-`) ? taskColor : undefined);
    // A part drawn under its large task does not name it again.
    const facts = (task: Task, isPart: boolean) => {
        const due = task.dueInfo;
        const issue = task.issueInfo;
        const latest = (task.commits ?? [])[0];
        const pullState = (pull: Pull) => (pull.merged ? words("pullMerged", { day: pull.merged }) : words(pull.state === "open" ? "pullOpen" : "pullClosed"));
        // A tie: its mark and the other's number, in the other's color, what the tie is under the pointer.
        const ties = (name: string, mark: string, label: string, ids: string[]) => ids.map((id) => chip(`${name}-${task.id}-${id}`, `${mark} ${id}`, refColor(id), null, label));
        const what = [
            task.goal === snapshot.words.noGoal ? null : chip(`goal-chip-${task.id}`, `⚑ ${task.goal}`),
            task.due ? chip(`due-chip-${task.id}`, due && (due.isLate || due.isNear) ? `⏰ ${dueWords(due)}` : words("dueLabel", { day: task.due }), due?.isLate ? errorColor : due?.isNear ? warningColor : undefined, null, words("dueTip", { day: task.due })) : null,
            task.started && task.state === "doing" ? chip(`started-chip-${task.id}`, words(task.stale ? "staleTip" : task.startedBy ? "startedByLabel" : "startedLabel", { day: task.started, who: task.startedBy }), task.stale ? warningColor : workColor) : null,
            ...Object.entries(task.fields ?? {}).map(([key, value]) => chip(`field-chip-${task.id}-${key}`, `${snapshot.fields?.[key]?.name ?? key}: ${value}`)),
            chip(`born-chip-${task.id}`, task.by ? words("bornBy", { date: task.created, name: task.by }) : words("born", { date: task.created })),
            // An issue another wrote, in the color of a warning: the task's text is theirs (D-16).
            issue ? chip(`issue-chip-${task.id}`, `◉ #${issue.number} ${words(issue.state === "open" ? "issueStateOpen" : "issueStateClosed")}${issue.another && issue.author ? ` · ${words("issueBy", { author: issue.author })}` : ""}`, issue.another ? warningColor : undefined, issue.url, issue.title) : null,
            task.noteHref ? chip(`note-chip-${task.id}`, words("openNote"), undefined, task.noteHref) : null,
            ...ties("part-of", tieMarks.partOf, words("labelPartOf"), task.parent && !isPart ? [task.parent] : []),
            ...ties("waits", tieMarks.waits, words("labelWaits"), task.after ?? []),
            (task.chain ?? []).length > 0 ? chip(`chain-chip-${task.id}`, `⛓ ${[...task.chain, idOf(task)].join(" → ")}`, warningColor, null, words("labelChain")) : null,
            ...ties("waited", tieMarks.waitedBy, words("labelWaitedBy"), task.waitedBy ?? []),
            // A decision it points to is among its decisions: «see» keeps the rest.
            ...ties("see", tieMarks.see, words("labelSee"), (task.see ?? []).filter((one) => !(task.decisions ?? []).includes(one))),
            ...ties("seen", tieMarks.seenFrom, words("labelSeenFrom"), task.seenFrom ?? []),
            ...ties("decisions", tieMarks.decision, words("labelDecisions"), task.decisions ?? []),
            // The specs it does, each a link to the specifications' tab of the page.
            ...(task.specs ?? []).map((spec) => chip(`spec-${task.id}-${spec}`, `${tieMarks.spec} ${spec}`, undefined, `${snapshot.page}/#specs`, words("labelSpecs"))),
            // The code that does it: its commits, the latest a link, and its pull requests.
            latest ? chip(`commits-${task.id}`, words("commitsCount", { count: task.commitCount, day: latest.day }), undefined, latest.url, latest.subject) : null,
            ...(task.pulls ?? []).map((pull) => chip(`pull-${task.id}-${pull.number}`, `#${pull.number} ${pullState(pull)}`, pull.merged ? workColor : undefined, pull.url, pull.title)),
        ].filter((one): one is JSX.Element => one !== null);
        return [
            linkedText(`text-${task.id}`, task.text),
            <Box key={`what-${task.id}`} flexDirection="row" flexWrap="wrap" gap={1}>{what}</Box>,
            task.mergedPull ? <Text key={`merged-${task.id}`} color={workColor}>{`✓ ${words("mergedCanClose", { number: task.mergedPull.number })}`}</Text> : null,
            ...comments(task),
        ];
    };
    // The comments left on it, each with the face of who wrote it, and a field for another, the user's: a new field once it is in. Each
    // is written again in its place or deleted, on a second press as a task is archived, by its number as the backlog lists them.
    const comments = (task: Task) => {
        const left = task.comments ?? [];
        const send = (value: string) => {
            const text = value.trim();

            if (text) {
                void backlog($, ["comment", idOf(task), ...(decider ? ["--by", decider] : []), "--", text]);
            }
        };
        const own = (index: number) => `comment-${task.id}-${index}`;
        const save = (index: number) => (value: string) => {
            const text = value.trim();
            void change((old) => ({ ...old, editing: null }));

            if (text && text !== left[index]?.text) {
                void backlog($, ["comment", idOf(task), "--edit", String(index + 1), "--", text]);
            }
        };
        const askDelete = (index: number) => {
            const asking = `delete-${own(index)}`;
            void change((old) => ({ ...old, editing: asking }));
            $.clock.after(archiveAskFor, () => void change((old) => (old.editing === asking ? { ...old, editing: null } : old)));
        };
        const remove = (index: number) => {
            void change((old) => ({ ...old, editing: null }));
            void backlog($, ["comment", idOf(task), "--delete", String(index + 1)]);
        };
        return [
            ...left.map((comment, index) => (
                <Box key={own(index)} flexDirection="row" gap={1}>
                    <Box flexShrink={0} alignSelf="flex-start" marginTop="xs">{face(comment.by, 14)}</Box>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                        <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center" columnGap={2}>
                            <Text dimColor>{`${comment.by} · ${comment.day}`}</Text>
                            <Box flexDirection="row" flexShrink={0} columnGap={1}>
                                {hasForms ? iconButton(`edit-${own(index)}`, words(view.editing === own(index) ? "cancelEdit" : "editComment"), () => change((old) => ({ ...old, editing: old.editing === own(index) ? null : own(index) })), true) : null}
                                {view.editing === `delete-${own(index)}`
                                    ? <Button key={`delete-${own(index)}`} plain label={words("deleteCommentSure")} onPress={() => remove(index)} />
                                    : iconButton(`delete-${own(index)}`, words("deleteComment"), () => askDelete(index), true)}
                            </Box>
                        </Box>
                        {hasForms && view.editing === own(index)
                            ? <Input key={`comment-edit-${task.id}-${index}`} value={comment.text} rows={2} autoFocus submitLabel={saveMark} onSubmit={save(index)} />
                            : linkedText(`comment-text-${task.id}-${index}`, comment.text)}
                    </Box>
                </Box>
            )),
            hasForms ? <Input key={`comment-field-${task.id}-${left.length}`} placeholder={words("commentHint")} rows={2} submitLabel={sendMark} onSubmit={send} /> : null,
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
            <Input key={`edit-${task.id}`} value={task.text} rows={2} autoFocus submitLabel={saveMark} onSubmit={saveText} />,
            <Box key={`edit-fields-${task.id}`} flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
                <Select key={`edit-goal-${task.id}`} label={words("fieldGoal")} value={task.goal} options={choices(goals)} onSelect={set("goal")} />
                <Select key={`edit-to-${task.id}`} label={words("fieldTo")} value={task.to} options={holderChoices(holders)} onSelect={set("to")} />
                {Object.entries(snapshot.fields ?? {}).map(([field, own]) => (own.values
                    ? <Select key={`edit-field-${field}-${task.id}`} label={own.name} value={task.fields?.[field] ?? ""} options={[noChoice, ...choices(own.values)]} onSelect={set(field)} />
                    : <Input key={`edit-field-${field}-${task.id}`} label={own.name} value={task.fields?.[field] ?? ""} submitLabel={saveMark} onSubmit={(value) => set(field)(value.trim())} />))}
            </Box>,
        ];
    };
    // A task's id, and for a large task its parts in a state too: a large task postponed or put back to do takes those parts along.
    const withParts = (task: Task, state: Task["state"]) => [idOf(task), ...partsOf(task).filter((part) => part.state === state).map((part) => idOf(part))];
    // A task is archived on a second press; the first asks for a few seconds, in words.
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
                    {iconButton(`done-${task.id}`, words("markDone"), () => markDone($, snapshot, task))}
                    {task.state === "postponed"
                        ? iconButton(`resume-${task.id}`, words("backToDo"), () => backlog($, ["todo", ...withParts(task, "postponed")]))
                        : iconButton(`postpone-${task.id}`, words("postpone"), () => backlog($, ["postpone", ...withParts(task, "todo")]), true)}
                    {hasForms ? iconButton(`edit-text-${task.id}`, words(view.editing === key ? "cancelEdit" : "editText"), () => change((old) => ({ ...old, editing: old.editing === key ? null : key })), true) : null}
                    {view.archiving === task.id
                        ? <Button key={`archive-${task.id}`} plain label={words("archiveSure", { id: idOf(task) })} onPress={() => archive(task)} />
                        : iconButton(`archive-${task.id}`, words("archive"), () => askArchive(task), true)}
                </Box>
            </Box>
        );
    };
}
