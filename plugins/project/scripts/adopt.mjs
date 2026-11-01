// Adopting a project that already keeps a plan, a backlog or decisions: finds them, works out the configuration that reads them, says
// what reads and what does not; with write, writes the configuration and the docs that are missing; with steps, moves the plan's
// checkbox steps into the backlog. Run through init.mjs adopt.
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { formatLine, nextId, parseBacklog } from "../lib/backlog.mjs";
import { configFile, readConfig, relativeTo } from "../lib/config.mjs";
import { parseDecisions } from "../lib/decisions.mjs";
import { phaseSuffix, planGoals, planPhases } from "../lib/plan.mjs";
import { escapeRegex, quoted } from "../lib/text.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { legacyFiles, presets, readable, stateKeys, wordsOf } from "../lib/words.mjs";
import { changeableBacklog, colleagues, fail, loadProject, readmeTitle, read, readDecisions, realPath, repoTop, shown, today, withBacklogLock, write, writeBacklog, writeDoc } from "./project.mjs";

const skipped = new Set(["node_modules", ".git", "dist", "build", "tmp", "sandbox", ".codegraph", "worktrees", "coverage"]);
const textFile = /\.(md|ts|tsx|js|mjs|cjs|yaml|yml|json|py)$/;
const citation = /\bD-\d+\b/;

/** What the project already has, and the configuration that would read it: { found, settings, report }. */
export function survey(root)
{
    const docs = docsFolder(root);
    const names = docs ? readdirSync(join(root, docs)) : [];
    const language = docsLanguage(root, docs, names);
    const words = wordsOf(language);
    const decisionsName = names.find((name) => [words.files.decisions, legacyFiles.decisions].includes(name)) ?? words.files.decisions;
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

    const isOwnRepo = docs !== null && repoTop(realPath(join(root, docs))) !== repoTop(realPath(root));
    return { found: { docs, names, ownRepo: isOwnRepo }, settings, report: report(root, settings) };
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
    const { config } = loadProject(root);
    return withBacklogLock(config, () => moveStepsLocked(config));
}

/** The steps moved, once the backlog's lock is held: their lines in the backlog. */
function moveStepsLocked(config)
{
    const text = read(config.files.plan);
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    // Writing the backlog again would lose the lines it cannot read: they are fixed first, as the backlog's own commands ask.
    const tasks = changeableBacklog(config);
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
        writeDoc(config, config.files.plan, kept.join(newline).replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline));
    }

    return moved.map((task) => formatLine(task, config.words, config.prefixes.task));
}

/** A numbered list of decisions under a heading of another file (`72. **Title** text…`), moved into the decisions' table with the same
 * numbers, so that every citation stays true: the why is the text after the language's «Why:», when there is one; the list leaves a
 * line in its place that points to the table. Refused when a number is in the table already. */
export function moveDecisions(root, file, heading)
{
    const { config, say } = loadProject(root);
    const source = join(root, file).replaceAll("\\", "/");
    const text = read(source);
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => new RegExp(`^(#+)\\s+${escapeRegex(heading)}\\s*$`).test(line));

    if (start < 0) {
        fail(say("noHeading", { heading, file }));
    }

    const level = /^#+/.exec(lines[start])[0].length;
    const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
    const body = lines.slice(start + 1, end < 0 ? lines.length : end);
    const rows = [];

    for (const line of body) {
        const item = /^(\d+)\.\s+(.*)$/.exec(line);

        if (item) {
            rows.push({ number: Number(item[1]), text: item[2].trim() });
        } else if (rows.length > 0 && line.trim() !== "") {
            // A line that goes on with the item before joins it: a cell of the table is one line.
            rows.at(-1).text += ` ${line.trim().replace(/^[-*]\s+/, "")}`;
        }
    }

    const { decided } = readDecisions(config);
    const taken = new Set(decided.map((row) => row.number));
    const clash = rows.filter((row) => taken.has(row.number)).map((row) => `${config.prefixes.decision}-${row.number}`);

    if (clash.length > 0) {
        fail(say("decisionsClash", { list: clash.join(", ") }));
    }

    // The why of a decision written in prose, in the format's word or the language's.
    const why = new RegExp(`\\s+(?:${[config.words.why, config.labels.why].map(escapeRegex).join("|")}):\\s+`, "i");
    const cells = rows.map((row) => {
        const parts = row.text.replace(/\s+\|\s+/g, " / ").split(why);
        return { number: row.number, text: parts[0].trim(), why: parts.slice(1).join(" ").trim() };
    });
    writeDoc(config, config.files.decisions, withRows(read(config.files.decisions), cells.map((row) => `| ${row.number} | ${row.text} | ${row.why} |`), config.words));
    const kept = [...lines.slice(0, start + 1), "", say("decisionsMoved", { name: config.files.decisions.split("/").at(-1), path: relative(dirname(source), config.files.decisions).replaceAll("\\", "/") }), "", ...(end < 0 ? [] : lines.slice(end))];
    writeDoc(config, source, kept.join(newline));
    return { count: cells.length, file: shown(config, config.files.decisions) };
}

