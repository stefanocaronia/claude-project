// The GitHub issues in sync with the backlog, where the project turns it on (`github: { issues: sync }` in .claude/project.yaml, which
// stands for the user's yes to act on GitHub; D-13). The open issues assigned to the user of gh come in as tasks, with those assigned
// to nobody where they are the repo's only collaborator (`unassigned: take | leave` fixes it); a task closed closes its issue, done with
// a comment naming its commits, archived as not planned; an issue closed closes its task; an opening again goes across too. A new task
// never becomes an issue. The page syncs every few minutes, the start of a session once, the backlog's changes after them; the last
// state in sync is kept in the repo's git folder, so that a change never bounces back.
//   node issues.mjs sync [--dry] [--quiet]   (--dry says what it would do, and does nothing)
//   node issues.mjs status [--json]          (the last sync: when, what it did, what failed)
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { formatLine, moveTasks, nextId, taskErrors } from "../lib/backlog.mjs";
import { labelFor, labelsOf, parseSyncIssues, planFields, planSync, priorityOfLabels, taskFields, taskSide, typeOfLabels } from "../lib/issues.mjs";
import { forgetGh, gh, readCode } from "./code.mjs";
import { assignees, git, isMain, loadProject, ProjectError, readBacklog, readGoals, runCli, today, withBacklogLock, writeBacklog } from "./project.mjs";

// A sync left running longer than this died: the next one goes ahead.
const syncStale = 120_000;

if (isMain(import.meta.url)) {
    runCli(() => {
        const [command, ...rest] = process.argv.slice(2);
        const { config, say } = loadProject();

        if (command === "sync") {
            const { lines } = syncIssues(config, say, { dry: rest.includes("--dry") });
            rest.includes("--quiet") || console.log(lines.join("\n"));
        } else if (command === "status") {
            const state = readState(config);
            console.log(rest.includes("--json") ? JSON.stringify(state.last ?? null) : state.last ? [say("issuesLast", { at: localTime(state.last.at) }), ...state.last.lines].join("\n") : say("issuesNever"));
        } else {
            throw new ProjectError(say("issuesUsage"));
        }
    });
}

/** One sync of the issues with the backlog: { lines, changed }, the lines saying what it did, in the project's language. Nothing where the
 * project has not turned it on, without gh, or while another sync runs. */
export function syncIssues(config, say, { dry = false } = {})
{
    if (config.github?.issues !== "sync") {
        return { lines: [say("issuesOff")], changed: false };
    }

    if (process.env.PROJECT_NO_GH) {
        return { lines: [], changed: false };
    }

    const folder = gitFolder(config);
    const lock = folder && join(folder, "claude-project-issues.lock");

    if (!folder || !takeLock(lock)) {
        return { lines: folder ? [say("issuesBusy")] : [say("issuesNoRepo")], changed: false };
    }

    try {
        return sync(config, say, dry);
    } finally {
        unlinkSync(lock);
    }
}

