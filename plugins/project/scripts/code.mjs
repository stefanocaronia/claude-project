// The code that cites the project's tasks: the commits of its repos and, where `gh` reaches GitHub, its pull requests; and its GitHub
// issues. What gh says is asked at most every few minutes, the answer kept in the system's temporary folder; without gh, or offline,
// there are no pull requests and no issues.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { citationsOf, freePulls, parseIssues, parseLog, parsePulls, repoUrl } from "../lib/code.mjs";
import { parseSyncIssues } from "../lib/issues.mjs";
import { sayer } from "../lib/messages.mjs";
import { fail, git, projectRepos, tempFolder } from "./project.mjs";

// How many commits of each repo are read, the newest; how long a reading of gh holds.
const commitLimit = 3000;
const ghFor = 5 * 60_000;
// What gh is asked of the pull requests: the code that cites a task, and the open ones that cite none.
const pullArgs = ["pr", "list", "--state", "all", "--limit", "200", "--json", "number,title,body,state,url,mergedAt,author"];

/** By task number, the commits and the pull requests that cite it; the commits alone with pulls false, without asking gh. */
export function readCode(config, { pulls = true } = {})
{
    const repos = projectRepos(config).map((repo) => ({
        name: repo.name,
        url: repoUrl(git(repo.path, ["remote", "get-url", "origin"])),
        commits: parseLog(git(repo.path, ["log", `-${commitLimit}`, "--format=%H%x1f%ad%x1f%s%x1f%b%x1e", "--date=short"])),
    }));
    return citationsOf(repos, pulls ? readPulls(config) : [], config.prefixes.task, [basename(config.root)]);
}

/** The project's pull requests, open and closed, as parsePulls reads them; none without gh. */
export function readPulls(config)
{
    return parsePulls(ghCached(config, "pulls", pullArgs));
}

/** The open pull requests no task does yet, to take into the backlog or close (D-17): newest first. */
export function readFreePulls(config)
{
    return freePulls(readPulls(config), takenPulls(config), config.prefixes.task, [basename(config.root)]);
}

