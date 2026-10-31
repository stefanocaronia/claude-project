// The health of the project docs: node check.mjs [--fix] [--json]. Read-only without --fix, which fixes whitespace and the docs' frontmatter.
import { existsSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseBacklog, citedTasks } from "../lib/backlog.mjs";
import { citedDecisions, dayOf, numbering } from "../lib/decisions.mjs";
import { planUpdated } from "../lib/plan.mjs";
import { escapeRegex } from "../lib/text.mjs";
import { codeView, issueOf } from "../lib/code.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { readCode, readIssues } from "./code.mjs";
import { backlogProblems } from "./backlog.mjs";
import { extensionChecks, loadExtensions } from "./extensions.mjs";
import { readable } from "../lib/words.mjs";
import { betterDescription, joinFrontmatter, splitFrontmatter } from "../lib/frontmatter.mjs";
import { citingFiles, docFiles, isMain, legacyFormat, stampDoc, loadProject, read, readBacklog, readDecisions, readDependencies, readGoals, readSpecs, readTodos, runCli, shown, specCitations, taskLinks, today, todoFiles, todoIdsEver } from "./project.mjs";

/** Every finding about the docs, from errors that must be fixed to notes for the cleanup: { severity, kind, file, line, message }. */
export function check(config, say)
{
    const findings = [];
    const add = (severity, kind, file, line, message) => findings.push({ severity, kind, file: file === null ? null : shown(config, file), line, message });
    const decisions = readDecisions(config).decided;

    checkNumbering(config, say, decisions, add);
    checkReferences(config, say, decisions, add);
    checkSpecs(config, say, add);
    checkRevisions(config, say, decisions, add);
    checkTodos(config, say, add);
    checkBacklog(config, say, add);
    checkLinks(config, say, add);
    checkCode(config, say, add);
    checkTime(config, say, add);
    checkPlan(config, say, add);
    checkOpen(config, say, add);
    checkMarkdown(config, say, add);
    checkIndex(config, say, add);
    checkNames(config, say, add);
    checkFrontmatter(config, say, add);
    checkWeight(config, say, add);

    return findings;
}

/** The docs with trailing spaces or runs of blank lines, as shown paths; with write, those fixed. */
export function fixWhitespace(config, write = true)
{
    const changed = [];

    for (const path of markdownFiles(config)) {
        const text = read(path);
        const newline = text.includes("\r\n") ? "\r\n" : "\n";
        const fixed = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, "")).join(newline).replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline);

        if (fixed !== text) {
            if (write) {
                writeFileSync(path, fixed);
            }

            changed.push(shown(config, path));
        }
    }

    return changed;
}

/** The markdown the check looks after: the configured folders' files (the docs and their subfolders by default, not the archive),
 * and the colleagues' memory and todo. */
export function markdownFiles(config)
{
    const folders = config.markdown ?? [config.docs, ...subfolders(config.docs).filter((name) => name !== config.archiveFolder && !name.startsWith(".")).map((name) => `${config.docs}/${name}`)];
    const docs = folders.filter(existsSync).flatMap((folder) => readdirSync(folder).filter((name) => name.endsWith(".md")).map((name) => `${folder}/${name}`));
    const memory = existsSync(config.memory) ? readdirSync(config.memory).flatMap((id) => ["MEMORY.md", "todo.md"].map((name) => `${config.memory}/${id}/${name}`).filter(existsSync)) : [];
    return [...docs, ...memory];
}

if (isMain(import.meta.url)) {
    runCli(async () => {
        const { config, say } = loadProject();

        if (process.argv.includes("--fix")) {
            const changed = fixWhitespace(config);
            console.log(changed.length > 0 ? say("fixed", { files: changed.join(", ") }) : say("fixedNone"));
            const stamped = fixFrontmatter(config);

            if (stamped.length > 0) {
                console.log(say("fixedFrontmatter", { files: stamped.join(", ") }));
            }
        }

        const findings = [...check(config, say), ...(await extensionChecks(config, say, await loadExtensions(config)))];

        if (process.argv.includes("--json")) {
            console.log(JSON.stringify(findings, null, 2));
        } else {
            printReport(findings, say);
        }

        process.exitCode = findings.some((finding) => finding.severity === "error") ? 1 : 0;
    });
}

