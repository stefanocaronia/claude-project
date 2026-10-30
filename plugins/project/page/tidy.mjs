// The cleanup from the page: the mechanical fixes run here; the proposals and their application are runs of Claude Code with the
// plugin's tidy skill, on the user's own login, reading only and then changing only what the user ticked.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixWhitespace } from "../scripts/check.mjs";
import { realPath, shown } from "../scripts/project.mjs";
import { dateTasks } from "../scripts/task-dates.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const timeoutMinutes = 20;
let child = null;

/** What the cleanup card shows: what the mechanical fixes would touch, the AI run and its proposals. */
export function tidyState(config)
{
    return { whitespace: fixWhitespace(config, false), undated: dateTasks(config, false), ...readState(config), running: child !== null };
}

/** A mechanical fix, written: "whitespace" or "dates"; returns what it changed. */
export function runFix(config, fix)
{
    return fix === "whitespace" ? fixWhitespace(config, true) : fix === "dates" ? dateTasks(config, true) : [];
}

/** Starts the run that writes the proposals, reading only; false when a run is going. */
export function propose(config)
{
    const check = `node ${pluginRoot}/scripts/check.mjs`;
    const brief = `Run the tidy skill of the project plugin: read ${pluginRoot}/skills/tidy/SKILL.md and do only its section 3, the proposals. Change no file.
Start from the report of \`${check}\`, whose files are relative to the project's root. Read with Read and Grep; Bash is only for that command. Read only the lines the findings point at (Read with offset and limit) and what you need to judge them: the decisions' file can be very large, never read it whole. If while reading you find something else the skill asks to propose, propose it.
Every proposal changes something: what stays as it is (a revision in part, say) is not a proposal. The whitespace, the blank lines and the tasks' dates the page fixes itself: do not propose them.
A proposal that cannot be applied now carries in "waits" what it waits for: "user" (a decision of theirs), "colleagues" (Crew's cleanup or a colleague's work) or "a run of its own" (a long piece of work, apart); the others have "waits": null, and "change" says exactly what will change in the file.
Answer with a JSON array and nothing else, at most 25 proposals, the most useful first, written in the project's language (${config.language}):
[{"id": "p1", "kind": "superseded | compact | to decide | index | task | weight | other", "file": "${shown(config, config.files.decisions)}", "line": 314, "title": "one line", "why": "the reason, in one or two sentences", "change": "exactly what will change in the file", "waits": null}]`;

    return startRun(config, "propose", brief, ["Read", "Grep", "Glob", `Bash(${check})`], (state, result) => {
        state.proposals = proposalsOf(result);
        state.applied = null;
        return `${state.proposals.length}`;
    });
}

/** Starts the run that applies the proposals the user ticked, and only those; false when there is none or a run is going. */
export function apply(config, ids)
{
    const chosen = (readState(config).proposals ?? []).filter((proposal) => ids.includes(proposal.id) && !proposal.waits);

    if (chosen.length === 0) {
        return false;
    }

    const check = `node ${pluginRoot}/scripts/check.mjs`;
    const docs = shown(config, config.docs);
    const memory = shown(config, config.memory);
    const brief = `Apply these proposals of the cleanup, approved by the user, and only these:
${JSON.stringify(chosen, null, 2)}
Follow ${pluginRoot}/skills/tidy/SKILL.md, above all "The rules that stay". The proposals' files are relative to the project's root. Change only those files, with Edit, and read them with Read and Grep. Bash is only for \`${check}\` and \`${check} --fix\` (whitespace and blank lines). Another session may change a file while you work: if an Edit is refused or the line is gone, read the file again and try once more. If a proposal cannot be applied as written, skip it and say why. At the end run \`${check}\`.
Answer with a JSON object and nothing else, its summary in the project's language (${config.language}): {"applied": ["p1"], "skipped": [{"id": "p3", "why": "..."}], "summary": "two or three sentences"}`;

    // The colleagues' memory may sit past a link (.claude into a private repo): the rule names both paths.
    const realMemory = shown(config, realPath(config.memory).replaceAll("\\", "/"));
    const edits = [...new Set([`Edit(${docs}/**)`, `Edit(${memory}/**)`, `Edit(${realMemory}/**)`])];
    return startRun(config, "apply", brief, ["Read", "Grep", "Glob", ...edits, `Bash(${check})`, `Bash(${check} --fix)`], (state, result) => {
        const outcome = objectOf(result);
        const applied = new Set(outcome.applied ?? []);
        state.proposals = (state.proposals ?? []).filter((proposal) => !applied.has(proposal.id));
        state.applied = { at: new Date().toISOString(), applied: [...applied], skipped: outcome.skipped ?? [], summary: outcome.summary ?? result.slice(0, 600) };
        return outcome.summary ?? "";
    });
}

