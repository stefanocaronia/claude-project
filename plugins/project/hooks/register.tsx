// The project's panel beside the chat, and the hooks that keep it true: it draws what scripts/snapshot.mjs reads from the project's files
// and changes them only through the plugin's scripts, which own them. Its parts, in this folder: state.ts, the panel's state; project.ts,
// the reading of the project and its scripts; holds.ts, what each chat of the project holds; start.ts, the tasks started and the prompts
// asked; panel.tsx, the drawing, with kit.tsx, what its parts draw with, tasks.tsx and details.tsx, the tasks, goals.tsx, the goals, and
// sections.tsx, the other sections; draw.ts, the colors, marks and small drawings.
import type { Register } from "claude-code";

import { citedTasks } from "../lib/backlog.mjs";
import { guardCall } from "../lib/guard.mjs";
import { sayer } from "../lib/messages.mjs";
import { hold, holdNothing, letGo, thisChat } from "./holds.ts";
import { drawPanel } from "./panel.tsx";
import { refresh, watch } from "./project.ts";
import { moveCited } from "./start.ts";
import { readBoard, say } from "./state.ts";

const pane = "project";
const command = "project-panel";
// Whether this module has read the project since it was loaded: a reload of the plugins keeps the panel's state, not this, so the first
// drawing after one reads the project again, as a new session would.
let hasRead = false;

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

        return result;
    });

    // The files are read again once a turn ends, Claude's or a colleague's, when one of them changed; a colleague who finished lets go
    // of the tasks they held.
    on("turn.complete", async ($, e, next) => {
        const completed = await next(e);

        if (e.agentId) {
            await letGo($, e.agentId).catch(() => undefined);
        }

        await refresh($, false).catch(() => undefined);
        return completed;
    });

    // A chat that ends holds nothing any longer.
    on("session.end", async ($, e, next) => {
        await holdNothing($).catch(() => undefined);
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