function checkNumbering(config, say, decisions, add)
{
    const prefix = config.prefixes.decision;
    const seen = new Map();

    for (const row of decisions) {
        if (seen.has(row.number)) {
            add("error", "numbering", config.files.decisions, row.line, say("dupDecision", { id: `${prefix}-${row.number}`, other: seen.get(row.number) }));
        } else {
            seen.set(row.number, row.line);
        }
    }

    for (const number of numbering(decisions).missing) {
        add("note", "numbering", config.files.decisions, null, say("skipped", { id: `${prefix}-${number}` }));
    }
}

/** A decision cited anywhere that the table does not have. */
function checkReferences(config, say, decisions, add)
{
    const prefix = config.prefixes.decision;
    const numbers = new Set(decisions.map((row) => row.number));
    const name = config.files.decisions.split("/").at(-1);

    for (const path of citingFiles(config)) {
        for (const [index, line] of read(path).split(/\r?\n/).entries()) {
            for (const number of citedDecisions(line, prefix)) {
                if (!numbers.has(number)) {
                    add("error", "references", path, index + 1, say("unknownDecision", { id: `${prefix}-${number}`, file: name }));
                }
            }
        }
    }
}

/** The specifications, where the project keeps them: a number used twice, a line that opens as a spec and does not read, a spec cited
 * anywhere (a task's see, a decision, the code, a doc) that the file does not have. */
function checkSpecs(config, say, add)
{
    if (!existsSync(config.files.specs)) {
        return;
    }

    const prefix = config.prefixes.spec;
    const { specs, unread } = readSpecs(config);
    const seen = new Map();

    for (const spec of specs) {
        if (seen.has(spec.number)) {
            add("error", "numbering", config.files.specs, spec.line, say("dupSpec", { id: `${prefix}-${spec.number}`, other: seen.get(spec.number) }));
        } else {
            seen.set(spec.number, spec.line);
        }
    }

    for (const line of unread) {
        add("error", "specs", config.files.specs, line.line, say("unreadSpec", { prefix }));
    }

    const name = config.files.specs.split("/").at(-1);

    for (const cited of specCitations(config).filter((one) => !seen.has(one.number))) {
        add("error", "references", `${config.root}/${cited.file}`, cited.line, say("unknownSpec", { id: `${prefix}-${cited.number}`, file: name }));
    }
}

/** Decisions that a later one revises whole: the candidates to mark as superseded. A number is read whole (D-34 is not D-344), and a
 * revision that goes on past the number, «rivede D-34 (1)», «rivede D-34 per le estensioni», is in part; whole is a number that ends
 * the clause, or one said whole, «rivede D-34 per intero». */
function checkRevisions(config, say, decisions, add)
{
    const { words } = config;
    const prefix = config.prefixes.decision;
    const superseded = new Set(decisions.filter((row) => readable(words, "superseded").some((word) => row.text.startsWith(`${word} ${prefix}-`))).map((row) => row.number));
    const whole = words.wholly.map(escapeRegex).join("|");
    const verbs = new RegExp(`\\b(${words.revises.join("|")})\\s+(?:\\w{1,3}\\s+)?${escapeRegex(prefix)}-(\\d+)(?!\\d)(?=\\s*(?:[.;|]|$|(?:${whole})\\b))`, "gi");

    for (const row of decisions) {
        for (const match of row.text.matchAll(verbs)) {
            const revised = Number(match[2]);
            const around = row.text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12);

            if (!superseded.has(revised) && !around.includes(words.partly)) {
                add("note", "superseded", config.files.decisions, row.line, say("maybeSuperseded", { id: `${prefix}-${row.number}`, verb: match[1], other: `${prefix}-${revised}` }));
            }
        }
    }
}

