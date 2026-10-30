// What the panel shows, as one JSON on stdout: the open tasks, the plan's goals with their counts, the decisions to take and the latest,
// the colleagues, the docs' health. node snapshot.mjs [--no-health]
import { existsSync, readFileSync, statSync } from "node:fs";
import { effortKey } from "../lib/backlog.mjs";
import { proposalOf } from "../lib/decisions.mjs";
import { planUpdated } from "../lib/plan.mjs";
import { configFile } from "../lib/config.mjs";
import { plainMarkdown } from "../lib/text.mjs";
import { check } from "./check.mjs";
import { extensionErrors, loadExtensions, panelLinks } from "./extensions.mjs";
import { colleagues, findRoot, isMain, loadProject, profileOf, projectName, read, readBacklog, readDecisions, readGoals, runCli, today, todoFiles } from "./project.mjs";

const openStates = ["doing", "todo", "postponed"];
const recentDecisions = 3;
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
    const { decided, open } = readDecisions(config);
    const now = today();
    const findings = withHealth ? check(config, say) : null;
    const page = `http://localhost:${config.page.port}`;
    const extensions = await loadExtensions(config);

    return {
        project: projectName(config),
        language: config.language,
        words: { states: config.words.states, priorities: config.words.priorities, noGoal: config.words.noGoal },
        prefixes: config.prefixes,
        today: now,
        page,
        links: await panelLinks(config, say, extensions, page),
        problems: extensionErrors(extensions),
        people: config.people,
        colleagues: team,
        tasks: tasks.filter((task) => openStates.includes(task.state)).map(({ file, line, archived, done, ...task }) => ({ ...task, text: plainMarkdown(task.text), effortKey: effortKey(task.effort, config.words) ?? "none", colleague: idOf.get(task.to) ?? null })),
        plan: {
            updated: planUpdated(read(config.files.plan), config.words),
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
            recent: decided.slice().sort((first, second) => second.number - first.number).slice(0, recentDecisions).map((decision) => ({ number: decision.number, text: plainMarkdown(decision.text), why: plainMarkdown(decision.why) })),
        },
        // The files whose change makes the panel read the project again.
        watch: [`${config.root}/${configFile}`, config.files.tasks, config.files.archive, config.files.plan, config.files.decisions, ...todoFiles(config).map((one) => one.file)],
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

/** A colleague's small portrait, as Crew keeps it, inline for the panel; nothing when there is none or it is too heavy. */
function portraitOf(config, id)
{
    const path = `${config.memory}/${id}/avatar-small.jpg`;

    if (!existsSync(path) || statSync(path).size > portraitLimit) {
        return {};
    }

    return { portrait: `data:image/jpeg;base64,${readFileSync(path).toString("base64")}` };
}