/** The decisions' text with these rows in its table, every row by number: the rows already there stay as written, and so does what
 * is above the table and the points to decide; a file without a table gets one. */
function withRows(text, added, words)
{
    const lines = text.split(/\r?\n/);
    const numberOf = (line) => Number(/^\|\s*(\d+)\s*\|/.exec(line)?.[1] ?? Number.NaN);
    const openAt = lines.findIndex((line) => readable(words, "open").some((word) => line.startsWith(`## ${word}`)));
    const end = openAt < 0 ? lines.length : openAt;
    const rowsAt = lines.map((line, index) => (index < end && !Number.isNaN(numberOf(line)) ? index : -1)).filter((index) => index >= 0);
    const header = lines.findIndex((line, index) => index < end && /^\|\s*#\s*\|/.test(line));
    const first = rowsAt[0] ?? (header >= 0 ? header + 2 : -1);
    const last = rowsAt.at(-1) ?? first - 1;
    const rows = [...rowsAt.map((index) => lines[index]), ...added].sort((one, other) => numberOf(one) - numberOf(other));

    if (first < 0) {
        const above = lines.slice(0, end).join("\n").trimEnd();
        const below = openAt < 0 ? `## ${words.open}\n` : lines.slice(openAt).join("\n");
        return `${above}${above ? "\n\n" : ""}| # | ${words.decision} | ${words.why} |\n|---|---|---|\n${rows.join("\n")}\n\n${below}`;
    }

    return [...lines.slice(0, first), ...rows, ...lines.slice(last + 1)].join("\n");
}

/** What reads and what does not, in lines for the person who decides. */
function report(root, settings)
{
    // The settings as the file would hold them: YAML reads JSON as it is.
    const config = readConfig(JSON.stringify(settings), root);
    const plan = read(config.files.plan);
    const backlog = parseBacklog(read(config.files.tasks), config.words, config.prefixes.task);
    const decisions = parseDecisions(read(config.files.decisions), config.words);
    const steps = countSteps(plan, config);
    const team = colleagues(config).length;
    const where = (path) => relativeTo(root, path);
    return [
        existsSync(config.files.plan) ? `plan ${where(config.files.plan)}: ${planPhases(plan).length} phases, ${planGoals(plan, config.words).length} goals${steps.open + steps.done > 0 ? `, ${steps.open} open and ${steps.done} done checkbox steps under the goals (adopt --steps moves them into the backlog)` : ""}` : `plan ${where(config.files.plan)}: missing, init writes it`,
        existsSync(config.files.tasks) ? `backlog ${where(config.files.tasks)}: ${backlog.tasks.length} tasks${backlog.unread.length > 0 ? `, ${backlog.unread.length} lines that do not read (first at line ${backlog.unread[0].line})` : ""}; its headings: ${stateKeys.map((key) => config.words.states[key]).join(", ")}` : `backlog ${where(config.files.tasks)}: missing, init writes it`,
        existsSync(config.files.decisions) ? `decisions ${where(config.files.decisions)}: ${decisions.decided.length} decided, ${decisions.open.length} to decide${decisions.openLine === null ? ` (no "## ${config.words.open}" heading)` : ""}` : `decisions ${where(config.files.decisions)}: missing, init writes it`,
        `colleagues: ${team}${team > 0 ? " (Crew)" : ", no Crew: tasks go to the people"}`,
    ];
}

/** How many checkbox steps the plan has under its goals, open and done: what adopt --steps would move. */
function countSteps(plan, config)
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

/** The project's language: the one its configuration names, once written; else the one whose words the docs use the most, the backlog's
 * headings, the plan's goals, the decisions' file and open heading, as each language's files wrote them before the format went English. */
function docsLanguage(root, docs, names)
{
    const named = /^language:\s*["']?([a-z]{2})/m.exec(read(join(root, ".claude", "project.yaml")))?.[1];

    if (named && presets[named]) {
        return named;
    }

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
            + (names.includes(language === "it" ? legacyFiles.decisions : words.files.decisions) ? 1 : 0)
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

/** A step's text on the one line a task holds, the « · » that would split it into fields made a comma. */
function oneLine(text)
{
    return text.replace(/\s+·\s+/g, ", ").replace(/\s+/g, " ").trim();
}
