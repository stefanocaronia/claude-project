// Reads the project into one object for the page: the plan by phases and goals, the decisions and their days, the tasks of the backlog
// and of the colleagues' todos, the docs, the health, the commits by day, and what each extension adds.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { numbering } from "../lib/decisions.mjs";
import { planPhases, planUpdated } from "../lib/plan.mjs";
import { escapeRegex } from "../lib/text.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { check } from "../scripts/check.mjs";
import { context } from "../scripts/extensions.mjs";
import { colleagues, git, profileOf, projectName, read, readBacklog, readDecisions, readGoals, realPath, shown, todoFiles } from "../scripts/project.mjs";

const openStates = ["doing", "todo", "postponed"];
const lastDecisions = 8;

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
        words: { states: config.words.states, priorities: config.words.priorities, noGoal: config.words.noGoal },
        prefixes: config.prefixes,
        docs: shown(config, config.docs),
        files: Object.fromEntries(Object.entries(config.files).filter(([, path]) => path).map(([key, path]) => [key, path.split("/").at(-1)])),
        plan,
        decisions: readDecisionsData(config),
        documents: readDocuments(config),
        inbox: readInbox(config),
        colleagues: readColleagues(config),
        tasks: readTasks(config),
        health: check(config, say),
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
    const titled = (goal) => (goal.phase === null || goal.isUnplanned ? goal.name : `${goal.name} (${config.words.phase} ${goal.phase})`);
    // A goal the plan no longer holds, an archived task's, counts in the phase its name starts with: «Phase 1 — Core».
    const phaseIn = (name) => Number(new RegExp(`^${escapeRegex(config.words.phase)} (\\d+) — `, "i").exec(name)?.[1] ?? Number.NaN);
    const unplanned = [...new Set(tasks.map((task) => task.goal).filter((goal) => !goals.some((one) => one.name === goal)))].map((name) => ({ name, phase: Number.isNaN(phaseIn(name)) ? null : phaseIn(name), isUnplanned: true }));
    const sections = [...goals, ...unplanned].map((goal) => {
        const own = tasks.filter((task) => task.goal === goal.name);
        const items = own.map((task) => ({ id: task.id, text: clean(`${prefix}-${task.id} · ${task.text}`), priority: task.priority, created: task.created, done: task.done !== null, state: task.state, to: task.to }));
        return { title: titled(goal), name: goal.name, phase: goal.phase, items, done: items.filter((item) => item.done).length, total: items.length };
    }).filter((section) => section.total > 0);
    const phases = planPhases(text).map((phase) => {
        const own = sections.filter((section) => section.phase === phase.number);
        return { ...phase, done: own.reduce((sum, section) => sum + section.done, 0), total: own.reduce((sum, section) => sum + section.total, 0) };
    });
    const finishedByDay = {};

    for (const task of tasks.filter((one) => one.done)) {
        finishedByDay[task.done] = (finishedByDay[task.done] ?? 0) + 1;
    }

    return {
        updated: planUpdated(text, config.words),
        phases,
        sections,
        done: sections.reduce((sum, section) => sum + section.done, 0),
        total: sections.reduce((sum, section) => sum + section.total, 0),
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
    return {
        count: decided.length,
        last: decided.slice(-lastDecisions).reverse().map((row) => ({ number: row.number, text: clean(row.text) })),
        open: open.map((point) => clean(point.text)),
        byDay,
        byPerson,
        duplicates: twice,
        missing,
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

    return readdirSync(config.docs).filter((name) => name.endsWith(".md")).map((name) => {
        const path = `${config.docs}/${name}`;
        const text = read(path);
        return { name, lines: text.split("\n").length, words: text.split(/\s+/).filter(Boolean).length, modified: statSync(path).mtime.toISOString() };
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
    const repos = config.repos ?? defaultRepos(config);
    return repos.map((repo) => ({ name: repo.name, days: commitsPerDay(repo.path, since) }));
}

function defaultRepos(config)
{
    const top = (folder) => git(folder, ["rev-parse", "--show-toplevel"]).trim().toLowerCase();
    const project = top(config.root);
    const docs = existsSync(config.docs) ? top(realPath(config.docs)) : "";
    return [{ name: config.words.repoProject, path: config.root }, ...(docs && docs !== project ? [{ name: config.words.repoDocs, path: realPath(config.docs) }] : [])];
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
