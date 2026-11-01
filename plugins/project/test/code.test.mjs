// The code that cites a task: git's and gh's output read, the citations by task, and show and the check on a small project in a git repo.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { citationsOf, codeView, freeIssues, issueOf, parseIssues, parseLog, parsePulls, repoUrl } from "../lib/code.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

test("git's log and gh's pull requests read, and the code that cites each task, the newest first", () => {
    const log = "aaaaaaa1111\x1f2026-10-29\x1fThe dice (T-1)\x1f\x1e\nbbbbbbb2222\x1f2026-10-30\x1fThe log\x1fFor T-1 and T-2.\x1e\n";
    const commits = parseLog(log);
    assert.deepEqual(commits.map((commit) => [commit.hash, commit.day, commit.subject, commit.body]), [["aaaaaaa1111", "2026-10-29", "The dice (T-1)", ""], ["bbbbbbb2222", "2026-10-30", "The log", "For T-1 and T-2."]]);
    const pulls = parsePulls(JSON.stringify([{ number: 4, title: "Dice", body: "Closes T-1", state: "MERGED", url: "https://github.com/a/b/pull/4", mergedAt: "2026-10-30T10:00:00Z" }, { number: 5, title: "T-2 log", body: "", state: "OPEN", url: null, mergedAt: null }]));
    assert.deepEqual(pulls.map((pull) => [pull.number, pull.state, pull.merged]), [[4, "merged", "2026-10-30"], [5, "open", null]]);
    assert.deepEqual(parsePulls("not json"), []);

    const cited = citationsOf([{ name: "project", url: "https://github.com/a/b", commits: [...commits, { hash: "ccccccc3333", day: "2026-10-31", subject: "As in rpg-engine's T-1, and my-b's T-2", body: "" }] }], pulls, "T", ["my-b"]);
    assert.deepEqual(cited.get(1).commits.map((commit) => [commit.hash, commit.url]), [["bbbbbbb", "https://github.com/a/b/commit/bbbbbbb2222"], ["aaaaaaa", "https://github.com/a/b/commit/aaaaaaa1111"]]);
    assert.deepEqual(cited.get(2).pulls.map((pull) => pull.number), [5]);
    assert.deepEqual(cited.get(2).commits.map((commit) => commit.hash), ["ccccccc", "bbbbbbb"]);
    const view = codeView(cited.get(1), 1);
    assert.deepEqual([view.commits.length, view.commitCount, view.mergedPull?.number], [1, 2, 4]);
    assert.deepEqual(codeView(undefined), { commits: [], commitCount: 0, pulls: [], mergedPull: null });

    assert.equal(repoUrl("git@github.com:stefanocaronia/claude-project.git"), "https://github.com/stefanocaronia/claude-project");
    assert.equal(repoUrl("https://user@gitlab.com/team/app.git\n"), "https://gitlab.com/team/app");
    assert.equal(repoUrl(""), null);
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-code-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice\n- T-2 · P2 · medium · Claude · 2026-10-01 · Core · the log\n\n## Postponed\n\n## Done\n");
    const gitIn = (...args) => execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { stdio: "ignore" });
    gitIn("init", "-q");
    gitIn("add", "-A");
    gitIn("commit", "-q", "-m", "The dice, T-1");
    // The pull requests as gh gave them a moment ago: the reading kept in the temporary folder, so that gh is not asked.
    const cache = join(tmpdir(), "claude-project", `pulls-${root.replaceAll("\\", "/").replace(/[^\w-]/g, "_")}.json`);
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, JSON.stringify([{ number: 7, title: "The dice", body: "Does T-1.", state: "MERGED", url: "https://example.com/pull/7", mergedAt: "2026-10-30T09:00:00Z" }]));
    writeFileSync(cache.replace(/pulls-([^\/]+)$/, "issues-$1"), JSON.stringify([{ number: 40, title: "Login fails", state: "OPEN", url: "https://example.com/issues/40", closedAt: null }, { number: 41, title: "Export", state: "OPEN", url: null, closedAt: null }, { number: 39, title: "Old", state: "CLOSED", url: null, closedAt: "2026-10-20T00:00:00Z" }]));
});

