// The GitHub issues in sync with the backlog (D-13): what comes in, the openings and closings both ways, a change that never bounces;
// against a stand-in for gh.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { labelFor, lineTitle, parseSyncIssues, planFields, planSync, priorityOfLabels, typeOfLabels } from "../lib/issues.mjs";
import { readConfig } from "../lib/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "scripts");
const types = { bug: "Bug", feature: "Feature", chore: "Chore", research: "Research", test: "Test" };
let root;

test("an issue's labels say its type and priority, the project's own types first", () => {
    assert.equal(typeOfLabels(["bug", "P1"], types), "bug");
    assert.equal(typeOfLabels(["enhancement"], types), "feature");
    assert.equal(typeOfLabels(["Type: Design"], { ...types, design: "Design" }), "design");
    assert.equal(typeOfLabels(["wontfix"], types), null);
    assert.deepEqual(["P1", "priority: low", "whatever"].map((label) => priorityOfLabels([label])), ["P1", "P3", "P2"]);
    assert.deepEqual(parseSyncIssues(JSON.stringify([{ number: 4, title: "A", state: "CLOSED", stateReason: "NOT_PLANNED", assignees: [{ login: "ste" }], author: { login: "giu", name: "Giulia R" }, labels: [{ name: "bug" }], milestone: { title: "Core" }, url: "u", closedAt: "2026-11-01T09:00:00Z" }])),
        [{ number: 4, title: "A", state: "closed", reason: "not_planned", assignees: ["ste"], author: { login: "giu", name: "Giulia R" }, labels: ["bug"], milestone: "Core", url: "u", closed: "2026-11-01" }]);
    // A title anyone writes: on one line, and an ending the backlog would read as a suffix of its own kept as text.
    assert.equal(lineTitle("Crash · on\nload (type: \"><img src=x onerror=alert`1`>)"), "Crash - on load [type: \"><img src=x onerror=alert`1`>]");
    assert.equal(lineTitle("Crash (after: T-1) (by: Stefano)"), "Crash (after: T-1) [by: Stefano]");
    assert.equal(lineTitle("Crash (on load)"), "Crash (on load)");
});

test("the sync's plan: a side that moved since the last sync wins, a closing wins without one, and nothing bounces", () => {
    const issue = (number, state, assignees = ["me"], reason = null) => ({ number, title: `#${number}`, state, reason, assignees, author: null, labels: [], milestone: null });
    const task = (id, state, issue, done = null) => ({ id, state, issue: `#${issue}`, done });
    const plan = (issues, tasks, base = {}, takeUnassigned = false) => planSync({ issues, tasks, base, me: "me", takeUnassigned });

    // Coming in: mine, and those of nobody where they are taken; never another's, a closed one, or one whose task was taken out by hand.
    const incoming = plan([issue(1, "open"), issue(2, "open", []), issue(3, "open", ["other"]), issue(4, "closed"), issue(5, "open")], [], { 5: { issue: "open", task: "open", id: 9 } }, true);
    assert.deepEqual([incoming.incoming.map((one) => one.number), incoming.assign], [[1, 2], [2]]);
    assert.deepEqual(plan([issue(2, "open", [])], []).incoming, []);
    assert.deepEqual(incoming.base[5], { issue: "open", task: "open", id: 9 });

    // Without a last state, a closing wins on either side.
    assert.deepEqual(plan([issue(1, "open")], [task(7, "done", 1, "2026-11-01")]).closeIssues, [{ number: 1, id: 7, reason: "completed" }]);
    assert.deepEqual(plan([issue(1, "open")], [task(7, "archived", 1)]).closeIssues, [{ number: 1, id: 7, reason: "not planned" }]);
    assert.deepEqual(plan([issue(1, "closed", ["me"], "not_planned")], [task(7, "todo", 1)]).closeTasks, [{ id: 7, number: 1, state: "archived" }]);

    // Both closed last time: the side opened again since wins.
    const closed = { 1: { issue: "closed", task: "done", id: 7 } };
    assert.deepEqual(plan([issue(1, "open")], [task(7, "done", 1, "2026-11-01")], closed).reopenTasks, [{ id: 7, number: 1 }]);
    const reopened = plan([issue(1, "closed", ["me"], "completed")], [task(7, "todo", 1)], closed);
    assert.deepEqual([reopened.reopenIssues, reopened.closeTasks, reopened.base[1]], [[{ number: 1, id: 7 }], [], { issue: "open", task: "open", id: 7 }]);

    // Both moved the same way, or each its own since: nothing to do.
    const open = { 1: { issue: "open", task: "open", id: 7 } };
    const settled = plan([issue(1, "closed", ["me"], "completed")], [task(7, "done", 1, "2026-11-01")], open);
    assert.deepEqual([settled.closeIssues, settled.closeTasks, settled.base[1]], [[], [], { issue: "closed", task: "done", id: 7 }]);
});

