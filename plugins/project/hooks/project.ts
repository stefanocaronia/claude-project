// The project as the panel knows it: read through scripts/snapshot.mjs when one of its files changed, and changed only through the
// plugin's other scripts. The scripts own the files; the panel only asks.
import type { EngineInterface } from "claude-code";

import type { Snapshot } from "../types";

import { sayer } from "../lib/messages.mjs";
import { readHolds } from "./holds.ts";
import { changeBoard, projectRoot, readBoard } from "./state.ts";

// The exit code of snapshot.mjs in a folder with no project above it.
const noProject = 3;
// How often the panel looks at the project's files while nobody works in this chat: a change made elsewhere (the page's sync of the
// issues, another chat, an edit by hand) shows without waiting for a turn. A look is a stat of each file; the project is read again only
// when one changed.
const watchEvery = 15_000;

/** Looks at the project's files every few seconds, as long as the session lasts. */
export function watch($: EngineInterface): void
{
    $.clock.every(watchEvery, () => void refresh($, false).catch(() => undefined));
}

/** Reads the project again through snapshot.mjs: always when forced, else when one of the files it watches changed since. */
export async function refresh($: EngineInterface, force: boolean): Promise<void>
{
    const current = await readBoard($);
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
            await changeBoard($, (old) => ({ ...old, snapshot: null, problem: sayer("en")("paneNoConfig") }));
            return;
        }

        if (exitCode !== 0 || isStdoutTruncated) {
            throw new Error(stderr.trim() || (isStdoutTruncated ? "the snapshot is too large to read" : `exit ${exitCode}`));
        }

        const snapshot = JSON.parse(stdout) as Snapshot;
        const readAt = await $.clock.now();
        // The stamp taken before the reading, so that a file changed while the script read it differs from it and the next look reads
        // it again; the files' own, at the first reading or when the project watches other files now.
        const same = snapshot.watch.join("|") === (current.snapshot?.watch ?? []).join("|");
        const fresh = same ? stamp : await stampOf($, snapshot.watch);
        await changeBoard($, (old) => ({ ...old, snapshot, problem: null, readAt, stamp: fresh }));
        await readHolds($).catch(() => undefined);
    } catch (error) {
        const problem = sayer(current.snapshot?.language ?? "en")("paneProblem", { problem: error instanceof Error ? error.message : String(error) });
        await changeBoard($, (old) => ({ ...old, problem }));
    }
}

/** Changes the backlog through its own command line, or the issues' sync through theirs, then reads the project again. */
export async function backlog($: EngineInterface, args: string[], script: "backlog" | "issues" = "backlog"): Promise<void>
{
    const root = await projectRoot($);
    const { exitCode, stderr } = await $.process.run(["node", `${$.plugin.root}/scripts/${script}.mjs`, ...args], { cwd: root, env: { CLAUDE_PROJECT_DIR: root } });

    if (exitCode !== 0) {
        $.ui.toast(stderr.trim().split("\n")[0] ?? `${script} ${args.join(" ")}`);
    }

    await refresh($, true);
}

/** What backlog.mjs committed says of the commits just made: the tasks they do, still open; empty when none. */
export async function committedOpen($: EngineInterface): Promise<string>
{
    const root = await projectRoot($);
    const { exitCode, stdout } = await $.process.run(["node", `${$.plugin.root}/scripts/backlog.mjs`, "committed"], { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, timeoutMs: 30_000 });
    return exitCode === 0 ? stdout.trim() : "";
}

/** What the chat changed in the private docs, Crew's colleagues' writing too, committed and pushed where the project keeps them in sync
 *  (D-18); sync.mjs does nothing elsewhere. Its lines, a clash with the others' changes, else empty. */
export async function pushDocs($: EngineInterface): Promise<string>
{
    const root = await projectRoot($);
    const { exitCode, stdout } = await $.process.run(["node", `${$.plugin.root}/scripts/sync.mjs`, "push"], { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, timeoutMs: 120_000 });
    return exitCode === 0 ? stdout.trim() : "";
}

/** An extension's action in the panel, a start for instance: a POST to its path on the project's page, then the project read again. */
export async function postLink($: EngineInterface, url: string): Promise<void>
{
    const answer = await $.http.fetch(url, { method: "POST" }).catch(() => undefined);

    if (!answer?.ok) {
        $.ui.toast(`${url}: ${answer ? answer.status : "?"}`);
    }

    await refresh($, true);
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