/** The colleagues' todo lines, as Crew writes them: dated, an open one with its priority, the tasks they cite in the backlog. */
function checkTodos(config, say, add)
{
    const prefix = config.prefixes.task;
    const backlog = new Map([...parseBacklog(read(config.files.tasks), config.words, prefix).tasks, ...parseBacklog(read(config.files.archive), config.words, prefix, true).tasks].map((task) => [task.id, task]));

    for (const { file } of todoFiles(config)) {
        let open = 0;

        for (const [index, line] of read(file).split(/\r?\n/).entries()) {
            const task = parseTodo(line);

            if (!task) {
                continue;
            }

            if (!task.created) {
                add("error", "tasks", file, index + 1, say("todoNoDate"));
            }

            if (task.done) {
                // A line ticked whose task the backlog still holds open: the work may be finished, the task not yet closed.
                for (const id of citedTasks(task.text, prefix).filter((cited) => ["doing", "todo"].includes(backlog.get(cited)?.state))) {
                    add("note", "tasks", file, index + 1, say("todoDoneTaskOpen", { id: `${prefix}-${id}` }));
                }

                continue;
            }

            open += 1;

            if (!task.priority) {
                add("error", "tasks", file, index + 1, say("todoNoPriority"));
            }

            for (const id of citedTasks(task.text, prefix)) {
                const cited = backlog.get(id);

                if (!cited) {
                    add("warning", "tasks", file, index + 1, say("todoCitesUnknown", { id: `${prefix}-${id}` }));
                } else if (cited.state === "done" || cited.state === "archived") {
                    add("note", "tasks", file, index + 1, say("todoCitesClosed", { id: `${prefix}-${id}`, state: cited.state === "done" ? config.labels.doneMarker : config.labels.archivedMarker }));
                }
            }
        }

        if (open > config.limits.todoOpen) {
            add("warning", "tasks", file, null, say("todoTooMany", { count: open, limit: config.limits.todoOpen }));
        }
    }
}

function checkBacklog(config, say, add)
{
    for (const problem of backlogProblems(config, say)) {
        add("error", "backlog", problem.file, problem.line, problem.message);
    }
}

/** The waits of the backlog and the todos read together: a cycle, a todo id nobody gave, a note of a task that is not there. */
function checkLinks(config, say, add)
{
    const prefix = config.prefixes.task;
    const { tasks } = readBacklog(config);
    const graph = readDependencies(config, tasks);
    const todoIds = todoIdsEver(config);
    const todos = readTodos(config);

    for (const cycle of graph.cycles()) {
        // Where the cycle starts: its first task's line, or the first todo line with its id.
        const first = tasks.find((task) => `${prefix}-${task.id}` === cycle[0]) ?? todos.find((todo) => todo.id === cycle[0]);
        add("error", "links", first?.file ?? config.files.tasks, first?.line ?? null, say("cycle", { ids: [...cycle, cycle[0]].join(" → ") }));
    }

    for (const task of tasks) {
        for (const other of task.after.filter((one) => one.startsWith("#") && !todoIds.has(one))) {
            add("warning", "links", task.file, task.line, say("afterUnknownTodo", { id: `${prefix}-${task.id}`, other }));
        }
    }

    // A large task follows its parts: closed while some are open, or open once all are closed.
    const isClosed = (task) => task.state === "done" || task.state === "archived";

    for (const large of tasks.filter((task) => tasks.some((part) => part.parent === `${prefix}-${task.id}`))) {
        const id = `${prefix}-${large.id}`;
        const open = tasks.filter((part) => part.parent === id && !isClosed(part)).map((part) => `${prefix}-${part.id}`);

        if (isClosed(large) && open.length > 0) {
            add("warning", "links", large.file, large.line, say("partsOpen", { id, state: large.state === "done" ? config.labels.doneMarker : config.labels.archivedMarker, list: open.join(", ") }));
        } else if (!isClosed(large) && open.length === 0) {
            add("note", "links", large.file, large.line, say("partsAllDone", { id }));
        }
    }

    const ids = new Set(tasks.map((task) => task.id));
    const notes = existsSync(config.files.notes) ? readdirSync(config.files.notes) : [];

    for (const name of notes) {
        const id = new RegExp(`^${escapeRegex(prefix)}-(\\d+)\\.md$`).exec(name)?.[1];

        if (id && !ids.has(Number(id))) {
            add("warning", "links", `${config.files.notes}/${name}`, null, say("noteOrphan", { id: `${prefix}-${id}` }));
        }
    }
}

/** A task still open that a merged pull request cites: the work may be finished, the task not yet closed. */
function checkCode(config, say, add)
{
    const prefix = config.prefixes.task;
    const code = readCode(config);

    for (const task of readBacklog(config).tasks.filter((one) => ["doing", "todo", "postponed"].includes(one.state))) {
        const merged = codeView(code.get(task.id)).mergedPull;

        if (merged) {
            add("note", "code", task.file, task.line, say("mergedOpen", { id: `${prefix}-${task.id}`, number: merged.number, day: merged.merged }));
        }
    }

    // A task and its GitHub issue that no longer agree: one closed, the other open.
    const issues = readIssues(config);

    for (const task of readBacklog(config).tasks.filter((one) => one.issue)) {
        const issue = issueOf(issues, task);
        const isClosed = task.state === "done" || task.state === "archived";

        if (issue?.state === "open" && isClosed) {
            add("note", "code", task.file, task.line, say("issueDoneOpen", { id: `${prefix}-${task.id}`, issue: task.issue }));
        } else if (issue?.state === "closed" && !isClosed) {
            add("note", "code", task.file, task.line, say("issueClosedTaskOpen", { id: `${prefix}-${task.id}`, issue: task.issue, day: issue.closed ?? "?" }));
        }
    }
}