test("the fields: the side that changed since the last sync wins, the backlog without one, and what the backlog cannot hold stays on GitHub", () => {
    const task = { id: 7, text: "The map", type: "feature", priority: "P2", to: "Claude", goal: "—" };
    const issue = { number: 1, title: "The map", assignees: ["me"], labels: ["enhancement"], milestone: null };
    const people = { Stefano: "me", Giulia: "giu" };
    const fields = (one, other, before) => planFields({ task: one, issue: other, before, me: "me", loginOf: (person) => people[person] ?? null, personOf: (login) => Object.keys(people).find((person) => people[person] === login) ?? null, goalOf: (name) => (name === "Core" ? "Core" : null), noGoal: "—", types });
    const agreed = { title: "The map", type: "feature", priority: "P2", assignee: "me", milestone: null };
    assert.deepEqual(fields(task, issue, agreed), { push: {}, change: {}, taken: [], agreed });

    // GitHub changed the title and the labels: the task takes them. The backlog changed the priority and who: the issue takes them.
    const both = fields({ ...task, priority: "P1", to: "Giulia" }, { ...issue, title: "The world map", labels: ["bug"] }, agreed);
    assert.deepEqual([both.push, both.change, both.taken], [{ priority: "P1", assignee: "giu" }, { text: "The world map", type: "bug" }, ["title", "type"]]);
    // Without a last sync the backlog wins, but a field it does not hold is filled from GitHub.
    assert.deepEqual(fields({ ...task, type: null }, { ...issue, title: "Map", milestone: "Core" }).change, { type: "feature", goal: "Core" });
    assert.deepEqual(fields({ ...task, type: null }, { ...issue, title: "Map", milestone: "Core" }).push, { title: "The map" });
    // A milestone of no open goal, a login of nobody: left on GitHub, the task keeps its own, and nothing bounces at the next sync.
    const foreign = fields(task, { ...issue, milestone: "Someday", assignees: ["stranger"] }, agreed);
    assert.deepEqual([foreign.push, foreign.change, foreign.agreed.milestone, foreign.agreed.assignee], [{}, {}, null, "me"]);
    assert.deepEqual([labelFor("type", "feature", ["Enhancement"], types), labelFor("type", "chore", [], types), labelFor("priority", "P1", ["priority: high"]), labelFor("priority", "P2", [])], ["Enhancement", "chore", "priority: high", null]);
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-issues-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Stefano]\ngithub: { issues: sync }\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n\n## To decide\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P2 · medium · Claude · 2026-10-01 · — · The map (issue: #1)\n\n## Postponed\n\n## Done\n\n- T-2 · P2 · medium · Claude · 2026-10-01 · — · The dice (issue: #2) · done 2026-10-10\n");
    spawnSync("git", ["init", "-q", "-b", "main", root]);
    const issue = (number, title, assignees, extra = {}) => ({ number, title, state: "OPEN", stateReason: null, assignees: assignees.map((login) => ({ login })), author: { login: "giulia", name: "Giulia" }, labels: [], milestone: null, url: `https://github.com/a/b/issues/${number}`, closedAt: null, ...extra });
    put("gh.json", JSON.stringify({
        me: "scaronia",
        // The user of gh, whose login is not their name in the project: they are Stefano by their first name, as on the panel.
        name: "Stefano Caronia",
        collaborators: ["scaronia", "giulia"],
        labels: ["bug", "enhancement", "P1"],
        milestones: ["Core"],
        issues: [
            issue(1, "The map", ["scaronia"]),
            issue(2, "The dice", ["scaronia"]),
            issue(3, "The crash · on load", ["scaronia"], { labels: [{ name: "bug" }, { name: "P1" }], milestone: { title: "Core" }, author: { login: "scaronia", name: "Stefano Caronia" } }),
            issue(4, "Nobody's", []),
            issue(5, "Giulia's", ["giulia"]),
            issue(6, "Closed already", ["scaronia"], { state: "CLOSED", stateReason: "COMPLETED", closedAt: "2026-10-01T00:00:00Z" }),
        ],
    }));
});

