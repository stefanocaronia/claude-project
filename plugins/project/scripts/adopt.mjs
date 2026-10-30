// Adopting a project that already keeps a plan, a backlog or decisions: finds them, works out the configuration that reads them, says
// what reads and what does not; with write, writes the configuration and the docs that are missing; with steps, moves the plan's
// checkbox steps into the backlog. Run through init.mjs adopt.
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { formatLine, nextId, parseBacklog } from "../lib/backlog.mjs";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { parseDecisions } from "../lib/decisions.mjs";
import { phaseSuffix, planGoals, planPhases } from "../lib/plan.mjs";
import { quoted } from "../lib/text.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { presets, stateKeys } from "../lib/words.mjs";
import { colleagues, git, loadProject, readmeTitle, ProjectError, read, readBacklog, realPath, shown, today, withBacklogLock, write, writeBacklog } from "./project.mjs";

const skipped = new Set(["node_modules", ".git", "dist", "build", "tmp", "sandbox", ".codegraph", "worktrees", "coverage"]);
const textFile = /\.(md|ts|tsx|js|mjs|cjs|yaml|yml|json|py)$/;
const citation = /\bD-\d+\b/;

/** What the project already has, and the configuration that would read it: { found, settings, report }. */
export function survey(root)
{
    const docs = docsFolder(root);
    const names = docs ? readdirSync(join(root, docs)) : [];
    const language = languageOf(root, docs, names);
    const words = presets[language];
    const decisionsName = names.find((name) => Object.values(presets).some((preset) => preset.files.decisions === name)) ?? words.files.decisions;
    const tasks = docs ? [read(join(root, docs, words.files.tasks)), read(join(root, docs, words.files.archive))] : [];
    const team = colleagues({ agents: join(root, ".claude", "agents") }).map((colleague) => colleague.name);
    const holders = [...new Set(tasks.flatMap((text, index) => parseBacklog(text, words, "T", index === 1).tasks.map((task) => task.to)))].filter((name) => !team.includes(name) && name !== "Claude");
    const folder = docs ?? "project";
    const settings = {
        name: readmeTitle(root) ?? basename(root),
        language,
        docs: folder,
        people: ["Claude", ...holders],
        cites: [folder, ".claude", ...citingParts(root, folder)],
        ...(decisionsName !== words.files.decisions ? { files: { decisions: decisionsName } } : {}),
    };

    return { found: { docs, names, ownRepo: docs !== null && repoOf(join(root, docs)) !== repoOf(root) }, settings, report: report(root, settings) };
}

/** Writes the configuration the survey found, unless one is there; then the docs that are missing, by init. */
export function writeSettings(root, settings)
{
    const path = join(root, configFile);

    if (existsSync(path)) {
        return false;
    }

    const list = (items) => `[${items.map(quoted).join(", ")}]`;
    const lines = [`name: ${quoted(settings.name)}`, `language: ${settings.language}`, `docs: ${quoted(settings.docs)}`, `people: ${list(settings.people)}`, `cites: ${list(settings.cites)}`];

    if (settings.files) {
        lines.push(`files: { ${Object.entries(settings.files).map(([key, value]) => `${key}: ${quoted(value)}`).join(", ")} }`);
    }

    write(path, `${lines.join("\n")}\n`);
    return true;
}

/** The plan's checkbox steps under its goals, moved into the backlog: open ones to do, done ones archived; the plan keeps the rest. */
export function moveSteps(root)
{
    const { config, say } = loadProject(root);
    return withBacklogLock(config, () => moveStepsLocked(config, say));
}

function moveStepsLocked(config, say)
{
    const text = read(config.files.plan);
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const { tasks, unread } = readBacklog(config);

    // Writing the backlog again would lose the lines it cannot read: they are fixed first, as the backlog's own commands ask.
    if (unread.length > 0) {
        throw new ProjectError(say("unreadFirst", { lines: unread.map((one) => `${shown(config, one.file)}:${one.line}`).join(", ") }));
    }

    const goals = new Set(planGoals(text, config.words).map((goal) => goal.name));
    const phase = phaseSuffix(config.words);
    const day = today();
    const kept = [];
    const moved = [];
    let goal = null;
    let current = null;

    for (const line of text.split(/\r?\n/)) {
        const heading = /^(#{2,3}) (.+)$/.exec(line);

        if (heading) {
            const name = heading[2].replace(phase, "").trim();
            goal = heading[1] === "###" && goals.has(name) ? name : null;
            current = null;
            kept.push(line);
            continue;
        }

        const step = goal ? parseTodo(line) : null;

        if (step && step.indent === "") {
            current = { id: nextId([...tasks, ...moved]), priority: step.priority ?? "P2", effort: config.words.efforts.medium, to: config.people[0], created: step.created ?? day, goal, text: oneLine(step.text), done: step.done ? (step.created ?? day) : null, archived: step.done ? day : null, state: step.done ? "archived" : "todo" };
            moved.push(current);
            continue;
        }

        // A step's sub-lines join its text: the backlog holds a task on one line.
        if (current && /^\s+\S/.test(line)) {
            current.text = oneLine(`${current.text}; ${line.trim().replace(/^[-*]\s+(\[[ x]\]\s+)?/, "")}`);
            continue;
        }

        current = null;
        kept.push(line);
    }

    if (moved.length > 0) {
        writeBacklog(config, [...tasks, ...moved]);
        write(config.files.plan, kept.join(newline).replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline));
    }

    return moved.map((task) => formatLine(task, config.words, config.prefixes.task));
}

