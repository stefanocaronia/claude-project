// What each chat of the project holds: the tasks in progress it works on, itself or through a colleague, so that the panel shows who is
// at work and nobody starts a task twice. Each chat writes its own file, beside the other chats' of every project, in the system's
// temporary folder; the board keeps every chat's fresh holds for this project, by task number.
import type { EngineInterface } from "claude-code";

import type { Board, Hold } from "../types";

import { changeBoard, projectRoot, readBoard } from "./state.ts";

/** Who holds a task in a chat: the chat itself, or a colleague at work in it. */
export type Holder = Omit<Hold, "session">;
type Holds = Record<string, Holder>;

/** The chat itself at work on a task, not a colleague. */
export const thisChat: Holder = { colleague: null, agentId: null };
// A chat's holds older than this are of a chat long gone that never said so.
const holdsLast = 24 * 3_600_000;

/** These tasks given to a holder, or let go with none. */
export async function hold($: EngineInterface, ids: number[], holder: Holder | null): Promise<void>
{
    await changeHolds($, (held) => {
        const next = { ...held };

        for (const id of ids) {
            if (holder) {
                next[String(id)] = holder;
            } else {
                delete next[String(id)];
            }
        }

        return next;
    });
}

/** A colleague who finished lets go of the tasks they held. */
export async function letGo($: EngineInterface, agentId: string): Promise<void>
{
    await changeHolds($, (held) => Object.fromEntries(Object.entries(held).filter(([, one]) => one.agentId !== agentId)));
}

/** A chat that ends holds nothing any longer. */
export async function holdNothing($: EngineInterface): Promise<void>
{
    await $.fs.write(await holdFile($), JSON.stringify({ root: "", at: 0, tasks: {} }));
}

/** Whether this file is the project's work, not its docs or its configuration, and this chat holds no task in progress, itself or through a
 *  colleague: work begun without its task started. */
export async function worksUnheld($: EngineInterface, file: string): Promise<boolean>
{
    const { snapshot, holds, session } = await readBoard($);

    if (!snapshot || !session || Object.values(holds).some((one) => one.session === session)) {
        return false;
    }

    const root = `${(await projectRoot($)).toLowerCase()}/`;
    const path = file.replace(/\\/g, "/").toLowerCase();
    const backlog = snapshot.guard?.find((one) => one.script === "backlog")?.path.toLowerCase() ?? "";
    const docs = backlog.includes("/") ? `${backlog.slice(0, backlog.lastIndexOf("/"))}/` : null;
    const inside = path.startsWith(root) ? path.slice(root.length) : null;
    return inside !== null && !inside.startsWith(".claude/") && !(docs && inside.startsWith(docs));
}

/** Every chat's holds for this project, the fresh ones, by task number, into the board: this chat's win over another's. */
export async function readHolds($: EngineInterface): Promise<void>
{
    const file = await holdFile($);
    const folder = file.slice(0, file.lastIndexOf("/"));
    const root = await projectRoot($);
    const session = await chatName($);
    const now = await $.clock.now();
    const names = ((await $.fs.exists(folder)) ? await $.fs.list(folder) : []).map((entry) => entry.name).filter((name) => /^held-.+\.json$/.test(name));
    const holds: Board["holds"] = {};

    // This chat's file is read last, so that its holds win.
    for (const name of [...names.filter((one) => `${folder}/${one}` !== file), ...names.filter((one) => `${folder}/${one}` === file)]) {
        const content = await readHoldFile($, `${folder}/${name}`);

        if (!content || content.root !== root || now - content.at > holdsLast) {
            continue;
        }

        const owner = name.slice("held-".length, -".json".length);

        for (const [id, one] of Object.entries(content.tasks)) {
            holds[id] = { session: owner, colleague: one.colleague, agentId: one.agentId };
        }
    }

    await changeBoard($, (old) => ({ ...old, holds, session }));
}

/** Changes what this chat holds, writes it for the other chats to read, and reads every chat's again. */
async function changeHolds($: EngineInterface, change: (held: Holds) => Holds): Promise<void>
{
    const file = await holdFile($);
    const root = await projectRoot($);
    const mine = await readHoldFile($, file);
    const held = change(mine && mine.root === root ? mine.tasks : {});
    await $.fs.write(file, JSON.stringify({ root, at: await $.clock.now(), tasks: held }));
    await readHolds($);
}

/** Where this chat writes what it holds: its own file, in the system's temporary folder. */
async function holdFile($: EngineInterface): Promise<string>
{
    const isWindows = (await $.env.get("OS")) === "Windows_NT";
    const temp = (isWindows ? (await $.env.get("TEMP")) || (await $.env.get("TMP")) : (await $.env.get("TMPDIR")) || (await $.env.get("TMP"))) || "/tmp";
    return `${temp.replace(/\\/g, "/").replace(/\/+$/, "")}/claude-project/held-${await chatName($)}.json`;
}

/** This chat's name in the holds: its session's id, as a file's name can hold it. */
async function chatName($: EngineInterface): Promise<string>
{
    return (await $.session.id()).replace(/[^\w-]/g, "_");
}

async function readHoldFile($: EngineInterface, file: string): Promise<{ root: string; at: number; tasks: Holds } | null>
{
    try {
        return JSON.parse(await $.fs.read(file));
    } catch {
        return null;
    }
}