function startRun(config, kind, brief, allowed, finish)
{
    if (child) {
        return false;
    }

    const tools = [...new Set(allowed.map((rule) => rule.split("(")[0]))].join(",");
    const permissions = allowed.map((rule) => `"${rule}"`).join(" ");
    const command = `claude -p --model sonnet --effort medium --output-format stream-json --verbose --tools "${tools}" --allowedTools ${permissions} --permission-mode dontAsk `
        + `--setting-sources "" --strict-mcp-config --no-session-persistence --disable-slash-commands`;
    const state = readState(config);
    state.run = { kind, state: "running", started: new Date().toISOString(), finished: null, message: null, tokens: null, cost: null };
    writeState(config, state);

    child = spawn(command, { shell: true, windowsHide: true, cwd: config.root, env: ownEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const timer = setTimeout(() => stop(child), timeoutMinutes * 60000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("close", (code) => {
        clearTimeout(timer);
        child = null;
        const latest = readState(config);
        const answer = parsed(output);
        writeFileSync(join(stateFolder(config), `last-${kind}.jsonl`), output);
        latest.run = { ...state.run, finished: new Date().toISOString(), tokens: tokensOf(answer), cost: answer?.total_cost_usd ?? null, denials: denialsOf(answer) };

        try {
            if (code !== 0 || typeof answer?.result !== "string" || answer.is_error) {
                throw new Error(answer?.result || errors.trim().slice(-400) || `Claude Code exited with code ${code}.`);
            }

            latest.run.message = finish(latest, answer.result);
            latest.run.state = "done";
        } catch (error) {
            latest.run.state = "failed";
            latest.run.message = String(error?.message ?? error);
        }

        latest.lastTokens = latest.run.tokens ?? latest.lastTokens ?? null;
        writeState(config, latest);
    });
    child.stdin.end(brief);
    return true;
}

/** Stops a run with what it started: Claude Code runs under a shell, which a plain kill leaves alive on Windows. */
function stop(running)
{
    if (!running) {
        return;
    }

    if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(running.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    } else {
        running.kill();
    }
}

function proposalsOf(text)
{
    const list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return list.filter((proposal) => proposal && proposal.id && proposal.title).map((proposal) => ({ id: String(proposal.id), kind: proposal.kind ?? "other", file: proposal.file ?? "", line: proposal.line ?? null, title: proposal.title, why: proposal.why ?? "", change: proposal.change ?? "", waits: proposal.waits || null }));
}

function objectOf(text)
{
    try {
        return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
        return {};
    }
}

/** The result event of Claude Code's stream: its last line of type "result". */
function parsed(output)
{
    for (const line of output.split("\n").filter((one) => one.startsWith("{")).reverse()) {
        try {
            const event = JSON.parse(line);

            if (event.type === "result") {
                return event;
            }
        } catch {
            // a line cut short: the result is a later one
        }
    }

    return null;
}

/** The tool calls the permissions refused, to see why a run changed nothing. */
function denialsOf(answer)
{
    return (answer?.permission_denials ?? []).map((denial) => `${denial.tool_name} ${denial.tool_input?.file_path ?? denial.tool_input?.command ?? ""}`.trim());
}

function tokensOf(answer)
{
    const usage = answer?.usage;
    return usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : null;
}

/** This process's environment without a chat's own variables or an API key: Claude Code uses the user's login. */
function ownEnvironment()
{
    const kept = new Set(["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH"]);
    return Object.fromEntries(Object.entries(process.env).filter(([name]) => kept.has(name.toUpperCase()) || !/^(CLAUDE|ANTHROPIC)/i.test(name)));
}

/** Where a project's runs keep their state: the system's temporary folder, one folder per project, never the repo. */
function stateFolder(config)
{
    const folder = join(tmpdir(), "claude-project", createHash("sha1").update(config.root.toLowerCase()).digest("hex").slice(0, 12));
    mkdirSync(folder, { recursive: true });
    return folder;
}

function readState(config)
{
    const path = join(stateFolder(config), "state.json");

    try {
        return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    } catch {
        return {};
    }
}

function writeState(config, state)
{
    writeFileSync(join(stateFolder(config), "state.json"), JSON.stringify(state, null, 2));
}
