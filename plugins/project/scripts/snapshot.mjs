// What the panel shows, as one JSON on stdout: the open tasks, the plan's goals with their counts, the decisions to take and the latest,
// the colleagues, the docs' health. node snapshot.mjs [--no-health]
import { existsSync, readFileSync, statSync } from "node:fs";
import { effortKey } from "../lib/backlog.mjs";
import { proposalOf } from "../lib/decisions.mjs";
import { phaseStates, planPhases, planUpdated } from "../lib/plan.mjs";
import { configFile } from "../lib/config.mjs";
import { plainMarkdown } from "../lib/text.mjs";
import { codeView, freeIssues, issueOf } from "../lib/code.mjs";
import { releaseState } from "../lib/release.mjs";
import { gitHubRepo } from "./github.mjs";
import { specsState } from "./specs.mjs";
import { check } from "./check.mjs";
import { readCode, readIssues, readOwner } from "./code.mjs";
import { extensionChecks, extensionErrors, loadExtensions, panelLinks } from "./extensions.mjs";
import { colleagues, findRoot, git, isMain, onPath, loadProject, profileOf, projectName, read, readBacklog, readDecisions, readGoals, readReleases, runCli, taskLinks, today, todoFiles } from "./project.mjs";

const openStates = ["doing", "todo", "postponed"];
// The most a portrait may weigh in the panel's drawing, which the desktop drops past about 100 KB: Crew's small ones are under 2 KB.
const portraitLimit = 4096;

/** The panel's data for a project. */
export async function snapshot(config, say, withHealth = true)
{
    const { tasks } = readBacklog(config);
    const team = colleagues(config).map((colleague) => ({ ...colleague, ...profileOf(config, colleague.id, colleague.name), ...portraitOf(config, colleague.id) }));
    const idOf = new Map(team.map((colleague) => [colleague.name, colleague.id]));
    const goals = readGoals(config);
    // A task merged into another is neither done nor open: it counts nowhere, as the page counts.
    const counted = tasks.filter((task) => task.done || openStates.includes(task.state));
    const { open } = readDecisions(config);
    const now = today();
    const extensions = await loadExtensions(config);
    const findings = withHealth ? [...check(config, say), ...(await extensionChecks(config, say, extensions))] : null;
    const page = `http://localhost:${config.page.port}`;
    const links = taskLinks(config, tasks);
    const code = readCode(config);
    const issues = readIssues(config);

    return {
        project: projectName(config),
        language: config.language,
        words: { states: config.labels.states, priorities: config.labels.priorities, noGoal: config.words.noGoal },
        // The task types by key, each with its name in the project's language.
        types: config.types,
        prefixes: config.prefixes,
        today: now,
        page,
        links: await panelLinks(config, say, extensions, page),
        problems: extensionErrors(extensions),
        people: config.people,
        // The project's own fields on a task, by key, with their names.
        fields: config.fields,
        // The key documents, each opened through the project's page.
        // The open GitHub issues no task does yet, to take into the backlog.
        issues: freeIssues(issues, tasks).map(({ number, title, url }) => ({ number, title, url })),
        documents: config.documents.map((document, index) => ({ name: document.name, href: `${page}/#documents/${index}`, exists: existsSync(document.path) })),
        colleagues: team,
        // The person this machine's gh is signed in as, with their GitHub picture inline: on their tasks and on every decision.
        owner: ownerOf(await readOwner(config)),
        // Whether git and gh are here, and the project's repo on GitHub: the panel offers the github skill while one is missing.
        github: { tools: onPath("git") && onPath("gh"), repo: gitHubRepo(git(config.root, ["remote", "get-url", "origin"]).trim()) },
        // Each with its links: what it waits for, still open, and the chain to do first; what points to it; its note.
        tasks: tasks.filter((task) => openStates.includes(task.state)).map(({ file, line, archived, done, ...task }) => ({
            ...task,
            ...links.get(task.id),
            text: plainMarkdown(task.text),
            effortKey: effortKey(task.effort, config.words) ?? "none",
            colleague: idOf.get(task.to) ?? null,
            noteHref: links.get(task.id).note ? `${page}/note/${task.id}` : null,
            ...codeView(code.get(task.id)),
            issueInfo: issueOf(issues, task),
        })),
        // The last versions, the newest first, and how many tasks wait for the next one.
        releases: releasesOf(config, tasks, goals),
        // The specifications, where the project keeps them: how far they are covered, and those in progress with their tasks.
        specs: specsOf(config),
        // The parts already closed of a large task still open, shown checked under it.
        doneParts: tasks.filter((task) => task.parent && !openStates.includes(task.state) && tasks.some((one) => openStates.includes(one.state) && `${config.prefixes.task}-${one.id}` === task.parent))
            .map(({ id, parent, to, type, text, done, archived }) => ({ id, parent, to, type, text: plainMarkdown(text), done: done ?? archived ?? null })),
        plan: {
            updated: planUpdated(read(config.files.plan), config.words),
            // The phases of the plan, each closed once its goals all are.
            phases: phaseStates(planPhases(read(config.files.plan)), goals).map(({ number, name, goals: count, closedGoals, isClosed }) => ({ number, name, goals: count, closedGoals, isClosed })),
            goals: goals.map((goal) => {
                const own = counted.filter((task) => task.goal === goal.name);
                return { ...goal, done: own.filter((task) => task.done).length, total: own.length, isDoing: own.some((task) => task.state === "doing") };
            }),
        },
        decisions: {
            open: open.map((point) => {
                const proposal = proposalOf(point.text, config.words, now);
                return { ...proposal, text: plainMarkdown(proposal.text), line: point.line, whole: point.text };
            }),
        },
        // The files whose change makes the panel read the project again.
        watch: [`${config.root}/${configFile}`, config.files.tasks, config.files.archive, config.files.plan, config.files.decisions, config.files.specs, config.files.notes, config.files.releases, ...todoFiles(config).map((one) => one.file)],
        health: findings && { errors: count(findings, "error"), warnings: count(findings, "warning"), notes: count(findings, "note") },
    };
}

