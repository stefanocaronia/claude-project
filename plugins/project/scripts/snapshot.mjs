// What the panel shows, as one JSON on stdout: the open tasks, the plan's goals with their counts, the decisions to take and the latest,
// the colleagues, the docs' health. node snapshot.mjs [--no-health]
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { effortKey } from "../lib/backlog.mjs";
import { proposalOf } from "../lib/decisions.mjs";
import { phaseStates, planPhases, planUpdated } from "../lib/plan.mjs";
import { configFile } from "../lib/config.mjs";
import { plainMarkdown } from "../lib/text.mjs";
import { codeView, freeIssues, issueOf } from "../lib/code.mjs";
import { readsAsInstruction } from "../lib/issues.mjs";
import { releaseState } from "../lib/release.mjs";
import { gitHubRepo } from "./github.mjs";
import { specsState } from "./specs.mjs";
import { check } from "./check.mjs";
import { readCode, readIssues, readLogin, readOwner } from "./code.mjs";
import { syncStateFile, syncSummary } from "./issues.mjs";
import { extensionChecks, extensionErrors, loadExtensions, panelLinks } from "./extensions.mjs";
import { colleagues, findRoot, git, isClosed, isMain, onPath, loadProject, openStates, profileOf, projectName, read, readBacklog, readDecisions, readContracts, readGoals, readReleases, runCli, shown, showsReleases, taskLinks, today, todoFiles } from "./project.mjs";

// The most a portrait may weigh in the panel's drawing, which the desktop drops past about 100 KB: Crew's small ones are under 2 KB.
const portraitLimit = 4096;

/** The panel's data for a project. */
export async function snapshot(config, say, withHealth = true)
{
    const { tasks, unread } = readBacklog(config);
    const team = colleagues(config).map((colleague) => ({ ...colleague, ...profileOf(config, colleague.id, colleague.name), ...portraitOf(config, colleague.id) }));
    const idOf = new Map(team.map((colleague) => [colleague.name, colleague.id]));
    const goals = readGoals(config);
    // A task merged into another is neither done nor open: it counts nowhere, as the page counts.
    const counted = tasks.filter((task) => task.done || openStates.includes(task.state));
    const { open } = readDecisions(config);
    const now = today();
    const extensions = await loadExtensions(config);
    const code = readCode(config);
    const findings = withHealth ? [...check(config, say, { code }), ...(await extensionChecks(config, say, extensions))] : null;
    const page = `http://localhost:${config.page.port}`;
    const links = taskLinks(config, tasks);
    const issues = readIssues(config);
    const login = readLogin(config);

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
        // The open GitHub issues no task does yet, to take into the backlog, each marked when its title reads like an instruction.
        issues: freeIssues(issues, tasks).map(({ number, title, url }) => ({ number, title, url, instruction: readsAsInstruction(title) })),
        // Where the issues are in sync with the backlog: the last sync, what failed, the tasks whose issue is gone.
        issuesSync: syncSummary(config),
        // The key documents, each opened through the project's page.
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
            issueInfo: issueOf(issues, task, login),
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
        // The files whose change makes the panel read the project again: the issues' sync state too, where they are in sync, and the
        // repo's tags, where a version tagged outside release.mjs shows.
        watch: [`${config.root}/${configFile}`, config.files.tasks, config.files.archive, config.files.plan, config.files.decisions, config.files.specs, config.files.notes, config.files.releases, ...todoFiles(config).map((one) => one.file), ...(config.github?.issues === "sync" ? [syncStateFile(config)].filter(Boolean) : []), ...tagFiles(config)],
        health: findings && { errors: severityCount(findings, "error"), warnings: severityCount(findings, "warning"), notes: severityCount(findings, "note") },
        // The core docs the scripts own, which the panel keeps from a direct read or write (lib/guard.mjs).
        guard: guardOf(config, unread),
    };
}

/** Where the project's repo keeps its tags: the folder of their refs, which changes when one is made or removed, and packed-refs, where
 * git packs them; the repo's common folder, which a worktree shares. None outside a repo. */
function tagFiles(config)
{
    const common = git(config.root, ["rev-parse", "--git-common-dir"]).trim();
    return common ? [`${resolve(config.root, common)}/refs/tags`, `${resolve(config.root, common)}/packed-refs`].map((path) => path.replaceAll("\\", "/")) : [];
}

/** The docs the scripts own, each { path, script, owned } relative to the root: the backlog and its archive, read and changed through
 * backlog.mjs alone, but while a line of them does not read, which only a hand can mend; the decisions and the specs, searched through
 * their scripts. */
function guardOf(config, unread)
{
    const broken = new Set(unread.map((line) => line.file));
    const relative = (path) => shown(config, path);
    return [
        ...[config.files.tasks, config.files.archive].filter((file) => !broken.has(file)).map((file) => ({ path: relative(file), script: "backlog", owned: true })),
        { path: relative(config.files.decisions), script: "decisions", owned: false },
        ...(existsSync(config.files.specs) ? [{ path: relative(config.files.specs), script: "specs", owned: false }] : []),
    ];
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

function severityCount(findings, severity)
{
    return findings.filter((finding) => finding.severity === severity).length;
}

/** The owner as the panel draws them: their picture inline when it is light enough, GitHub's being up to four times a portrait's
 * weight; null without one. */
function ownerOf(owner)
{
    if (!owner) {
        return null;
    }

    const portrait = owner.file && statSync(owner.file).size <= portraitLimit * 4 ? inline(owner.file) : undefined;
    return { name: owner.name, fullName: owner.fullName, ...(portrait ? { portrait } : {}) };
}

/** A JPEG picture inline, as the panel draws it. */
function inline(path)
{
    return `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`;
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
        inProgress: state.filter((spec) => spec.state === "doing").map((spec) => ({ id: spec.id, number: spec.number, text: plainMarkdown(spec.text), tasks: spec.tasks.filter((task) => !isClosed(task)).map((task) => task.id) })),
    };
}

/** The releases for the panel: the last ten, the newest first, how many there are in all (the page lists them all), and the work done
 * since the last one with the version it suggests. A version known only by its tag has no count of tasks. */
function releasesOf(config, tasks, goals)
{
    const releases = readReleases(config);

    // A project that does not release, a book, has no versions to show.
    if (!showsReleases(config, releases)) {
        return null;
    }

    const contracts = readContracts(config, releases);
    const { pending, suggested, raised } = releaseState(releases, tasks, goals, config.prefixes.task, contracts);
    return {
        list: [...releases].reverse().slice(0, 10).map(({ version, day, summary, tasks: listed, tagOnly }) => ({ version, day, summary, count: tagOnly ? null : listed.length })),
        total: releases.length,
        pending: pending.length,
        next: suggested.version,
        // The contracts gone up: a version waits for them alone.
        raised,
        // The contracts that went up or down since the last release, each «API 7 → 8».
        contracts: contracts.filter((contract) => contract.state === "raised" || contract.state === "lowered").map(({ name, before, current }) => ({ name, before, current })),
    };
}

/** A colleague's small portrait, as Crew keeps it, inline for the panel; nothing when there is none or it is too heavy. */
function portraitOf(config, id)
{
    const path = `${config.memory}/${id}/avatar-small.jpg`;

    if (!existsSync(path) || statSync(path).size > portraitLimit) {
        return {};
    }

    return { portrait: inline(path) };
}
