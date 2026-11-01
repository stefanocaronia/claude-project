// Reads the project into one object for the page: the plan by phases and goals, the decisions and their days, the tasks of the backlog
// and of the colleagues' todos, the docs, the health, the commits by day, and what each extension adds.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { effortKey } from "../lib/backlog.mjs";
import { splitFrontmatter } from "../lib/frontmatter.mjs";
import { numbering, proposalOf } from "../lib/decisions.mjs";
import { phaseStates, planPhases, planUpdated } from "../lib/plan.mjs";
import { escapeRegex } from "../lib/text.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { codeView, freeIssues, issueOf } from "../lib/code.mjs";
import { readsAsInstruction } from "../lib/issues.mjs";
import { decisionLinks } from "../lib/links.mjs";
import { check } from "../scripts/check.mjs";
import { readCode, readIssues, readLogin, readOwner } from "../scripts/code.mjs";
import { syncSummary } from "../scripts/issues.mjs";
import { specsState } from "../scripts/specs.mjs";
import { context, extensionChecks } from "../scripts/extensions.mjs";
import { releaseState } from "../lib/release.mjs";
import { readablePattern } from "../lib/words.mjs";
import { colleagues, git, profileOf, projectName, read, readBacklog, readContracts, readReleases, readDecisions, showsReleases, projectRepos, readGoals, readHolds, realPath, shown, taskLinks, today, todoFiles } from "../scripts/project.mjs";

const openStates = ["doing", "todo", "postponed"];
const lastDecisions = 8;
// How many days of done tasks the board shows in its last column.
const boardDays = 14;

/** Everything the page shows, read fresh from the files; each extension's data under its id. */
export async function collect(config, say, extensions = [])
{
    const plan = readPlan(config);
    const extra = {};

    for (const extension of extensions) {
        try {
            extra[extension.id] = extension.error ? { error: extension.error } : extension.collect ? await extension.collect(context(config, say)) : null;
        } catch (error) {
            extra[extension.id] = { error: String(error?.message ?? error) };
        }
    }

    return {
        generated: new Date().toISOString(),
        project: projectName(config),
        language: config.language,
        words: { states: config.labels.states, priorities: config.labels.priorities, noGoal: config.words.noGoal },
        prefixes: config.prefixes,
        types: config.types,
        fields: config.fields,
        docs: shown(config, config.docs),
        files: Object.fromEntries(Object.entries(config.files).filter(([, path]) => path).map(([key, path]) => [key, path.split("/").at(-1)])),
        plan,
        decisions: readDecisionsData(config),
        documents: readDocuments(config),
        keyDocuments: config.documents.map((document, index) => ({ name: document.name, path: shown(config, document.path), href: `/document/${index}`, exists: existsSync(document.path), description: existsSync(document.path) ? splitFrontmatter(read(document.path)).data.description ?? "" : "" })),
        inbox: readInbox(config),
        people: config.people,
        colleagues: readColleagues(config),
        owner: await ownerOf(config),
        tasks: readTasks(config),
        board: readBoard(config),
        releases: readReleasesData(config),
        specs: readSpecsData(config),
        issues: freeIssues(readIssues(config), readBacklog(config).tasks).map(({ number, title, url }) => ({ number, title, url, instruction: readsAsInstruction(title) })),
        issuesSync: syncSummary(config),
        boardDays,
        holds: readHolds(config),
        health: [...check(config, say), ...(await extensionChecks(config, say, extensions))],
        activity: activity(config),
        extensions: extensions.map((extension) => ({ id: extension.id, script: extension.script ? `/extension/${extension.id}/page.js` : null })),
        extra,
    };
}

