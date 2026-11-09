// The cleanup from the page: the mechanical fixes run here; the proposals and their application are runs of Claude Code with the
// plugin's tidy skill, on the user's own login, reading only and then changing only what the user ticked.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixFrontmatter, fixWhitespace } from "../services/check/index.mjs";
import { realPath, shown } from "../services/files.mjs";
import { renameCore } from "../services/setup/index.mjs";
import { dateTasks } from "../services/backlog/index.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const timeoutMinutes = 20;
let child = null;

/** What the cleanup card shows: what the mechanical fixes would touch, the AI run and its proposals. */
export function tidyState(config)
{
    return { whitespace: mechanical(config), undated: dateTasks(config, false), ...readState(config), running: child !== null };
}

/** Whether a run of Claude Code is going: the page's server waits for it before it restarts. */
export function isRunning()
{
    return child !== null;
}

/** A mechanical fix, written: "whitespace" (the core's English names and format, the spacing, every doc's frontmatter) or "dates";
 * returns what it changed. */
export function runFix(config, fix)
{
    if (fix === "dates") {
        return dateTasks(config, true);
    }

    if (fix !== "whitespace") {
        return [];
    }

    const renamed = renameCore(config.root, true);
    return [...new Set([...renamed.steps.map((step) => step.to), ...renamed.changed, ...fixWhitespace(config, true), ...fixFrontmatter(config, true)])];
}

/** The files the mechanical fix would touch, each once: the core under its old names or format, the spacing, the frontmatter. */
function mechanical(config)
{
    const renamed = renameCore(config.root, false);
    return [...new Set([...renamed.steps.map((step) => step.from), ...renamed.formats, ...fixWhitespace(config, false), ...fixFrontmatter(config, false)])];
}

/** Starts the run that writes the proposals, reading only, on the docs or on the backlog; false when a run is going. */
export function propose(config, scope = "docs")
{
    if (scope === "backlog") {
        return proposeBacklog(config);
    }

    const check = `node ${pluginRoot}/scripts/check.mjs`;
    const brief = `Run the tidy skill of the project plugin: read ${pluginRoot}/skills/tidy/SKILL.md and do only its section 2, the docs, as proposals. Change no file.
Start from the report of \`${check}\`, whose files are relative to the project's root. Read with Read and Grep; Bash is only for that command. Read only the lines the findings point at (Read with offset and limit) and what you need to judge them.
The docs' form only: links, the index, the folders. No decision, no point to decide, no task, no colleague's todo: those are the backlog's tidy. Every proposal changes something. The whitespace, the blank lines, the docs' frontmatter, the core's English names and format and the tasks' dates the page fixes itself: do not propose them.
A proposal that cannot be applied now carries in "waits" what it waits for: "user" (a choice of theirs) or "a run of its own" (a long piece of work, apart); the others have "waits": null, and "change" says exactly what will change in the file.
Answer with a JSON array and nothing else, at most 25 proposals, the most useful first, written in the project's language (${config.language}):
[{"id": "p1", "kind": "index | link | folder | weight | other", "file": "${shown(config, config.files.index)}", "line": 12, "title": "one line", "why": "the reason, in one or two sentences", "change": "exactly what will change in the file", "waits": null}]`;

    return startRun(config, "propose", brief, ["Read", "Grep", "Glob", `Bash(${check})`], (state, result) => {
        state.proposals = proposalsOf(result);
        state.applied = null;
        state.scope = "docs";
        return `${state.proposals.length}`;
    });
}

/** The backlog tidied as the chat tidies it, with the decisions: the minimum done at once (a type, a priority and who does it for every
 * open task, the parts' goals, the texts), then proposals to tick for what is left (tasks already done or made moot, large tasks,
 * duplicates; decisions superseded or doubled, points to decide already taken, moot or doubled: never resolved). The minimum is the only
 * change this run makes. */