function sync(config, say, dry)
{
    const prefix = config.prefixes.task;
    const state = readState(config);
    let me;
    let issues;

    try {
        me = gh(config, ["api", "user", "--jq", ".login"]).trim();
        issues = parseSyncIssues(gh(config, ["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,title,state,stateReason,assignees,author,labels,milestone,url,closedAt"]));
    } catch (error) {
        const lines = [say("issuesUnread", { error: error.message })];
        dry || writeState(config, { ...state, last: { at: new Date().toISOString(), lines, error: error.message } });
        return { lines, changed: false };
    }

    const { tasks } = readBacklog(config);
    // Those assigned to nobody come in where the configuration says, or where the user is the repo's only collaborator: asked of GitHub
    // only when one such is there to take.
    const linked = new Set(tasks.map((task) => task.issue).filter(Boolean));
    const waiting = issues.some((issue) => issue.state === "open" && issue.assignees.length === 0 && !linked.has(`#${issue.number}`) && !state.base[String(issue.number)]);
    const takeUnassigned = config.github.unassigned === "take" || (config.github.unassigned === "auto" && waiting && isOnlyCollaborator(config, me));
    const plan = planSync({ issues, tasks, base: state.base, me, takeUnassigned });
    const accounts = accountsOf(config, me);
    const fields = fieldPlans(config, issues, tasks, plan, state.base, me, accounts);
    const pushes = fields.filter((one) => Object.keys(one.push).length > 0);
    const takes = fields.filter((one) => one.taken.length > 0);
    const id = (task) => `${prefix}-${task}`;
    const issueOf = (number) => `#${number}`;
    const named = (keys) => keys.map((key) => say(`issuesField_${key}`)).join(", ");
    // The open tasks whose issue is gone: deleted, or moved to another repo.
    const numbers = new Set(issues.map((issue) => issueOf(issue.number)));
    const missing = tasks.filter((task) => task.issue && taskSide(task) === "open" && !numbers.has(task.issue)).map((task) => ({ id: id(task.id), issue: task.issue }));

    if (dry) {
        const lines = [
            ...plan.incoming.map((issue) => say("issuesWouldCome", { issue: issueOf(issue.number), text: issue.title })),
            ...plan.assign.map((number) => say("issuesWouldAssign", { issue: issueOf(number), me })),
            ...plan.closeIssues.map((one) => say(`issuesWouldClose_${one.reason === "completed" ? "done" : "archived"}`, { issue: issueOf(one.number), id: id(one.id) })),
            ...plan.reopenIssues.map((one) => say("issuesWouldReopen", { issue: issueOf(one.number), id: id(one.id) })),
            ...plan.closeTasks.map((one) => say(`issuesWouldCloseTask_${one.state}`, { issue: issueOf(one.number), id: id(one.id) })),
            ...plan.reopenTasks.map((one) => say("issuesWouldReopenTask", { issue: issueOf(one.number), id: id(one.id) })),
            ...pushes.map((one) => say("issuesWouldPush", { issue: issueOf(one.issue.number), id: id(one.task.id), list: named(Object.keys(one.push)) })),
            ...takes.map((one) => say("issuesWouldTake", { issue: issueOf(one.issue.number), id: id(one.task.id), list: named(one.taken) })),
        ];
        return { lines: lines.length > 0 ? lines : [say("issuesInSync")], changed: false };
    }

    const lines = [];
    const failed = [];
    const project = config.name ? ` (${config.name})` : "";
    // GitHub first: what does not go through is told, and its issue keeps its last state, to be tried again at the next sync.
    const onGitHub = (number, args, said) => {
        try {
            gh(config, typeof args === "function" ? args() : args);
            lines.push(said);
            return true;
        } catch (error) {
            failed.push(say("issuesFailed", { issue: issueOf(number), error: error.message }));
            plan.base[String(number)] = state.base[String(number)];
            return false;
        }
    };

    for (const number of plan.assign) {
        onGitHub(number, ["issue", "edit", String(number), "--add-assignee", "@me"], say("issuesAssigned", { issue: issueOf(number), me }));
    }

    const code = plan.closeIssues.length > 0 ? readCode(config) : new Map();

    for (const one of plan.closeIssues) {
        const commits = code.get(one.id)?.commits ?? [];
        const comment = one.reason === "completed"
            ? say("issueComment", { id: id(one.id), project, commits: commits.length > 0 ? say("issueCommits", { list: commits.slice(0, 10).map((commit) => commit.hash).join(", ") }) : "" }).trim()
            : say("issueArchivedComment", { id: id(one.id), project });
        onGitHub(one.number, ["issue", "close", String(one.number), "--reason", one.reason, "--comment", comment], say(`issuesClosed_${one.reason === "completed" ? "done" : "archived"}`, { issue: issueOf(one.number), id: id(one.id) }));
    }

    for (const one of plan.reopenIssues) {
        onGitHub(one.number, ["issue", "reopen", String(one.number), "--comment", say("issueReopenComment", { id: id(one.id), project })], say("issuesReopened", { issue: issueOf(one.number), id: id(one.id) }));
    }

    // The fields the backlog changed, written on the issue in one edit, the labels and the milestone it needs made first; agreed only
    // once GitHub took them.
    const edit = editor(config);

    for (const one of fields) {
        one.isAgreed = !pushes.includes(one) || onGitHub(one.issue.number, () => edit(one.issue, one.push), say("issuesPushed", { issue: issueOf(one.issue.number), id: id(one.task.id), list: named(Object.keys(one.push)) }));
    }

    // Then the backlog, under its lock, read again: a change made meanwhile stays.
    const isChanged = plan.incoming.length + plan.closeTasks.length + plan.reopenTasks.length + takes.length > 0;

    if (isChanged) {
        withBacklogLock(config, () => {
            let all = readBacklog(config).tasks;
            const day = today();

            for (const one of plan.closeTasks) {
                all = one.state === "done" ? moveTasks(all, [one.id], "done", day).tasks : all.map((task) => (task.id === one.id ? { ...task, state: "archived", archived: day } : task));
                lines.push(say(`issuesClosedTask_${one.state}`, { issue: issueOf(one.number), id: id(one.id) }));
            }

            for (const one of plan.reopenTasks) {
                all = moveTasks(all, [one.id], "todo", day).tasks;
                lines.push(say("issuesReopenedTask", { issue: issueOf(one.number), id: id(one.id) }));
            }

            for (const one of takes) {
                all = all.map((task) => (task.id === one.task.id ? { ...task, ...one.change } : task));
                lines.push(say("issuesTook", { issue: issueOf(one.issue.number), id: id(one.task.id), list: named(one.taken) }));
            }

            for (const issue of plan.incoming) {
                // An issue another command took meanwhile is not taken twice.
                if (all.some((task) => task.issue === issueOf(issue.number))) {
                    continue;
                }

                const task = incomingTask(config, issue, all);
                const errors = taskErrors(task, { words: config.words, people: assignees(config), goals: readGoals(config).map((goal) => goal.name), types: Object.keys(config.types), fields: config.fields, prefix, decisionPrefix: config.prefixes.decision, specPrefix: config.prefixes.spec, say });

                if (errors.length > 0) {
                    failed.push(say("issuesNotTaken", { issue: issueOf(issue.number), error: errors.join("; ") }));
                    continue;
                }

                all = [...all, task];
                // Its fields as the task holds them: what it could not take of the issue stays on GitHub as it is, untouched.
                plan.base[String(issue.number)] = { issue: "open", task: "open", id: task.id, fields: taskFields(task, { me, loginOf: accounts.loginOf, noGoal: config.words.noGoal }) };
                lines.push(say("issuesCame", { issue: issueOf(issue.number), id: id(task.id), line: formatLine(task, config.words, prefix) }));
            }

            writeBacklog(config, all);
        });
    }

    for (const one of fields.filter((plan) => plan.isAgreed)) {
        plan.base[String(one.issue.number)] = { ...plan.base[String(one.issue.number)], fields: one.agreed };
    }

    forgetGh(config, "issues");
    const said = lines.length + failed.length > 0 ? [...lines, ...failed] : [say("issuesInSync")];
    writeState(config, { base: plan.base, last: { at: new Date().toISOString(), lines: said, error: failed[0] ?? null, missing } });
    return { lines: said, changed: isChanged };
}