function readPlan(config)
{
    const text = read(config.files.plan);
    const goals = readGoals(config);
    const tasks = readBacklog(config).tasks.filter((task) => task.done || openStates.includes(task.state));
    const prefix = config.prefixes.task;
    const titled = (goal) => (goal.phase === null || goal.isUnplanned ? goal.name : `${goal.name} (${config.labels.phase} ${goal.phase})`);
    // A goal the plan no longer holds, an archived task's, counts in the phase its name starts with: «Phase 1 — Core».
    const phaseIn = (name) => Number(new RegExp(`^(?:${readablePattern(config.words, "phase")}) (\\d+) — `, "i").exec(name)?.[1] ?? Number.NaN);
    const unplanned = [...new Set(tasks.map((task) => task.goal).filter((goal) => !goals.some((one) => one.name === goal)))].map((name) => ({ name, phase: Number.isNaN(phaseIn(name)) ? null : phaseIn(name), isUnplanned: true }));
    const sections = [...goals, ...unplanned].map((goal) => {
        const own = tasks.filter((task) => task.goal === goal.name);
        const items = own.map((task) => ({ id: task.id, text: clean(`${prefix}-${task.id} · ${task.text}`), priority: task.priority, created: task.created, done: task.done !== null, state: task.state, to: task.to }));
        return { title: titled(goal), name: goal.name, phase: goal.phase, description: clean(goal.description ?? ""), closed: goal.closed ?? null, isUnplanned: goal.isUnplanned === true, items, done: items.filter((item) => item.done).length, total: items.length };
    }).filter((section) => section.total > 0);
    const phases = planPhases(text).map((phase) => {
        const own = sections.filter((section) => section.phase === phase.number);
        const isClosed = phaseStates([phase], goals)[0].isClosed;
        return { ...phase, isClosed, done: own.reduce((sum, section) => sum + section.done, 0), total: own.reduce((sum, section) => sum + section.total, 0) };
    });
    const finishedByDay = {};

    for (const task of tasks.filter((one) => one.done)) {
        finishedByDay[task.done] = (finishedByDay[task.done] ?? 0) + 1;
    }

    // The page shows the plan's goals, and the tasks without one while some are open: the goals of archived tasks that the plan no
    // longer has are history, counted in their phases only.
    const shown = sections.filter((section) => !section.isUnplanned || (section.name === config.words.noGoal && section.items.some((item) => !item.done)));
    return {
        updated: planUpdated(text, config.words),
        phases,
        sections: shown,
        // The goals a task can take: the plan's open ones, in its order.
        openGoals: goals.filter((goal) => !goal.closed).map((goal) => goal.name),
        done: shown.reduce((sum, section) => sum + section.done, 0),
        total: shown.reduce((sum, section) => sum + section.total, 0),
        finishedByDay,
    };
}

function readDecisionsData(config)
{
    const { decided, open } = readDecisions(config);
    const firstSeen = decisionDays(config);
    const byDay = {};

    for (const row of decided) {
        const day = firstSeen.get(row.number);

        if (day) {
            byDay[day] = (byDay[day] ?? 0) + 1;
        }
    }

    // How many decisions name each person who decided them, «(Stefano, 12 october)».
    const byPerson = Object.fromEntries(config.people.map((person) => [person, decided.filter((row) => new RegExp(`\\(${escapeRegex(person)}(?![\\p{L}\\p{N}])`, "u").test(row.text)).length]));
    const { twice, missing } = numbering(decided);
    // The tasks each decision is tied to, both ways.
    const tasksOf = decisionLinks(readBacklog(config).tasks, decided, config.prefixes).byDecision;
    return {
        count: decided.length,
        last: decided.slice(-lastDecisions).reverse().map((row) => ({ number: row.number, text: clean(row.text) })),
        open: open.map((point) => clean(point.text)),
        // Every decision, the newest first, with the day it was taken; the points to decide with their priority and day, for the lists.
        all: decided.slice().reverse().map((row) => ({ number: row.number, text: clean(row.text), why: clean(row.why), day: firstSeen.get(row.number) ?? null, tasks: tasksOf.get(`${config.prefixes.decision}-${row.number}`) ?? [] })),
        proposals: open.map((point) => {
            const proposal = proposalOf(point.text, config.words, today());
            return { ...proposal, text: clean(proposal.text), whole: point.text, line: point.line };
        }),
        byDay,
        byPerson,
        duplicates: twice,
        missing,
    };
}

