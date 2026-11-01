// The panel's state, which the session keeps across reloads of the plugin: the board, the project as last read with every chat's holds,
// and the view the user left. Both are read and changed only here: the engine's scan of the state a module reads and writes holds each
// atom to the module that declares it.
import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import type { Board, View } from "../types";

import { sayer } from "../lib/messages.mjs";

const board = atom({ plugin: "project", key: "board" } as const, { snapshot: null, problem: null, readAt: 0, stamp: "", holds: {}, session: "" }, { shape: "board-2" });
const view = atom({ plugin: "project", key: "view" } as const, { sections: {}, expanded: null, whole: {}, starting: {}, frozen: null }, { shape: "view-1" });

export function readBoard($: EngineInterface): Promise<Board>
{
    return read($, board);
}

export async function changeBoard($: EngineInterface, change: (old: Board) => Board): Promise<void>
{
    await update($, board, change);
}

export function readView($: EngineInterface): Promise<View>
{
    return read($, view);
}

export async function changeView($: EngineInterface, change: (old: View) => View): Promise<void>
{
    await update($, view, change);
}

/** The panel's words, in the project's language once it is read. */
export function say(current: Board)
{
    return sayer(current.snapshot?.language ?? "en");
}

/** The session's folder, with forward slashes: the scripts look for the project from it, and the holds are of it. */
export async function projectRoot($: EngineInterface): Promise<string>
{
    return (await $.session.root()).replace(/\\/g, "/");
}
