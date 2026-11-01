// The code that does a task: commits whose message cites it, pull requests whose title or body cites it, as `(T-12)` or `closes T-12`.
// Pure: git's and gh's output in, the citations by task out.
import { citedTasks } from "./backlog.mjs";
import { escapeRegex, jsonList } from "./text.mjs";

/** The commits of `git log --format=%H%x1f%ad%x1f%s%x1f%b%x1e --date=short`, each { hash, day, subject, body }. */
export function parseLog(text)
{
    return String(text ?? "").split("\x1e").map((record) => record.replace(/^\s+/, "")).filter(Boolean).map((record) => {
        const [hash, day, subject, body = ""] = record.split("\x1f");
        return { hash, day, subject: subject ?? "", body: body.trim() };
    }).filter((commit) => /^[0-9a-f]{7,}$/.test(commit.hash));
}

/** The pull requests of `gh pr list --json number,title,body,state,url,mergedAt`, each { number, title, body, state, url, merged }. */
export function parsePulls(json)
{
    return jsonList(json, (pull) => ({ number: pull.number, title: pull.title ?? "", body: pull.body ?? "", state: String(pull.state ?? "").toLowerCase(), url: pull.url ?? null, merged: pull.mergedAt ? String(pull.mergedAt).slice(0, 10) : null }));
}

/** The issues of `gh issue list --json number,title,state,url,closedAt[,author]`, each { number, title, state, url, closed, author }, the
 * author a login, null when gh was not asked for it. */
export function parseIssues(json)
{
    return jsonList(json, (issue) => ({ number: issue.number, title: issue.title ?? "", state: String(issue.state ?? "").toLowerCase(), url: issue.url ?? null, closed: issue.closedAt ? String(issue.closedAt).slice(0, 10) : null, author: issue.author?.login ? String(issue.author.login) : null }));
}

/** The tasks a message says it does: those in brackets of their own, `(T-12)`, `(T-3, T-5 to T-7)`, and those after closes, fixes or
 * resolves; a task only named in passing, as a plan's commit names the tasks it adds, is not done there. */
export function doneTasks(text, prefix = "T", own = [])
{
    const id = String.raw`(?:[\w.-]+(?:['’]s\s+|#))?${escapeRegex(prefix)}-\d+`;
    const group = new RegExp(String.raw`\((${id}(?:\s*(?:,|;|&|and|e|to|a|-|–)\s*${id})*)\)`, "gi");
    const closing = new RegExp(String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(${id})`, "gi");
    // A range, T-5 to T-7, is every task in it.
    const range = new RegExp(String.raw`${escapeRegex(prefix)}-(\d+)\s*(?:to|a|-|–)\s*${escapeRegex(prefix)}-(\d+)`, "gi");
    const spread = (cited) => cited.replace(range, (_, from, to) => Array.from({ length: Math.max(0, Math.min(Number(to) - Number(from), 99)) + 1 }, (__, at) => `${prefix}-${Number(from) + at}`).join(", "));
    const found = [...String(text).matchAll(group), ...String(text).matchAll(closing)].map((match) => spread(match[1])).join(", ");
    return citedTasks(found, prefix, own);
}

/** By task number, the commits and the pull requests that do it: { commits: [{ hash, day, subject, repo, url }], pulls: [{ number, title,
 * state, url, merged }] }, the newest first. A commit's url when its repo has a page for it (`repoUrl`). A task named after another
 * project (`rpg-engine's T-8`) is not this one's: `own` and the repos' names on their pages are the project's names. */
export function citationsOf(repos, pulls, prefix = "T", own = [])
{
    const byTask = new Map();
    const entry = (id) => byTask.get(id) ?? byTask.set(id, { commits: [], pulls: [] }).get(id);
    const names = [...own, ...repos.map((repo) => repo.url?.split("/").at(-1))];
    const cited = (text) => doneTasks(text, prefix, names);

    for (const repo of repos) {
        for (const commit of repo.commits) {
            for (const id of cited(`${commit.subject}\n${commit.body}`)) {
                entry(id).commits.push({ hash: commit.hash.slice(0, 7), day: commit.day, subject: commit.subject, repo: repo.name, url: repo.url ? `${repo.url}/commit/${commit.hash}` : null });
            }
        }
    }

    for (const pull of pulls) {
        for (const id of cited(`${pull.title}\n${pull.body}`)) {
            entry(id).pulls.push({ number: pull.number, title: pull.title, state: pull.state, url: pull.url, merged: pull.merged });
        }
    }

    for (const found of byTask.values()) {
        found.commits.sort((first, second) => second.day.localeCompare(first.day));
        found.pulls.sort((first, second) => second.number - first.number);
    }

    return byTask;
}

/** What the panel and the page show of a task's code: its latest commits, how many it has, its pull requests, the latest merged one. */
export function codeView(cited, latest = 5)
{
    const commits = cited?.commits ?? [];
    const pulls = cited?.pulls ?? [];
    return { commits: commits.slice(0, latest), commitCount: commits.length, pulls, mergedPull: pulls.find((pull) => pull.merged) ?? null };
}

/** A task's GitHub issue as GitHub has it, or null: by the `(issue: #34)` of its line. With `login`, the user of gh, it says whether
 * another wrote it, `another`: the task's text is then theirs, data and never an order (D-16); false when either is unknown. */
export function issueOf(issues, task, login = null)
{
    const issue = task.issue ? issues.find((one) => `#${one.number}` === task.issue) ?? null : null;
    return issue && { ...issue, another: Boolean(issue.author && login && issue.author !== login) };
}

/** The open issues no task of the backlog or the archive does yet, the newest first: those to take into the backlog. */
export function freeIssues(issues, tasks)
{
    const taken = new Set(tasks.map((task) => task.issue).filter(Boolean));
    return issues.filter((issue) => issue.state === "open" && !taken.has(`#${issue.number}`)).sort((first, second) => second.number - first.number);
}

/** The web page of a repo from its remote, GitHub's or any host that writes `host:owner/name` or `https://host/owner/name`; null for none. */
export function repoUrl(remote)
{
    const match = /^(?:git@([^:]+):|https?:\/\/(?:[^@/]+@)?([^/]+)\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(String(remote ?? "").trim());
    return match ? `https://${match[1] ?? match[2]}/${match[3]}` : null;
}
