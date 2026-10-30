// Starts the project's page in the background unless it is already up; the plugin's SessionStart hook runs it. Silent in a folder
// without .claude/project.yaml.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, loadProject, ProjectError } from "../scripts/project.mjs";

const from = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (findRoot(from) !== null) {
    try {
        await ensure();
    } catch (error) {
        // A configuration that does not read is said at the start of the session, without stopping it.
        const message = error instanceof ProjectError ? error.message : String(error?.message ?? error);
        console.log(JSON.stringify({ systemMessage: message, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message } }));
    }
}

async function ensure()
{
    const { config, say } = loadProject(from);
    const port = config.page.port;
    const url = `http://localhost:${port}`;
    const owner = await whoServes(port);

    if (owner === null) {
        spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "serve.mjs"), "--port", String(port)], { cwd: config.root, env: { ...process.env, CLAUDE_PROJECT_DIR: config.root }, detached: true, stdio: "ignore", windowsHide: true }).unref();
    }

    const context = owner === null || owner.toLowerCase() === config.root.toLowerCase() ? say("served", { url })
        : owner === "" ? say("portBusy", { port })
        : say("portOther", { port, owner });
    // The line is shown to the user at the start of the session, and given to Claude as context.
    console.log(JSON.stringify({ systemMessage: context === say("served", { url }) ? `${config.name ?? config.root.split("/").at(-1)}: ${url}` : context, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
}

/** The root of the project whose page answers on the port; "" when something else answers; null when nothing does. */
async function whoServes(port)
{
    try {
        const response = await fetch(`http://127.0.0.1:${port}/whoami`, { signal: AbortSignal.timeout(800) });
        return response.ok ? (await response.json()).root ?? "" : "";
    } catch (error) {
        return error?.cause?.code === "ECONNREFUSED" || error?.name === "TimeoutError" ? null : "";
    }
}
