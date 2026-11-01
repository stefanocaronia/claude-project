// The code that cites the project's tasks: the commits of its repos and, where `gh` reaches GitHub, its pull requests; and its GitHub
// issues. What gh says is asked at most every few minutes, the answer kept in the system's temporary folder; without gh, or offline,
// there are no pull requests and no issues.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { citationsOf, parseIssues, parseLog, parsePulls, repoUrl } from "../lib/code.mjs";
import { git, projectRepos, ProjectError } from "./project.mjs";

// How many commits of each repo are read, the newest; how long a reading of gh holds.
const commitLimit = 3000;
const ghFor = 5 * 60_000;

/** By task number, the commits and the pull requests that cite it. */
export function readCode(config)
{
    const repos = projectRepos(config).map((repo) => ({
        name: repo.name,
        url: repoUrl(git(repo.path, ["remote", "get-url", "origin"])),
        commits: parseLog(git(repo.path, ["log", `-${commitLimit}`, "--format=%H%x1f%ad%x1f%s%x1f%b%x1e", "--date=short"])),
    }));
    return citationsOf(repos, parsePulls(ghCached(config, "pulls", ["pr", "list", "--state", "all", "--limit", "200", "--json", "number,title,body,state,url,mergedAt"])), config.prefixes.task, [basename(config.root)]);
}

/** The project's GitHub issues, open and closed, each { number, title, state, url, closed }; none without gh. */
export function readIssues(config)
{
    return parseIssues(ghCached(config, "issues", ["issue", "list", "--state", "all", "--limit", "300", "--json", "number,title,state,url,closedAt"]));
}

/** One issue as GitHub has it now, { number, title, state, url, closed }; a message that says why when gh cannot read it. */
export function readIssue(config, number)
{
    return parseIssues(`[${gh(config, ["issue", "view", String(number), "--json", "number,title,state,url,closedAt"])}]`)[0];
}

/** Closes an issue on GitHub with a comment, and forgets the last reading of the issues. */
export function closeIssue(config, number, comment)
{
    gh(config, ["issue", "close", String(number), "--comment", comment]);
    writeFileSync(cacheFile(config, "issues"), "");
}

/** The person of the project this machine's gh is signed in as, by their name or login, with their GitHub picture kept small in the
 * temporary folder: { name, fullName, file }, file null until it is downloaded; null without gh or when no person of the project is
 * them. Claude Code gives a plugin no picture of its own account: GitHub's is the one the person already shows. */
export async function readOwner(config)
{
    let user = null;

    try {
        user = JSON.parse(ghCached(config, "user", ["api", "user", "--jq", "{name: .name, login: .login, avatar: .avatar_url}"]));
    } catch {
        return null;
    }

    const first = String(user?.name ?? "").split(/\s+/)[0].toLowerCase();
    const name = config.people.find((person) => [first, String(user?.login ?? "").toLowerCase()].includes(person.toLowerCase()));

    if (!name || !user.avatar) {
        return null;
    }

    const file = join(tmpdir(), "claude-project", `avatar-${String(user.login).replace(/[^\w-]/g, "_")}.jpg`);

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

/** What gh answers, the last reading when it is recent; "[]" when gh is missing or fails, or PROJECT_NO_GH is set. */
export function ghCached(config, name, args)
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
    if (process.env.PROJECT_NO_GH) {
        throw new ProjectError("gh is turned off here (PROJECT_NO_GH).");
    }

    try {
        // The tests' stand-in for gh, a script run with node in its place.
        const [program, given] = process.env.PROJECT_FAKE_GH ? [process.execPath, [process.env.PROJECT_FAKE_GH, ...args]] : ["gh", args];
        return execFileSync(program, given, { cwd: config.root, encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
    } catch (error) {
        throw new ProjectError(`gh ${args.slice(0, 2).join(" ")} failed: ${String(error.stderr ?? error.message).trim().split("\n")[0]} Install gh and run gh auth login, in a repo whose remote is on GitHub.`);
    }
}

/** Forgets the last reading of gh by its name, "issues" or "pulls": the next one asks again. */
export function forgetGh(config, name)
{
    writeFileSync(cacheFile(config, name), "");
}

function cacheFile(config, name)
{
    const folder = join(tmpdir(), "claude-project");
    mkdirSync(folder, { recursive: true });
    return join(folder, `${name}-${config.root.replace(/[^\w-]/g, "_")}.json`);
}