/** The numbers of the pull requests taken into the backlog, from the Origin line of their tasks' notes. */
export function takenPulls(config)
{
    const folder = config.files.notes;
    const names = folder && existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".md")) : [];
    return names.map((name) => readFileSync(join(folder, name), "utf8").match(/^Origin: pull #(\d+)/m)?.[1]).filter(Boolean).map(Number);
}

/** One pull request as GitHub has it now: { number, title, url, author }; a message that says why when gh cannot read it. */
export function readPull(config, number)
{
    const pull = JSON.parse(gh(config, ["pr", "view", String(number), "--json", "number,title,url,author,state"]));
    return { number: pull.number, title: String(pull.title ?? ""), url: pull.url ?? null, author: pull.author?.login ?? null };
}

/** Closes a pull request on GitHub, and forgets the last reading of the pull requests. */
export function closePull(config, number)
{
    gh(config, ["pr", "close", String(number)]);
    forgetGh(config, "pulls");
}

// What gh is asked of the user it is signed in as.
const userArgs = ["api", "user", "--jq", "{name: .name, login: .login, avatar: .avatar_url}"];

/** The project's GitHub issues, open and closed, each { number, title, state, url, closed, author }; none without gh. */
export function readIssues(config)
{
    return parseIssues(ghCached(config, "issues", ["issue", "list", "--state", "all", "--limit", "300", "--json", "number,title,state,url,closedAt,author"]));
}

/** Who of the project's people the user of gh is: the one whose login the configuration names, `github: { logins }`, else the one named
 * as their login or their first name on GitHub, the coordinator never; null when none is, or without gh. */
export function personOfUser(config)
{
    const user = readUser(config);
    const login = String(user?.login ?? "").toLowerCase();

    if (!login) {
        return null;
    }

    const first = String(user.name ?? "").split(/\s+/)[0].toLowerCase();
    const named = Object.entries(config.github?.logins ?? {}).find(([, one]) => one.toLowerCase() === login)?.[0]?.toLowerCase();
    const people = config.people.slice(1);
    return people.find((person) => person.toLowerCase() === named) ?? (named ? null : people.find((person) => [first, login].includes(person.toLowerCase()))) ?? null;
}

/** The logins of the repo's collaborators on GitHub; none without gh, or without the right to list them. */
export function readCollaborators(config)
{
    try {
        const logins = JSON.parse(ghCached(config, "collaborators", ["api", "repos/{owner}/{repo}/collaborators", "--jq", "[.[].login]"]));
        return Array.isArray(logins) ? logins.map(String) : [];
    } catch {
        return [];
    }
}

/** The login this machine's gh is signed in as, from the reading readOwner makes; null without gh. */
export function readLogin(config)
{
    return readUser(config)?.login ?? null;
}

/** The login gh is signed in as, asked now, for a choice that cannot rest on a reading kept a few minutes; a ProjectError when gh cannot
 * say. */
export function ghLogin(config)
{
    return gh(config, ["api", "user", "--jq", ".login"]).trim();
}

/** One issue as GitHub has it now, as the sync reads it (parseSyncIssues): its labels, milestone and author fill the task made from it; a
 * message that says why when gh cannot read it. */
export function readIssue(config, number)
{
    return parseSyncIssues(`[${gh(config, ["issue", "view", String(number), "--json", "number,title,state,stateReason,assignees,author,labels,milestone,url,closedAt"])}]`)[0];
}

/** Closes an issue on GitHub with a comment, and forgets the last reading of the issues. */
export function closeIssue(config, number, comment)
{
    gh(config, ["issue", "close", String(number), "--comment", comment]);
    forgetGh(config, "issues");
}

/** The comment that closes the issue of a task done: the task, the project, and the commits that cite it, the latest ten. */
export function doneComment(config, say, id, code = readCode(config))
{
    const hashes = (code.get(id)?.commits ?? []).slice(0, 10).map((commit) => commit.hash);
    return say("issueComment", { id: `${config.prefixes.task}-${id}`, project: config.name ? ` (${config.name})` : "", commits: hashes.length > 0 ? say("issueCommits", { list: hashes.join(", ") }) : "" }).trim();
}

/** The person of the project this machine's gh is signed in as, by their name or login, with their GitHub picture kept small in the
 * temporary folder: { name, fullName, file }, file null until it is downloaded; null without gh or when no person of the project is
 * them. Claude Code gives a plugin no picture of its own account: GitHub's is the one the person already shows. */
export async function readOwner(config)
{
    const user = readUser(config);
    // The one working here, as their own settings say; else the person the user of gh is.
    const name = config.me && config.people.includes(config.me) ? config.me : personOfUser(config);

    if (!name || !user.avatar) {
        return null;
    }

    const file = join(tempFolder, `avatar-${String(user.login).replace(/[^\w-]/g, "_")}.jpg`);

    if (!existsSync(file)) {
        try {
            const answer = await fetch(`${user.avatar}${user.avatar.includes("?") ? "&" : "?"}s=64`, { signal: AbortSignal.timeout(5000) });

            if (answer.ok) {
                writeFileSync(file, Buffer.from(await answer.arrayBuffer()));
            }
        } catch {
            // offline: the initials, and the picture another time
        }
    }

    return { name, fullName: user.name || name, file: existsSync(file) ? file : null };
}

/** The user gh is signed in as, { name, login, avatar }, from a reading kept a few minutes; null without gh. */
function readUser(config)
{
    try {
        return JSON.parse(ghCached(config, "user", userArgs));
    } catch {
        return null;
    }
}

/** What gh answers, the last reading when it is recent; "[]" when gh is missing or fails, or PROJECT_NO_GH is set. */
function ghCached(config, name, args)
{
    if (process.env.PROJECT_NO_GH) {
        return "[]";
    }

    const cache = cacheFile(config, name);

    if (existsSync(cache) && readFileSync(cache, "utf8") !== "" && Date.now() - statSync(cache).mtimeMs < ghFor) {
        return readFileSync(cache, "utf8");
    }

    let answer = "[]";

    try {
        answer = gh(config, args);
    } catch {
        // no gh, no GitHub remote, offline: nothing, asked again later
    }

    writeFileSync(cache, answer);
    return answer;
}

/** A gh command in the project's folder, its output; a ProjectError that says how to fix it when gh fails. */
export function gh(config, args)
{
    const say = sayer(config.language);

    if (process.env.PROJECT_NO_GH) {
        fail(say("ghOff"));
    }

    try {
        // The tests' stand-in for gh, a script run with node in its place.
        const [program, given] = process.env.PROJECT_FAKE_GH ? [process.execPath, [process.env.PROJECT_FAKE_GH, ...args]] : ["gh", args];
        return execFileSync(program, given, { cwd: config.root, encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
    } catch (error) {
        return fail(say("ghFailed", { command: args.slice(0, 2).join(" "), error: String(error.stderr ?? error.message).trim().split("\n")[0].replace(/[.\s]+$/, "") }));
    }
}

/** Forgets the last reading of gh by its name, "issues" or "pulls": the next one asks again. */
export function forgetGh(config, name)
{
    writeFileSync(cacheFile(config, name), "");
}

/** Where the last reading of gh by its name is kept, for this project. */
function cacheFile(config, name)
{
    mkdirSync(tempFolder, { recursive: true });
    return join(tempFolder, `${name}-${config.root.replace(/[^\w-]/g, "_")}.json`);
}