function proposeBacklog(config)
{
    const backlog = `node ${pluginRoot}/scripts/backlog.mjs`;
    const brief = `Run the tidy skill of the project plugin on the backlog and the decisions: read ${pluginRoot}/skills/tidy/SKILL.md, section 3 and «Asking, in both». The user is not here to answer: the proposals they tick on the page are your questions.
Read the backlog with \`${backlog} list --json\`, the done ones with \`${backlog} list --state done --json\`, a task whole with \`${backlog} show T-n\`; the plan's goals in ${shown(config, config.files.plan)}; the decisions a task cites, and the later ones, in ${shown(config, config.files.decisions)} with Grep (never read it whole); who can do a task: the people ${config.people.join(", ")} and, with Crew, the colleagues of .claude/agents/, each with their field in their profile; the points still to decide under the "to decide" heading of ${shown(config, config.files.decisions)} (find it with Grep, then Read from its line); with Crew, the colleagues' open todo lines that cite no task with \`${backlog} todos --json\`.
First the minimum, yourself, at once, with \`${backlog} set T-n\` and only its --type, --p, --to, --goal and --text: a type, a priority and who does it for every open task (to do, in progress, postponed, large tasks included) that lacks one or has a wrong one, a part's goal its large task's, a text that breaks the line's rules (one line, clear, no « · »). Change no other file and nothing else. Then propose only what is plainly closed, superseded, contradicted by an accepted decision, done, doubled or wrong, as the skill's section 3 says: the decisions reordered, cleared and merged, never resolved; whether an item still stands, never what to decide; an open point or a vague task stays as it is, with no proposal. Few proposals are better than many. Run each command alone, exactly as written here: no cd, no pipes, no other program. Every proposal changes something, and "change" is the exact \`${backlog} …\` command or commands that apply it; a large task's new parts are added with \`--in T-n\`, the large task's number. A proposal on the decisions has "kind": "decision" (a row superseded or doubled, reduced as the skill says) or "to decide" (a point removed, merged or moved beside its subject), "file": "${shown(config, config.files.decisions)}", the line of the first row or point it touches, and in "change" exactly which lines go and which come. A colleague's todo line that is work for the project, not their own note (the skill's section 3 says which), is a proposal with "kind": "todo", its "file" and "line" as the list gives them, and in "change" \`${backlog} take <ref> --to <who>\` with its --type and, when the line is long or unclear, --text in one clear line. A proposal that cannot be applied now carries in "waits" what it waits for: "user" (a decision of theirs) or "a run of its own"; the others have "waits": null.
Answer with a JSON object and nothing else, at most 25 proposals, the most useful first, written in the project's language (${config.language}): "minimum" the changes you made, "proposals" the rest to tick:
{"minimum": [{"task": "T-12", "change": "type bug, priority P2", "why": "a crash, not a feature"}], "proposals": [{"id": "p1", "kind": "task", "file": "${shown(config, config.files.tasks)}", "line": null, "title": "one line", "why": "the reason, in one or two sentences", "change": "${backlog} done T-12", "waits": null}]}`;

    return startRun(config, "propose", brief, ["Read", "Grep", "Glob", `Bash(${backlog} list *)`, `Bash(${backlog} show *)`, `Bash(${backlog} set *)`, `Bash(${backlog} todos *)`], (state, result) => {
        const answer = objectOf(result);
        const minimum = Array.isArray(answer.minimum) ? answer.minimum : [];
        state.proposals = Array.isArray(answer.proposals) ? proposalsOf(JSON.stringify(answer.proposals)) : proposalsOf(result);
        // The minimum is done: shown as applied, each change with its task.
        state.applied = minimum.length > 0 ? { at: new Date().toISOString(), applied: minimum.map((_, index) => `m${index + 1}`), skipped: [], summary: minimum.map((change) => `${change.task}: ${change.change}`).join("; ") } : null;
        state.scope = "backlog";
        return `${state.proposals.length}`;
    });
}