/** The person this machine's gh is signed in as: their name, and where the page serves their GitHub picture; null without one. */
async function ownerOf(config)
{
    const owner = await readOwner(config);
    return owner ? { name: owner.name, fullName: owner.fullName, href: owner.file ? "/avatar" : null } : null;
}

/** The backlog for the board and the lists: every task not archived, and those archived within the board's days, with who holds it. */
function readBoard(config)
{
    const since = today(new Date(Date.now() - boardDays * 86_400_000));
    const ids = new Map(colleagues(config).map((colleague) => [colleague.name, colleague.id]));
    const { tasks } = readBacklog(config);
    const planned = new Set(readGoals(config).map((goal) => goal.name));
    const links = taskLinks(config, tasks);
    const code = readCode(config);
    const issues = readIssues(config);
    const login = readLogin(config);
    const released = new Map(readReleases(config).flatMap((release) => release.tasks.map((id) => [id, release.version])));
    // Each with its links, as the panel has them: after, see, blockedBy, chain, waitedBy, seenFrom; its note's path, and where the page serves it.
    return tasks
        // An archived task whose goal the plan no longer has is history: the board's rows are the plan's goals.
        .filter((task) => task.state !== null && (task.state !== "archived" || ((task.done ?? task.archived ?? "") >= since && (task.goal === config.words.noGoal || planned.has(task.goal)))))
        .map(({ file, line, ...task }) => ({
            ...task,
            ...links.get(task.id),
            text: clean(task.text),
            effortKey: effortKey(task.effort, config.words) ?? "none",
            colleague: ids.get(task.to) ?? null,
            noteHref: links.get(task.id).note ? `/note/${task.id}` : null,
            ...codeView(code.get(task.id)),
            issueInfo: issueOf(issues, task, login),
            // The version whose notes list it, when one does.
            release: released.get(task.id) ?? null,
        }));
}

/** The specifications for the page, where the project keeps them: each with its coverage, tasks, decisions and code, in the file's
 * order, and the counts; null without them. */
function readSpecsData(config)
{
    if (!existsSync(config.files.specs)) {
        return null;
    }

    const list = specsState(config).map(({ number, id, text, section, group, state, tasks, decisions, files }) => ({ number, id, text, section, group, state, tasks: tasks.map((task) => ({ ...task, text: clean(task.text) })), decisions, files }));
    const count = (state) => list.filter((spec) => spec.state === state).length;
    return { list, counts: { total: list.length - count("dropped"), done: count("done"), doing: count("doing"), open: count("open") } };
}

/** The releases for the page, the newest first, each with its notes; the work done since the last one, the version it suggests and
 * what makes one due; the contracts that moved. Null where the project shows no releases. */
function readReleasesData(config)
{
    const releases = readReleases(config);

    if (!showsReleases(config, releases)) {
        return null;
    }

    const contracts = readContracts(config, releases);
    const state = releaseState(releases, readBacklog(config).tasks, readGoals(config), config.prefixes.task, contracts);
    return {
        list: [...releases].reverse().map(({ version, day, summary, tasks, text, tagOnly, source }) => ({ version, day, summary, count: tasks.length, text, tagOnly: Boolean(tagOnly), source })),
        pending: state.pending.map((task) => ({ id: task.id, text: clean(task.text), type: task.type, done: task.done })),
        counts: state.counts,
        suggested: state.suggested,
        closedGoals: state.closedGoals,
        urgent: state.urgent,
        raised: state.raised,
        contracts: contracts.filter((contract) => contract.state !== "same"),
    };
}