/** What reads and what does not, in lines for the person who decides. */
function report(root, settings)
{
    // The settings as the file would hold them: YAML reads JSON as it is.
    const config = readConfig(JSON.stringify(settings), root);
    const plan = read(config.files.plan);
    const backlog = parseBacklog(read(config.files.tasks), config.words, config.prefixes.task);
    const decisions = parseDecisions(read(config.files.decisions), config.words);
    const steps = goalsSteps(plan, config);
    const lines = [];
    const shown = (path) => relativeTo(root, path);
    const present = (path) => existsSync(path);

    lines.push(present(config.files.plan) ? `plan ${shown(config.files.plan)}: ${planPhases(plan).length} phases, ${planGoals(plan, config.words).length} goals${steps.open + steps.done > 0 ? `, ${steps.open} open and ${steps.done} done checkbox steps under the goals (adopt --steps moves them into the backlog)` : ""}` : `plan ${shown(config.files.plan)}: missing, init writes it`);
    lines.push(present(config.files.tasks) ? `backlog ${shown(config.files.tasks)}: ${backlog.tasks.length} tasks${backlog.unread.length > 0 ? `, ${backlog.unread.length} lines that do not read (first at line ${backlog.unread[0].line})` : ""}; its headings: ${stateKeys.map((key) => config.words.states[key]).join(", ")}` : `backlog ${shown(config.files.tasks)}: missing, init writes it`);
    lines.push(present(config.files.decisions) ? `decisions ${shown(config.files.decisions)}: ${decisions.decided.length} decided, ${decisions.open.length} to decide${decisions.openLine === null ? ` (no "## ${config.words.open}" heading)` : ""}` : `decisions ${shown(config.files.decisions)}: missing, init writes it`);
    lines.push(`colleagues: ${colleagues(config).length}${colleagues(config).length > 0 ? " (Crew)" : ", no Crew: tasks go to the people"}`);
    return lines;
}

function goalsSteps(plan, config)
{
    const goals = new Set(planGoals(plan, config.words).map((goal) => goal.name));
    const phase = phaseSuffix(config.words);
    let inGoal = false;
    let open = 0;
    let done = 0;

    for (const line of plan.split(/\r?\n/)) {
        const heading = /^(#{2,3}) (.+)$/.exec(line);

        if (heading) {
            inGoal = heading[1] === "###" && goals.has(heading[2].replace(phase, "").trim());
        } else if (inGoal && parseTodo(line)?.indent === "") {
            parseTodo(line).done ? done++ : open++;
        }
    }

    return { open, done };
}

/** The folder, up to three levels down, that holds the most of a plan, a backlog and decisions; null when none does. */
function docsFolder(root)
{
    const wanted = new Set(Object.values(presets).flatMap((preset) => [preset.files.plan, preset.files.tasks, preset.files.decisions]));
    let best = null;

    const walk = (folder, depth) => {
        const entries = readdirSync(join(root, folder), { withFileTypes: true });
        const count = entries.filter((entry) => entry.isFile() && wanted.has(entry.name)).length;

        if (count > 0 && (best === null || count > best.count || (count === best.count && depth < best.depth))) {
            best = { folder, count, depth };
        }

        if (depth < 3) {
            entries.filter((entry) => entry.isDirectory() && !skipped.has(entry.name) && !entry.name.startsWith(".")).forEach((entry) => walk(folder ? `${folder}/${entry.name}` : entry.name, depth + 1));
        }
    };

    walk("", 0);
    return best?.folder || (best ? "." : null);
}

/** The language whose words the docs use the most: the backlog's headings, the plan's goals, the decisions' file and open heading. */
function languageOf(root, docs, names)
{
    if (!docs) {
        return "en";
    }

    const text = (name) => read(join(root, docs, name));
    const scores = Object.entries(presets).map(([language, words]) => {
        const tasks = text(words.files.tasks);
        const plan = text(words.files.plan);
        const decisions = text(words.files.decisions);
        const score = Object.values(words.states).filter((state) => tasks.includes(`## ${state}`)).length
            + (plan.includes(`## ${words.goals}`) ? 2 : 0)
            + (names.includes(words.files.decisions) ? 1 : 0)
            + (decisions.includes(`## ${words.open}`) ? 2 : 0);
        return { language, score };
    });
    return scores.sort((first, second) => second.score - first.score)[0].score > 0 ? scores[0].language : "en";
}

/** The top-level files and folders of the project that cite a decision, `D-12`: where the check looks for references. */
function citingParts(root, docs)
{
    const top = docs.split("/")[0];
    const cites = (path) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, entry.name);

            if (entry.isDirectory() ? !skipped.has(entry.name) && cites(child) : textFile.test(entry.name) && citation.test(read(child))) {
                return true;
            }
        }

        return false;
    };

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith(".") && entry.name !== top && !skipped.has(entry.name))
        .filter((entry) => (entry.isDirectory() ? cites(join(root, entry.name)) : textFile.test(entry.name) && citation.test(read(join(root, entry.name)))))
        .map((entry) => entry.name);
}

function repoOf(folder)
{
    return git(realPath(folder), ["rev-parse", "--show-toplevel"]).trim().toLowerCase();
}

function oneLine(text)
{
    return text.replace(/\s+·\s+/g, ", ").replace(/\s+/g, " ").trim();
}