after(() => rmSync(root, { recursive: true, force: true }));

test("show names the commits and the pull requests that cite a task, and the check says a merged one cites a task still open", () => {
    const shown = run("backlog.mjs", "show", "T-1");
    assert.match(shown, /commits: 1, the latest [0-9a-f]{7} of \d{4}-\d{2}-\d{2}: The dice, T-1/);
    assert.match(shown, /pull request #7, merged on 2026-10-30: The dice/);
    assert.doesNotMatch(run("backlog.mjs", "show", "T-2"), /commits|pull request/);
    const findings = JSON.parse(run("check.mjs", "--json"));
    assert.ok(findings.some((finding) => finding.kind === "code" && /T-1 is cited by pull request #7, merged on 2026-10-30, but is still open/.test(finding.message)));
    run("backlog.mjs", "done", "T-1");
    assert.ok(!JSON.parse(run("check.mjs", "--json")).some((finding) => finding.kind === "code"));
});

test("GitHub's issues read, a task's own, and the open ones no task does yet", () => {
    const issues = parseIssues(JSON.stringify([{ number: 40, title: "Login", state: "OPEN", url: "u", closedAt: null }, { number: 39, title: "Old", state: "CLOSED", url: null, closedAt: "2026-10-20T08:00:00Z" }]));
    assert.deepEqual(issues.map((issue) => [issue.number, issue.state, issue.closed]), [[40, "open", null], [39, "closed", "2026-10-20"]]);
    assert.equal(issueOf(issues, { issue: "#39" }).title, "Old");
    assert.equal(issueOf(issues, { issue: null }), null);
    assert.deepEqual(freeIssues(issues, [{ issue: null }]).map((issue) => issue.number), [40]);
    assert.deepEqual(freeIssues(issues, [{ issue: "#40" }]), []);
});

test("a task takes a GitHub issue once; done asks Claude to ask about closing it; the check and show follow the issue; without gh, closing says how", () => {
    assert.match(run("backlog.mjs", "add", "Fix the login", "--goal", "Core", "--issue", "40"), /T-3 added: .* · Fix the login \(issue: #40\) \(by: Claude\)$/m);
    assert.match(runAll("backlog.mjs", "add", "Again", "--issue", "#40"), /Issue #40 is already T-3's/);
    assert.match(run("backlog.mjs", "set", "T-2", "--issue", "39"), /· the log \(issue: #39\)$/m);
    assert.match(run("backlog.mjs", "show", "T-3"), /issue #40: Login fails \(open\)/);
    const notes = JSON.parse(run("check.mjs", "--json")).filter((finding) => finding.kind === "code").map((finding) => finding.message);
    assert.ok(notes.some((message) => /T-2 is still open but its GitHub issue #39 was closed on 2026-10-20/.test(message)));
    assert.match(run("backlog.mjs", "done", "T-3"), /T-3: Done\nT-3 has GitHub issue #40, still open: ask the user once whether to close it/);
    assert.ok(JSON.parse(run("check.mjs", "--json")).some((finding) => /T-3 is done but its GitHub issue #40 is still open/.test(finding.message)));
    assert.match(runAll("backlog.mjs", "issue-close", "T-1", { PROJECT_NO_GH: "1" }), /T-1 has no GitHub issue/);
    assert.match(runAll("backlog.mjs", "issue-close", "T-3", { PROJECT_NO_GH: "1" }), /gh is turned off here/);
});

function runAll(script, ...args)
{
    const extra = typeof args.at(-1) === "object" ? args.pop() : {};
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, PROJECT_NO_GH, ...env } = process.env;
    const result = spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env: { ...env, ...extra } });
    return `${result.stdout}${result.stderr}`;
}

function run(script, ...args)
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, PROJECT_NO_GH, ...env } = process.env;
    const result = spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env });
    return result.stdout;
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
