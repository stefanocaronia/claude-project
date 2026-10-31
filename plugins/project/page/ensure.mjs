// Starts the project's page in the background unless it is already up; the plugin's SessionStart hook runs it. In a git repo without
// .claude/project.yaml it says once, the first time, how to set the project up, and is silent there after.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sayer } from "../lib/messages.mjs";
import { findRoot, git, loadProject, onPath, ProjectError, projectCommandOnPath, projectName } from "../scripts/project.mjs";

const from = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (findRoot(from) === null) {
    invite();
} else {
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
    // The line is shown to the user at the start of the session, and given to Claude as context; with the plugin's command on the path,
    // Claude is told to call it in place of the scripts' long path.
    // Without git or gh, Claude is told to offer the github skill when the user works with GitHub.
    const missing = ["git", "gh"].filter((name) => !onPath(name));
    const told = [context, projectCommandOnPath() ? say("cliOnPath") : null, missing.length > 0 ? say("githubAtStart", { list: missing.join(", ") }) : null].filter(Boolean).join(" ");
    console.log(JSON.stringify({ systemMessage: context === say("served", { url }) ? `${projectName(config)}: ${url}` : context, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: told } }));
}

/** One line, once a repo: the plugin is here and /project:init sets it up. The repos already told are kept in the temporary folder. */
function invite()
{
    const repo = git(from, ["rev-parse", "--show-toplevel"]).trim();

    if (!repo) {
        return;
    }

    const file = join(tmpdir(), "claude-project", "invited.json");
    const told = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];

    if (told.includes(repo.toLowerCase())) {
        return;
    }

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify([...told, repo.toLowerCase()]));
    const say = sayer(Intl.DateTimeFormat().resolvedOptions().locale.startsWith("it") ? "it" : "en");
    console.log(JSON.stringify({ systemMessage: say("invite"), hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: say("inviteContext") } }));
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