if (isMain(import.meta.url)) {
    await runCli(async () => {
        // No project from here up: the panel says so, by this exit code.
        if (findRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd()) === null && !process.env.PROJECT_CONFIG) {
            process.exitCode = 3;
            return;
        }

        const { config, say } = loadProject();
        console.log(JSON.stringify(await snapshot(config, say, !process.argv.includes("--no-health"))));
    });
}

function count(findings, severity)
{
    return findings.filter((finding) => finding.severity === severity).length;
}

/** The owner as the panel draws them: their picture inline when it is light enough; null without one. */
function ownerOf(owner)
{
    if (!owner) {
        return null;
    }

    const portrait = owner.file && statSync(owner.file).size <= portraitLimit * 4 ? `data:image/jpeg;base64,${readFileSync(owner.file).toString("base64")}` : undefined;
    return { name: owner.name, fullName: owner.fullName, ...(portrait ? { portrait } : {}) };
}

/** The specifications for the panel: the counts, and those an open task is doing, each with its tasks; null where the project keeps
 * none. */
function specsOf(config)
{
    if (!existsSync(config.files.specs)) {
        return null;
    }

    const state = specsState(config).filter((spec) => spec.state !== "dropped");
    const count = (kind) => state.filter((spec) => spec.state === kind).length;
    return {
        total: state.length,
        done: count("done"),
        doing: count("doing"),
        open: count("open"),
        inProgress: state.filter((spec) => spec.state === "doing").map((spec) => ({ id: spec.id, number: spec.number, text: plainMarkdown(spec.text), tasks: spec.tasks.filter((task) => !["done", "archived"].includes(task.state)).map((task) => task.id) })),
    };
}

/** The releases for the panel: the last ten, the newest first, how many there are in all (the page lists them all), and the work done
 * since the last one with the version it suggests. A version known only by its tag has no count of tasks. */
function releasesOf(config, tasks, goals)
{
    const releases = readReleases(config);
    const { pending, suggested } = releaseState(releases, tasks, goals, config.prefixes.task);
    return {
        list: [...releases].reverse().slice(0, 10).map(({ version, day, summary, tasks: listed, tagOnly }) => ({ version, day, summary, count: tagOnly ? null : listed.length })),
        total: releases.length,
        pending: pending.length,
        next: suggested.version,
    };
}

/** A colleague's small portrait, as Crew keeps it, inline for the panel; nothing when there is none or it is too heavy. */
function portraitOf(config, id)
{
    const path = `${config.memory}/${id}/avatar-small.jpg`;

    if (!existsSync(path) || statSync(path).size > portraitLimit) {
        return {};
    }

    return { portrait: `data:image/jpeg;base64,${readFileSync(path).toString("base64")}` };
}