/** The day each decision number first appears in the decisions' file, from the history of the repo that holds it. */
function decisionDays(config)
{
    const days = new Map();
    const file = realPath(config.files.decisions);
    let day = null;

    for (const line of git(dirname(file), ["log", "--reverse", "--format=@@%ad", "--date=short", "-U0", "--", file]).split("\n")) {
        if (/^@@\d{4}-/.test(line)) {
            day = line.slice(2, 12);
            continue;
        }

        const match = /^\+\| (\d+) \|/.exec(line);

        if (match && day && !days.has(Number(match[1]))) {
            days.set(Number(match[1]), day);
        }
    }

    return days;
}

function readDocuments(config)
{
    if (!existsSync(config.docs)) {
        return [];
    }

    // Each with its frontmatter's title and description, and the address the page reads it at.
    return readdirSync(config.docs).filter((name) => name.endsWith(".md")).map((name) => {
        const path = `${config.docs}/${name}`;
        const { data, body } = splitFrontmatter(read(path));
        return { name, title: data.title ?? "", description: data.description ?? "", href: `/doc/${encodeURIComponent(name)}`, lines: body.split("\n").length, words: body.split(/\s+/).filter(Boolean).length, modified: statSync(path).mtime.toISOString() };
    }).sort((first, second) => second.modified.localeCompare(first.modified));
}

/** The idea inbox the configuration names (files.inbox), with how many entries wait in it; null without one. */
function readInbox(config)
{
    if (!config.files.inbox) {
        return null;
    }

    return { name: config.files.inbox.split("/").at(-1), count: [...read(config.files.inbox).matchAll(/^- .+$/gm)].length };
}

function readColleagues(config)
{
    return colleagues(config).map(({ id, name }) => {
        const profile = profileOf(config, id, name);
        const todo = read(`${config.memory}/${id}/todo.md`);
        return {
            id,
            name: profile.fullName,
            short: name,
            role: profile.role,
            color: profile.color,
            open: (todo.match(/^\s*- \[ \]/gm) ?? []).length,
            done: (todo.match(/^\s*- \[x\]/gm) ?? []).length,
            hasPortrait: existsSync(`${config.memory}/${id}/avatar-small.jpg`),
        };
    });
}

/** Every open task, by who holds it: the backlog's, by its assignee, and those of the colleagues' todos. */
function readTasks(config)
{
    const ids = colleagues(config).map((colleague) => colleague.id);
    const ownerOf = (to) => ids.find((id) => id.split("-")[0] === to.toLowerCase()) ?? to;
    const prefix = config.prefixes.task;
    const backlog = readBacklog(config).tasks.filter((task) => openStates.includes(task.state))
        .map((task) => ({ owner: ownerOf(task.to), priority: task.priority, created: task.created, text: clean(`${prefix}-${task.id} · ${task.text}`).slice(0, 300), state: task.state, effort: task.effort }));
    const todos = todoFiles(config).flatMap(({ id, file }) => read(file).split(/\r?\n/).map(parseTodo).filter((task) => task && !task.done).map((task) => ({ owner: id, priority: task.priority, created: task.created, text: clean(task.text).slice(0, 300) })));
    return [...backlog, ...todos];
}

/** The commits of each repo by day: the configured ones, else the project's and, when the docs are a repo of their own, theirs. */
function activity(config)
{
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const repos = projectRepos(config);
    return repos.map((repo) => ({ name: repo.name, days: commitsPerDay(repo.path, since) }));
}

function commitsPerDay(root, since)
{
    const counts = {};

    for (const day of git(root, ["log", `--since=${since}`, "--format=%ad", "--date=short"]).split("\n").filter(Boolean)) {
        counts[day] = (counts[day] ?? 0) + 1;
    }

    return counts;
}

/** Markdown to plain text, enough for a label or a tooltip. */
function clean(text)
{
    return text.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
}