/** The fields to align of each task and its issue both open, and staying so in this sync. */
function fieldPlans(config, issues, tasks, plan, base, me, { loginOf, personOf })
{
    const moving = new Set([...plan.closeIssues, ...plan.reopenIssues, ...plan.closeTasks, ...plan.reopenTasks].map((one) => one.number));
    const goals = readGoals(config).filter((goal) => !goal.closed);
    const goalOf = (milestone) => goals.find((goal) => goal.name.toLowerCase() === milestone.toLowerCase())?.name ?? null;
    return issues.filter((issue) => issue.state === "open" && !moving.has(issue.number)).flatMap((issue) => {
        const task = tasks.find((one) => one.issue === `#${issue.number}` && taskSide(one) === "open");
        return task ? [{ issue, task, ...planFields({ task, issue, before: base[String(issue.number)]?.fields, me, loginOf, personOf, goalOf, noGoal: config.words.noGoal, types: config.types }) }] : [];
    });
}

/** The people of the project and their GitHub logins, the configuration's `logins:`. An issue of the user of gh is the coordinator's
 * here, whoever does a new task (Claude): the user takes it when they want, and its issue stays theirs, as every task of a person
 * with no login of their own. */
function accountsOf(config, me)
{
    const people = assignees(config);
    const logins = config.github.logins ?? {};
    const loginOf = (person) => logins[person] ?? null;
    return { loginOf, personOf: (login) => (login === me ? config.people[0] : people.find((person) => loginOf(person) === login) ?? null) };
}

/** The gh edit that writes an issue's fields: its title, the labels of its type and its priority in place of the old ones, its assignee,
 * its milestone. A label or a milestone the repo does not have yet is made first. */