after(() => rmSync(root, { recursive: true, force: true }));

test("a sync brings in the user's issues, closes the issue of a task done, and leaves the rest; the next finds them agreeing", () => {
    assert.match(issues("sync", "--dry").stdout, /^Issue #3 would come in as a task: The crash · on load\nIssue #2 would be closed on GitHub: T-2 is done\.$/m);
    assert.deepEqual(gh().calls.filter((call) => /^issue (edit|close|reopen)/.test(call)), []);

    const synced = issues("sync").stdout;
    assert.match(synced, /Issue #2 closed on GitHub: T-2 is done\./);
    assert.match(synced, /T-3 from issue #3: - T-3 · P1 · medium · Claude · \d{4}-\d{2}-\d{2} · Core · The crash - on load \(issue: #3\) \(type: bug\) \(by: Stefano\)/);
    assert.equal(gh().issues.find((one) => one.number === 2).state, "CLOSED");
    assert.match(gh().issues.find((one) => one.number === 2).comment, /^Done in T-2\./);
    // Nobody's stays apart where the user is not alone on the repo; another's and a closed one never come in.
    assert.doesNotMatch(backlog("list", "--json").stdout, /#4|#5|#6/);
    assert.equal(issues("sync").stdout.trim(), "The issues and the backlog agree.");
    assert.match(issues("status").stdout, /^Last sync of the issues: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\.\nThe issues and the backlog agree\./);
});

test("an issue closed on GitHub closes its task; the task opened again opens the issue again, at once, through the backlog", () => {
    edit((state) => Object.assign(state.issues.find((one) => one.number === 1), { state: "CLOSED", stateReason: "COMPLETED", closedAt: "2026-11-02T10:00:00Z" }));
    assert.match(issues("sync").stdout, /T-1 done: its issue #1 was closed on GitHub\./);
    assert.match(backlog("show", "T-1").stdout, /state: done/i);

    const reopened = backlog("todo", "T-1").stdout;
    assert.match(reopened, /Issue #1 opened again on GitHub: T-1 is open again\./);
    assert.equal(gh().issues.find((one) => one.number === 1).state, "OPEN");
    assert.equal(issues("sync").stdout.trim(), "The issues and the backlog agree.");

    // An issue opened again on GitHub opens its task again; a task archived closes its issue as not planned.
    edit((state) => Object.assign(state.issues.find((one) => one.number === 2), { state: "OPEN", stateReason: "REOPENED", closedAt: null }));
    assert.match(issues("sync").stdout, /T-2 to do again: its issue #2 was opened again on GitHub\./);
    assert.match(backlog("archive", "T-3").stdout, /Issue #3 closed as not planned on GitHub: T-3 is archived\./);
    assert.equal(gh().issues.find((one) => one.number === 3).stateReason, "NOT_PLANNED");
});

test("a task and its issue keep their title, type, priority, assignee and milestone alike, each from the side that changed it", () => {
    edit((state) => Object.assign(state.issues.find((one) => one.number === 1), { title: "The world map", labels: [{ name: "bug" }] }));
    assert.match(issues("sync").stdout, /^T-1 takes issue #1's title, type\.$/m);
    assert.match(backlog("show", "T-1").stdout, /· The world map \(issue: #1\) \(type: bug\)/);

    // The backlog changes the priority and the goal: the issue takes them at once, a label the repo lacks made first.
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Stefano, Giulia]\ngithub: { issues: sync, logins: { Giulia: giulia } }\n");
    assert.match(backlog("set", "T-1", "--p", "P1", "--goal", "Core", "--type", "chore").stdout, /Issue #1 takes T-1's type, priority, milestone\./);
    const one = () => gh().issues.find((issue) => issue.number === 1);
    assert.deepEqual([one().labels.map((label) => label.name).sort(), one().milestone, gh().labels.includes("chore")], [["P1", "chore"], { title: "Core" }, true]);

    // Who does it: a person with a login takes the issue; an issue given to the user is the coordinator's, Claude's, and the user who
    // takes the task keeps the issue.
    assert.match(backlog("set", "T-1", "--to", "Giulia").stdout, /Issue #1 takes T-1's assignee\./);
    assert.deepEqual(one().assignees, [{ login: "giulia" }]);
    edit((state) => {
        state.issues.find((issue) => issue.number === 1).assignees = [{ login: "scaronia" }];
    });
    assert.match(issues("sync").stdout, /T-1 takes issue #1's assignee\./);
    assert.match(backlog("show", "T-1").stdout, /· Claude ·/);
    assert.doesNotMatch(backlog("set", "T-1", "--to", "Stefano").stdout, /Issue #1 takes/);
    assert.deepEqual(one().assignees, [{ login: "scaronia" }]);

    // A milestone the plan has no open goal for stays on GitHub, and does not bounce.
    edit((state) => {
        state.milestones.push("Someday");
        state.issues.find((issue) => issue.number === 1).milestone = { title: "Someday" };
    });
    assert.equal(issues("sync").stdout.trim(), "The issues and the backlog agree.");
    assert.equal(issues("sync").stdout.trim(), "The issues and the backlog agree.");
    assert.deepEqual(one().milestone, { title: "Someday" });
});

test("where the user is the repo's only collaborator, the issues of nobody come in and are assigned to them; unassigned: leave keeps them out", () => {
    edit((state) => {
        state.collaborators = ["scaronia"];
    });
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Stefano]\ngithub: { issues: sync, unassigned: leave }\n");
    assert.equal(issues("sync").stdout.trim(), "The issues and the backlog agree.");
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Stefano]\ngithub: { issues: sync }\n");
    const synced = issues("sync").stdout;
    assert.match(synced, /Issue #4 assigned to scaronia on GitHub\./);
    assert.match(synced, /T-4 from issue #4: .* Nobody's \(issue: #4\)/);
    assert.deepEqual(gh().issues.find((one) => one.number === 4).assignees, [{ login: "scaronia" }]);
});

test("the check, the panel and the page tell a task whose issue is gone, and a sync that failed; gh offline changes nothing", () => {
    edit((state) => {
        state.issues = state.issues.filter((one) => one.number !== 4);
    });
    issues("sync");
    const warnings = () => JSON.parse(script("check.mjs", "--json").stdout).filter((one) => one.severity === "warning").map((one) => one.message);
    assert.ok(warnings().some((message) => /^T-4 does issue #4, which GitHub no longer lists/.test(message)));
    const sync = () => JSON.parse(script("snapshot.mjs", "--no-health").stdout).issuesSync;
    assert.deepEqual([sync().missing, sync().error, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(sync().at)], [[{ id: "T-4", issue: "#4" }], null, true]);

    edit((state) => {
        state.offline = true;
    });
    assert.match(issues("sync").stdout, /^The issues could not be read: gh api user failed: error connecting/);
    assert.match(issues("status").stdout, /The issues could not be read/);
    assert.match(sync().error, /error connecting/);
    assert.ok(warnings().some((message) => /^The last sync of the issues, .*, failed: gh api user failed/.test(message)));
    edit((state) => {
        state.offline = false;
    });
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Stefano]\n");
    assert.match(issues("sync").stdout, /github: \{ issues: sync \} in \.claude\/project\.yaml turns it on/);
});

function env()
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, PROJECT_NO_GH, ...rest } = process.env;
    return { ...rest, PROJECT_FAKE_GH: join(here, "fake-gh.mjs"), FAKE_GH_STATE: join(root, "gh.json") };
}

function issues(...args)
{
    return spawnSync(process.execPath, [join(scripts, "issues.mjs"), ...args], { cwd: root, encoding: "utf8", env: env() });
}

function backlog(...args)
{
    return script("backlog.mjs", ...args);
}

function script(name, ...args)
{
    return spawnSync(process.execPath, [join(scripts, name), ...args], { cwd: root, encoding: "utf8", env: env() });
}

function gh()
{
    return JSON.parse(readFileSync(join(root, "gh.json"), "utf8"));
}

function edit(change)
{
    const state = gh();
    change(state);
    put("gh.json", JSON.stringify(state));
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