/** Tasks past their due day, and tasks in progress for days that nobody holds. */
function checkTime(config, say, add)
{
    const prefix = config.prefixes.task;
    const { tasks } = readBacklog(config);
    const links = taskLinks(config, tasks);

    for (const task of tasks) {
        const { dueInfo, stale } = links.get(task.id);
        const id = `${prefix}-${task.id}`;

        if (dueInfo?.isLate) {
            add("warning", "time", task.file, task.line, say("overdue", { id, day: task.due }));
        }

        if (stale) {
            add("warning", "time", task.file, task.line, say("staleTask", { id, day: task.started }));
        }
    }
}

function checkPlan(config, say, add)
{
    const path = config.files.plan;

    if (!existsSync(path)) {
        return;
    }

    // A goal closed while some of its tasks are still open.
    const { tasks } = readBacklog(config);
    const prefix = config.prefixes.task;

    for (const goal of readGoals(config).filter((one) => one.closed)) {
        const open = tasks.filter((task) => task.goal === goal.name && ["doing", "todo", "postponed"].includes(task.state));

        if (open.length > 0) {
            add("warning", "plan", path, null, say("closedGoalOpen", { goal: goal.name, day: goal.closed, list: open.map((task) => `${prefix}-${task.id}`).join(", ") }));
        }
    }

    const text = read(path);
    const updated = planUpdated(text, config.words);
    const modified = today(statSync(path).mtime);

    if (updated && daysBetween(updated, modified) > config.limits.planDays) {
        const line = text.split(/\r?\n/).findIndex((one) => readable(config.words, "updated").some((word) => one.includes(`${word} ${updated}`))) + 1;
        add("warning", "plan", path, line || null, say("planStale", { updated: config.words.updated, date: updated, modified }));
    }
}

/** The points still to decide that carry a day older than the limit: `(…, 12 october)` in the project's months, or a YYYY-MM-DD. */
function checkOpen(config, say, add)
{
    const { open } = readDecisions(config);
    const now = today();

    for (const point of open) {
        const day = dayOf(point.text, config.words.months, now);

        if (!day) {
            continue;
        }

        const age = daysBetween(day, now);

        if (age > config.limits.proposalDays) {
            add("note", "open", config.files.decisions, point.line, say("oldProposal", { day, age }));
        }
    }
}

function checkMarkdown(config, say, add)
{
    for (const path of markdownFiles(config)) {
        const text = read(path);
        let blank = 0;
        let spaces = 0;

        if (text.includes("\r\n") && /[^\r]\n/.test(text)) {
            add("warning", "markdown", path, null, say("mixedEndings"));
        }

        for (const [index, line] of text.split(/\r?\n/).entries()) {
            blank = line.trim() === "" ? blank + 1 : 0;
            spaces += /[ \t]+$/.test(line) ? 1 : 0;

            if (blank === 2) {
                add("note", "markdown", path, index + 1, say("doubleBlank"));
            }

            for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
                checkLink(say, path, index + 1, match[1], add);
            }
        }

        if (spaces > 0) {
            add("note", "markdown", path, null, say("trailingSpaces", { count: spaces }));
        }
    }
}

function checkLink(say, file, line, target, add)
{
    if (/^[a-z]+:/i.test(target)) {
        return;
    }

    const [pathPart, anchor] = target.split("#");
    // A link is relative to where the file really is, past any link to its folder (.claude into a private repo).
    const linked = pathPart ? resolve(dirname(realpathSync.native(file)), safeDecode(pathPart)) : file;

    if (!existsSync(linked)) {
        add("error", "link", file, line, say("brokenLink", { target: pathPart }));
        return;
    }

    if (anchor && linked.endsWith(".md") && !headingSlugs(read(linked)).has(anchor.toLowerCase())) {
        add("warning", "link", file, line, say("badAnchor", { anchor, target: pathPart || say("thisFile") }));
    }
}