function editor(config)
{
    let labels = null;
    let milestones = null;
    const repoLabels = () => (labels ??= JSON.parse(gh(config, ["label", "list", "--limit", "500", "--json", "name"])).map((one) => one.name));
    const label = (name) => {
        if (!repoLabels().some((one) => one.toLowerCase() === name.toLowerCase())) {
            gh(config, ["label", "create", name]);
            labels.push(name);
        }

        return name;
    };
    const milestone = (title) => {
        milestones ??= JSON.parse(gh(config, ["api", "repos/{owner}/{repo}/milestones?state=all&per_page=100", "--jq", "[.[].title]"]));

        if (!milestones.includes(title)) {
            gh(config, ["api", "repos/{owner}/{repo}/milestones", "-f", `title=${title}`, "--jq", ".title"]);
            milestones.push(title);
        }

        return title;
    };

    return (issue, push) => {
        const args = ["issue", "edit", String(issue.number)];

        if ("title" in push) {
            args.push("--title", push.title);
        }

        for (const kind of ["type", "priority"].filter((one) => one in push)) {
            const wanted = push[kind] === null ? null : labelFor(kind, push[kind], repoLabels(), config.types);
            labelsOf(kind, issue.labels, config.types).filter((one) => one !== wanted).forEach((one) => args.push("--remove-label", one));
            wanted && !issue.labels.includes(wanted) && args.push("--add-label", label(wanted));
        }

        if ("assignee" in push) {
            push.assignee && !issue.assignees.includes(push.assignee) && args.push("--add-assignee", push.assignee);
            issue.assignees.filter((login) => login !== push.assignee).forEach((login) => args.push("--remove-assignee", login));
        }

        if ("milestone" in push) {
            push.milestone ? args.push("--milestone", milestone(push.milestone)) : args.push("--remove-milestone");
        }

        return args;
    };
}

/** The task an issue comes in as: its title the text, its labels the type and the priority, its milestone the goal when the plan has it
 * open, its author who created it when they are a person of the project. */
function incomingTask(config, issue, tasks)
{
    const people = assignees(config);
    const author = issue.author ? people.find((person) => [issue.author.login, issue.author.name.split(/\s+/)[0]].some((name) => name && name.toLowerCase() === person.toLowerCase())) ?? null : null;
    const goal = readGoals(config).find((one) => !one.closed && issue.milestone && one.name.toLowerCase() === issue.milestone.toLowerCase())?.name ?? config.words.noGoal;
    return {
        id: nextId(tasks),
        priority: priorityOfLabels(issue.labels),
        effort: config.words.efforts.medium,
        // The coordinator's, as a new task: the user takes it when they want.
        to: config.people[0],
        created: today(),
        goal,
        text: issue.title.replaceAll(" · ", " - ").trim(),
        after: [],
        see: [],
        parent: null,
        issue: `#${issue.number}`,
        due: null,
        type: typeOfLabels(issue.labels, config.types),
        by: author,
        fields: {},
        done: null,
        archived: null,
        state: "todo",
    };
}

/** Whether the user of gh is the repo's only collaborator; false when GitHub does not say (no right to list them). */
function isOnlyCollaborator(config, me)
{
    try {
        const logins = JSON.parse(gh(config, ["api", "repos/{owner}/{repo}/collaborators", "--jq", "[.[].login]"]));
        return Array.isArray(logins) && logins.length === 1 && logins[0] === me;
    } catch {
        return false;
    }
}

/** The repo's git folder, shared by its worktrees: where the sync keeps its state, never committed; null outside git. */
function gitFolder(config)
{
    const folder = git(config.root, ["rev-parse", "--git-common-dir"]).trim();
    return folder ? (isAbsolute(folder) ? folder : join(config.root, folder)) : null;
}

/** The file of the sync's state, in the repo's git folder, never committed; null outside a git repo. */
export function syncStateFile(config)
{
    const folder = gitFolder(config);
    return folder && join(folder, "claude-project-issues.json");
}

/** The sync's state: { base, last }, base the issues as they were at the last sync, by number. */
export function readState(config)
{
    const file = syncStateFile(config);

    try {
        const state = JSON.parse(readFileSync(file, "utf8"));
        return { base: state.base ?? {}, last: state.last ?? null };
    } catch {
        return { base: {}, last: null };
    }
}

/** What the check, the panel and the page say of the sync: { at, error, missing }, `at` this machine's time of the last sync or null
 * before the first, `missing` the open tasks whose issue is no longer on GitHub; null where the issues are not in sync. */
export function syncSummary(config)
{
    if (config.github?.issues !== "sync") {
        return null;
    }

    const { last } = readState(config);
    return { at: last?.at ? localTime(last.at) : null, error: last?.error ?? null, missing: last?.missing ?? [] };
}

function writeState(config, state)
{
    const file = syncStateFile(config);
    file && writeFileSync(file, JSON.stringify(state, null, 1));
}

/** A moment as this machine's clock says it, YYYY-MM-DD HH:MM. */
function localTime(iso)
{
    const moment = new Date(iso);
    const two = (value) => String(value).padStart(2, "0");
    return `${moment.getFullYear()}-${two(moment.getMonth() + 1)}-${two(moment.getDate())} ${two(moment.getHours())}:${two(moment.getMinutes())}`;
}

function takeLock(lock)
{
    try {
        closeSync(openSync(lock, "wx"));
        return true;
    } catch {
        if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > syncStale) {
            unlinkSync(lock);
            return takeLock(lock);
        }

        return false;
    }
}
