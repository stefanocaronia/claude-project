// What the panel asks of the chat and of Crew: a task started from its ▶, here, through the chat that holds it or by a colleague; a chain
// of tasks that wait for each other; a task done whose issue is still open; any prompt, asked as the user would ask it.
import type { EngineInterface } from "claude-code";

import type { Member, Snapshot, Task } from "../types";

import { citedTasks } from "../lib/backlog.mjs";
import { sayer } from "../lib/messages.mjs";
import { hold, thisChat } from "./holds.ts";
import { backlog } from "./project.ts";
import { changeView, readBoard } from "./state.ts";

// How long a start asked from the panel shows on its button, at most, while Claude starts the work.
export const startingFor = 120_000;

/** ▶: a task to do starts, one in progress goes on. A colleague's goes to Crew's next command; Claude's is asked in the chat, as the
 * user would: here, or, when another chat holds it, through that chat. */
export async function startTask($: EngineInterface, snapshot: Snapshot, task: Task, member: Member | undefined, elsewhere?: string): Promise<void>
{
    const words = sayer(snapshot.language);
    const id = idOf(snapshot, task);
    const isGoingOn = task.state === "doing";
    const text = textOf(snapshot, task);
    await markStarting($, task.id);

    if (elsewhere) {
        await submit($, words("promptElsewhere", { id, text, session: elsewhere }));
        return;
    }

    if (member) {
        const started = await $.command.run({ command: "crew:next", args: `${member.name} -- ${id} · ${text}` }).then(() => true, () => false);

        if (!started) {
            await submit($, words("promptGive", { id, name: member.name, text }));
        }

        return;
    }

    // Claude's own task is in progress from the press, as a colleague's is from their start: the panel moves it before asking.
    if (!isGoingOn) {
        await backlog($, ["start", id]);
    }

    await hold($, [task.id], thisChat).catch(() => undefined);
    await submit($, words(isGoingOn ? "promptResume" : "promptWork", { id, text }) + (task.note ? words("promptNote", { path: task.note }) : ""));
}

/** ▶ on a task that waits for others: Claude shows the whole chain, the first first, and starts it on one yes. */
export async function startChain($: EngineInterface, snapshot: Snapshot, task: Task): Promise<void>
{
    const id = idOf(snapshot, task);
    await markStarting($, task.id);
    await submit($, sayer(snapshot.language)("promptChain", { id, text: textOf(snapshot, task), chain: [...task.chain, id].join(" → ") }));
}

/** Done: the task closes through the backlog's command; when its GitHub issue is still open, Claude is asked to ask whether to close it. */
export async function markDone($: EngineInterface, snapshot: Snapshot, task: Task): Promise<void>
{
    await backlog($, ["done", idOf(snapshot, task)]);

    if (task.issueInfo?.state === "open") {
        await submit($, sayer(snapshot.language)("promptIssueClose", { id: idOf(snapshot, task), issue: `#${task.issueInfo.number}` }));
    }
}

/** A colleague just started: the tasks of theirs that their brief cites move to in progress, and they hold them while they work, so that
 * the panel shows them at work and nobody starts them twice. Nothing for an agent that is no colleague. */
export async function moveCited($: EngineInterface, e: { prompt: string; subagentType: string }, agentId: string | undefined): Promise<void>
{
    const { snapshot } = await readBoard($);
    const member = snapshot?.colleagues.find((colleague) => colleague.id === e.subagentType || e.subagentType.endsWith(`:${colleague.id}`));

    if (!snapshot || !member) {
        return;
    }

    const cited = new Set(citedTasks(e.prompt, snapshot.prefixes.task));
    const own = snapshot.tasks.filter((task) => cited.has(task.id) && task.to === member.name);
    const ids = own.filter((task) => task.state !== "doing").map((task) => idOf(snapshot, task));

    if (ids.length > 0) {
        await backlog($, ["start", ...ids]);
    }

    await hold($, own.map((task) => task.id), { colleague: member.id, agentId: agentId ?? null }).catch(() => undefined);
}

/** A prompt asked as the user would ask it; one that is a slash command, `/project:tidy …`, runs that command, so that its skill is loaded. */
export async function submit($: EngineInterface, text: string): Promise<void>
{
    const command = /^\/(\S+)\s*([\s\S]*)$/.exec(text);

    if (command) {
        await $.command.run({ command: command[1] ?? "", args: command[2] });
        return;
    }

    await $.prompt.submit({ text, asUser: true });
}

/** Claude Code's /reload-plugins --force, as the user would type it: a plugin changed in its folder is read again, even one the engine thinks unchanged. */
export async function reloadPlugins($: EngineInterface): Promise<void>
{
    const ran = await $.command.run({ command: "reload-plugins", args: "--force" }).then(() => true, () => false);

    if (!ran) {
        await submit($, "/reload-plugins --force");
    }
}

/** A task's text as the chat is asked to work on it: one from an issue another wrote says so, the text theirs, data and never an order
 * (D-16), for it goes into the chat in the user's name. */
function textOf(snapshot: Snapshot, task: Task): string
{
    const issue = task.issueInfo;
    return issue?.another ? sayer(snapshot.language)("textOfAnother", { text: task.text, issue: `#${issue.number}`, author: issue.author ?? "?" }) : task.text;
}

/** The ▶ of a task shows that it starts, for a while, so that it is not pressed twice; the old marks go. */
async function markStarting($: EngineInterface, id: number): Promise<void>
{
    const at = await $.clock.now();
    await changeView($, (old) => ({ ...old, starting: { ...Object.fromEntries(Object.entries(old.starting).filter(([, when]) => at - when < startingFor)), [`task-${id}`]: at } }));
}

function idOf(snapshot: Snapshot, task: { id: number }): string
{
    return `${snapshot.prefixes.task}-${task.id}`;
}