/** Starts the run that applies the proposals the user ticked, and only those; false when there is none or a run is going. */
export function apply(config, ids)
{
    const saved = readState(config);
    const chosen = (saved.proposals ?? []).filter((proposal) => ids.includes(proposal.id) && !proposal.waits);

    if (chosen.length === 0) {
        return false;
    }

    const check = `node ${pluginRoot}/scripts/check.mjs`;

    // The backlog's proposals are applied through its command alone.
    if (saved.scope === "backlog") {
        const backlog = `node ${pluginRoot}/scripts/backlog.mjs`;
        const decisions = shown(config, config.files.decisions);
        const brief = `Apply these proposals on the backlog and on the decisions, approved by the user, and only these: a task's with the \`${backlog} …\` commands its "change" names, a decision's or a point to decide's with Edit in ${decisions}, exactly as its "change" says; an open point is never resolved:
${JSON.stringify(chosen, null, 2)}
Follow ${pluginRoot}/skills/tidy/SKILL.md, section 3 and "The rules that stay". If a command is refused, read its message, fix the command once, or skip the proposal and say why. At the end run \`${check}\`.
Answer with a JSON object and nothing else, its summary in the project's language (${config.language}): {"applied": ["p1"], "skipped": [{"id": "p3", "why": "..."}], "summary": "two or three sentences"}`;
        return startRun(config, "apply", brief, ["Read", "Grep", `Edit(${decisions})`, `Bash(${backlog} *)`, `Bash(${check})`], appliedOf);
    }

    const docs = shown(config, config.docs);
    const memory = shown(config, config.memory);
    const brief = `Apply these proposals of the cleanup, approved by the user, and only these:
${JSON.stringify(chosen, null, 2)}
Follow ${pluginRoot}/skills/tidy/SKILL.md, section 2 and "The rules that stay". The proposals' files are relative to the project's root. Change only those files, with Edit, and read them with Read and Grep; never a decision, a point to decide or a task. Bash is only for \`${check}\` and \`${check} --fix\` (whitespace, blank lines and the docs' frontmatter). Another session may change a file while you work: if an Edit is refused or the line is gone, read the file again and try once more. If a proposal cannot be applied as written, skip it and say why. At the end run \`${check}\`.
Answer with a JSON object and nothing else, its summary in the project's language (${config.language}): {"applied": ["p1"], "skipped": [{"id": "p3", "why": "..."}], "summary": "two or three sentences"}`;

    // The colleagues' memory may sit past a link (.claude into a private repo): the rule names both paths.
    const realMemory = shown(config, realPath(config.memory).replaceAll("\\", "/"));
    const edits = [...new Set([`Edit(${docs}/**)`, `Edit(${memory}/**)`, `Edit(${realMemory}/**)`])];
    return startRun(config, "apply", brief, ["Read", "Grep", "Glob", ...edits, `Bash(${check})`, `Bash(${check} --fix)`], appliedOf);
}

/** What a run that applied wrote in the state: the proposals it applied gone from the list, what it applied and skipped, its summary. */
function appliedOf(state, result)
{
    const outcome = objectOf(result);
    const applied = new Set(outcome.applied ?? []);
    state.proposals = (state.proposals ?? []).filter((proposal) => !applied.has(proposal.id));
    state.applied = { at: new Date().toISOString(), applied: [...applied], skipped: outcome.skipped ?? [], summary: outcome.summary ?? result.slice(0, 600) };
    return outcome.summary ?? "";
}

/** Starts a run of Claude Code on a brief, with only the tools and permissions allowed, its state kept as it goes; finish writes its answer
 * into the state and returns the run's message. False when a run is going. */
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
    // The rules reach a shell between double quotes, with paths from the configuration: one that holds a quote or a character
    // the shell expands would change the command, so the run does not start.
    const unsafe = allowed.find((rule) => /["`$%\r\n]/.test(rule));

    if (unsafe) {
        state.run = { ...state.run, state: "failed", finished: state.run.started, message: `A path holds a character the shell would read, so the run did not start: ${unsafe}` };
        writeState(config, state);
        return true;
    }

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

/** The proposals of a run's answer, its JSON array, each with its fields; one without an id or a title is left out. */
function proposalsOf(text)
{
    const list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return list.filter((proposal) => proposal && proposal.id && proposal.title).map((proposal) => ({ id: String(proposal.id), kind: proposal.kind ?? "other", file: proposal.file ?? "", line: Number.isInteger(proposal.line) ? proposal.line : null, title: proposal.title, why: proposal.why ?? "", change: proposal.change ?? "", waits: proposal.waits || null }));
}

/** The JSON object of a run's answer; {} when it has none. */
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

/** The tokens a run used, cached ones included; null when its answer does not say. */
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

/** A project's cleanup state: its last run, the proposals and what was applied; {} before the first or when it does not read. */
function readState(config)
{
    const path = join(stateFolder(config), "state.json");

    try {
        return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    } catch {
        return {};
    }
}

/** Writes a project's cleanup state whole. */
function writeState(config, state)
{
    writeFileSync(join(stateFolder(config), "state.json"), JSON.stringify(state, null, 2));
}
