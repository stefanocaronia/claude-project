// The code that cites a task: commits whose message names it, pull requests whose title or body names it. Pure: git's and gh's output
// in, the citations by task out.
import { citedTasks } from "./backlog.mjs";

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
    try {
        const list = JSON.parse(json || "[]");
        return Array.isArray(list) ? list.map((pull) => ({ number: pull.number, title: pull.title ?? "", body: pull.body ?? "", state: String(pull.state ?? "").toLowerCase(), url: pull.url ?? null, merged: pull.mergedAt ? String(pull.mergedAt).slice(0, 10) : null })) : [];
    } catch {
        return [];
    }
}

/** The issues of `gh issue list --json number,title,state,url,closedAt`, each { number, title, state, url, closed }. */
export function parseIssues(json)
{
    try {
        const list = JSON.parse(json || "[]");
        return Array.isArray(list) ? list.map((issue) => ({ number: issue.number, title: issue.title ?? "", state: String(issue.state ?? "").toLowerCase(), url: issue.url ?? null, closed: issue.closedAt ? String(issue.closedAt).slice(0, 10) : null })) : [];
    } catch {
        return [];
    }
}

/** By task number, the commits and the pull requests that cite it: { commits: [{ hash, day, subject, repo, url }], pulls: [{ number, title,
 * state, url, merged }] }, the newest first. A commit's url when its repo has a page for it (`repoUrl`). */
export function citationsOf(repos, pulls, prefix = "T")
{
    const byTask = new Map();
    const entry = (id) => byTask.get(id) ?? byTask.set(id, { commits: [], pulls: [] }).get(id);

    for (const repo of repos) {
        for (const commit of repo.commits) {
            for (const id of citedTasks(`${commit.subject}\n${commit.body}`, prefix)) {
                entry(id).commits.push({ hash: commit.hash.slice(0, 7), day: commit.day, subject: commit.subject, repo: repo.name, url: repo.url ? `${repo.url}/commit/${commit.hash}` : null });
            }
        }
    }

    for (const pull of pulls) {
        for (const id of citedTasks(`${pull.title}\n${pull.body}`, prefix)) {
            entry(id).pulls.push({ number: pull.number, title: pull.title, state: pull.state, url: pull.url, merged: pull.merged });
        }
    }

    for (const cited of byTask.values()) {
        cited.commits.sort((first, second) => second.day.localeCompare(first.day));
        cited.pulls.sort((first, second) => second.number - first.number);
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

/** A task's GitHub issue as GitHub has it, or null: by the `(issue: #34)` of its line. */
export function issueOf(issues, task)
{
    return task.issue ? issues.find((issue) => `#${issue.number}` === task.issue) ?? null : null;
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