/** The docs of the docs folder that its index does not list: working notes, perhaps for the archive. */
function checkIndex(config, say, add)
{
    const index = config.files.index;

    if (!existsSync(index)) {
        return;
    }

    const text = read(index);
    const name = index.split("/").at(-1);

    for (const file of readdirSync(config.docs).filter((entry) => entry.endsWith(".md") && entry !== name)) {
        if (!text.includes(`(${file})`)) {
            add("note", "index", `${config.docs}/${file}`, null, say("notIndexed", { index: name, archive: config.archiveFolder }));
        }
    }
}

/** Every markdown document of the project carries its frontmatter: title, description, kind, the day it was created and the day it
 * last changed; `--fix` writes what is missing. */
function checkFrontmatter(config, say, add)
{
    for (const file of docFiles(config)) {
        const { data, body } = splitFrontmatter(read(file));
        const missing = ["title", "description", "type", "created", "updated"].filter((key) => !data[key]);

        if (missing.length > 0) {
            add("note", "frontmatter", file, 1, say(missing.length === 5 ? "frontmatterNone" : "frontmatterMissing", { list: missing.join(", ") }));
        } else if (data.type === "doc" && betterDescription(data.description, body)) {
            add("note", "frontmatter", file, 1, say("frontmatterWeak", { text: data.description }));
        }
    }
}

/** The documents whose frontmatter is missing or partial, written whole, the days from git (without `isWritten`, only found); their shown
 * paths. */
export function fixFrontmatter(config, isWritten = true)
{
    const changed = [];

    for (const file of docFiles(config)) {
        const text = read(file);
        const { data, body } = splitFrontmatter(text);
        const keys = ["title", "description", "type", "created", "updated"];

        if (keys.every((key) => data[key])) {
            // A description an older version made from a code line or a label is written again from the first paragraph; the days stay.
            const better = data.type === "doc" ? betterDescription(data.description, body) : "";

            if (better) {
                if (isWritten) {
                    writeFileSync(file, joinFrontmatter({ ...data, description: better }, body));
                }

                changed.push(shown(config, file));
            }

            continue;
        }

        const stamped = stampDoc(config, file, text);

        if (stamped !== text && Object.keys(splitFrontmatter(text).data).length < Object.keys(splitFrontmatter(stamped).data).length) {
            if (isWritten) {
                writeFileSync(file, stamped);
            }

            changed.push(shown(config, file));
        }
    }

    return changed;
}

/** The core files a project still keeps under their old Italian names: read where they are, renamed by `init.mjs rename`. */
function checkNames(config, say, add)
{
    for (const { from, to } of config.legacy ?? []) {
        add("note", "names", from, null, say("legacyName", { from: shown(config, from), to: shown(config, to) }));
    }

    for (const file of legacyFormat(config)) {
        add("note", "names", file, null, say("legacyFormat"));
    }
}

function checkWeight(config, say, add)
{
    for (const path of markdownFiles(config).filter((file) => file.startsWith(`${config.docs}/`))) {
        const tokens = Math.round(read(path).length / 3.5);

        if (tokens > config.limits.tokens) {
            add("warning", "weight", path, null, say("heavy", { thousands: Math.round(tokens / 1000) }));
        }
    }
}

function printReport(findings, say)
{
    for (const severity of ["error", "warning", "note"]) {
        const group = findings.filter((finding) => finding.severity === severity);

        if (group.length === 0) {
            continue;
        }

        console.log(`\n${say(`severity_${severity}`).toUpperCase()} (${group.length})`);

        for (const finding of group) {
            // An extension's findings go under its id.
            const kind = say(`kind_${finding.kind}`);
            console.log(`  [${kind === `kind_${finding.kind}` ? finding.kind : kind}] ${finding.file ?? ""}${finding.line ? `:${finding.line}` : ""}  ${finding.message}`);
        }
    }

    const errors = findings.filter((finding) => finding.severity === "error").length;
    console.log(`\n${say("summary", { errors, rest: findings.length - errors })}`);
}

/** The anchors of a file's headings, as GitHub and Obsidian make them. */
function headingSlugs(text)
{
    return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-")));
}

function subfolders(folder)
{
    return existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
}

function safeDecode(text)
{
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

function daysBetween(from, to)
{
    return Math.round((new Date(to) - new Date(from)) / 86400000);
}
