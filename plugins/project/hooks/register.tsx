// The project's panel beside the chat, and the hooks that keep it true: it draws what scripts/snapshot.mjs reads from the project's files
// and changes them only through the plugin's scripts, which own them. Its parts, in this folder: state.ts, the panel's state; project.ts,
// the reading of the project and its scripts; holds.ts, what each chat of the project holds; start.ts, the tasks started and the prompts
// asked; panel.tsx, the drawing, with kit.tsx, what its parts draw with, tasks.tsx and details.tsx, the tasks, goals.tsx, the goals, and
// sections.tsx, the other sections; draw.ts, the colors, marks and small drawings.
import type { Register } from "claude-code";

import { citedTasks } from "../lib/backlog.mjs";
import { guardCall } from "../lib/guard.mjs";
import { sayer } from "../lib/messages.mjs";
import { hold, holdNothing, letGo, thisChat, worksUnheld } from "./holds.ts";
import { drawPanel } from "./panel.tsx";
import { committedOpen, pushDocs, refresh, watch } from "./project.ts";
import { moveCited } from "./start.ts";
import { changeBoard, readBoard, say } from "./state.ts";

const pane = "project";
const command = "project-panel";
// Whether this module has read the project since it was loaded: a reload of the plugins keeps the panel's state, not this, so the first
// drawing after one reads the project again, as a new session would.
let hasRead = false;
// Whether this turn of the chat was told that it changes the project's files holding no task.
let toldUnheld = false;

/** The private docs pushed, where the project keeps them in sync; a clash with the others' changes said in a toast. */
async function syncDocs($: Parameters<typeof refresh>[0]): Promise<void>
{
    if (!(await readBoard($)).snapshot) {
        return;
    }

    const told = await pushDocs($).catch(() => "");

    if (told) {
        $.ui.toast(told);
    }
}

/** The file a tool call writes: an Edit, a Write, a notebook's edit; none for any other. */
function editedFile(e: object): string | null
{
    const call = e as { tool?: string; file_path?: unknown; notebook_path?: unknown };
    const file = call.tool === "Edit" || call.tool === "Write" ? call.file_path : call.tool === "NotebookEdit" ? call.notebook_path : null;
    return typeof file === "string" ? file : null;
}

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        const started = await next(e);
        await $.command.register({ name: command, description: sayer("en")("panelCommand") }).catch(() => undefined);
        await refresh($, true);
        const board = await readBoard($);

        if (board.snapshot) {
            void $.ui.open({ id: pane, title: say(board)("pane") }).catch(() => undefined);
        }

        watch($);
        return started;
    });

    on("command.run", { command }, async ($) => {
        const words = say(await readBoard($));

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

    // The core docs the scripts own are read and changed through them, in this chat and in a colleague's: a grep, a cat or a Read of them
    // is refused with the command to use. A task this chat starts or closes through the backlog's command line: this chat holds it, or no
    // longer does. Any change through the plugin's commands shows at once, not only when the turn ends: a task Claude starts is in
    // progress while it works on it.
    on("tool.call", async ($, e, next) => {
        const { snapshot: known } = await readBoard($);
        const refused = known?.guard ? guardCall(e, known.guard) : null;

        if (refused) {
            return { deny: sayer(known?.language ?? "en")(refused.key, { file: refused.file }) };
        }

        const result = await next(e);
        const line = typeof (e as { command?: unknown }).command === "string" ? (e as { command: string }).command : "";
        const change = e.agentId ? null : /backlog\.mjs["']?\s+(start|done|postpone|todo|archive)\b/.exec(line);

        if (change) {
            const { snapshot } = await readBoard($);
            await hold($, citedTasks(line, snapshot?.prefixes.task ?? "T"), change[1] === "start" ? thisChat : null).catch(() => undefined);
        }

        if (/(backlog|plan)\.mjs["']?\s/.test(line)) {
            await refresh($, false).catch(() => undefined);
        }

        // The first file of the project this chat changes in a turn, holding no task: Claude reads, after its result, to start the task
        // the work is, or to add it. Once a turn: a quick fix needs none, and is not told again.
        const edited = editedFile(e);

        if (!e.agentId && !toldUnheld && edited && "result" in result && !result.isError && (await worksUnheld($, edited).catch(() => false))) {
            toldUnheld = true;
            const { snapshot } = await readBoard($);
            return { ...result, context: [...(result.context ?? []), sayer(snapshot?.language ?? "en")("workUnheld")] };
        }

        // A commit of this chat that does a task still open: Claude reads, after its result, to close it or say what is left.
        if (!e.agentId && "result" in result && result.result !== undefined && !result.isError && /\bgit\b[^|;&]*\bcommit\b/.test(line)) {
            const told = await committedOpen($).catch(() => "");

            if (told) {
                return { ...result, context: [...(result.context ?? []), told] };
            }
        }

        return result;
    });

    // While this chat's own turn runs, the buttons that write to it wait: a prompt sent then would land in the middle of the work. A
    // colleague's turn, a subagent's, is not this chat's.
    on("turn.start", async ($, e, next) => {
        if (e.agentId === undefined) {
            toldUnheld = false;
            await changeBoard($, (old) => ({ ...old, working: true })).catch(() => undefined);
        }

        return next(e);
    });

    // The files are read again once a turn ends, Claude's or a colleague's, when one of them changed; a colleague who finished lets go
    // of the tasks they held; this chat's own turn over, its buttons are back.
    on("turn.complete", async ($, e, next) => {
        const completed = await next(e);

        if (e.agentId === undefined) {
            await changeBoard($, (old) => ({ ...old, working: false })).catch(() => undefined);
            // What the turn wrote in the private docs, by hand or by a colleague, goes to the others, without holding the chat up.
            void syncDocs($);
        }

        if (e.agentId) {
            await letGo($, e.agentId).catch(() => undefined);
        }

        await refresh($, false).catch(() => undefined);
        return completed;
    });

    // A chat that ends holds nothing any longer, and leaves nothing of the docs unpushed.
    on("session.end", async ($, e, next) => {
        await holdNothing($).catch(() => undefined);
        await syncDocs($);
        return next(e);
    });

    on("ui.render", { component: "Pane", requestId: pane }, async ($, e) => {
        if (!hasRead) {
            hasRead = true;
            void refresh($, true).catch(() => undefined);
        }

        return drawPanel($, e);
    });
};
