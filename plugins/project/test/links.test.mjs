// What a task waits for and points to: the lines' `(after: …)` and `(see: …)` read and written, the dependencies of the backlog and the
// todos together, and the commands and the check on a small project.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatLine, parseLine, taskErrors } from "../lib/backlog.mjs";
import { badLinks, dependencies, joinLinks, listOf, nestedParts, partsOf, seenFrom, splitLinks, todoLinks } from "../lib/links.mjs";
import { sayer } from "../lib/messages.mjs";
import { wordsOf } from "../lib/words.mjs";
import { splitFrontmatter } from "../lib/frontmatter.mjs";

const en = wordsOf("en");
const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

test("a text's after and see are read from its end in any order, and written back after first", () => {
    assert.deepEqual(splitLinks("fix it (see: T-12, D-2) (after: T-62, #giulia-1)"), { text: "fix it", after: ["T-62", "#giulia-1"], see: ["T-12", "D-2"], parent: null, issue: null, due: null, type: null, by: null, fields: {} });
    assert.deepEqual(splitLinks("the (after: x) is in the middle"), { text: "the (after: x) is in the middle", after: [], see: [], parent: null, issue: null, due: null, type: null, by: null, fields: {} });
    assert.equal(joinLinks("fix it", { after: ["T-62"], see: ["D-2"] }), "fix it (after: T-62) (see: D-2)");
    assert.equal(joinLinks("fix it", {}), "fix it");
    assert.deepEqual(listOf("T-3, #giulia-1 T-3"), ["T-3", "#giulia-1"]);
    assert.deepEqual(listOf("-"), []);

    const line = "- T-5 · P1 · high · Ann · 2026-10-29 · — · fix it (after: T-2, #giulia-1) (see: D-4) · done 2026-10-30";
    const task = parseLine(line, "done", en);
    assert.deepEqual([task.text, task.after, task.see, task.done], ["fix it", ["T-2", "#giulia-1"], ["D-4"], "2026-10-30"]);
    assert.equal(formatLine(task, en), line);
});

test("an after names tasks and todo ids, a see tasks and decisions; a task never waits for itself", () => {
    const prefixes = { task: "T", decision: "D" };
    assert.deepEqual(badLinks("after", ["T-2", "#giulia-1", "D-3", "giulia"], prefixes), ["D-3", "giulia"]);
    assert.deepEqual(badLinks("see", ["T-2", "D-3", "#giulia-1"], prefixes), ["#giulia-1"]);
    const say = sayer("en");
    const task = { id: 4, priority: "P1", effort: "high", to: "Ann", goal: "—", text: "ok", state: "todo", after: ["T-4", "D-1"], see: [] };
    const errors = taskErrors(task, { words: en, people: ["Ann"], goals: [], say });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /not D-1/);
    assert.match(errors[1], /T-4 cannot wait for itself/);
});

test("a todo line gives its id, Crew's or a task's number, and what it waits for", () => {
    assert.deepEqual(todoLinks("#matteo-3 · correct lootNote (after: T-61)"), { id: "#matteo-3", after: ["T-61"] });
    assert.deepEqual(todoLinks("T-61 · my part of it"), { id: "T-61", after: [] });
    assert.deepEqual(todoLinks("plain (after: #elena-1)"), { id: null, after: ["#elena-1"] });
});

test("the dependencies of the backlog and the todos: blockers, the chain to do first, a todo line that is a task, the cycles", () => {
    const tasks = [
        { id: 1, state: "todo", after: ["T-2"] },
        { id: 2, state: "doing", after: ["#giulia-1"] },
        { id: 3, state: "done", after: [] },
        { id: 4, state: "todo", after: ["T-3", "#giulia-9"] },
        { id: 5, state: "todo", after: ["T-6"] },
        { id: 6, state: "todo", after: [] },
    ];
    const todos = [
        { id: "#giulia-1", after: ["#matteo-3"], done: false },
        { id: "#matteo-3", after: [], done: false },
        { id: "T-6", after: ["T-5"], done: false },
        { id: "T-3", after: [], done: false },
    ];
    const graph = dependencies(tasks, todos);
    assert.deepEqual(graph.blockers("T-1"), ["T-2"]);
    assert.deepEqual(graph.chain("T-1"), ["#matteo-3", "#giulia-1", "T-2"]);
    // A task done or not found waits for nothing; the backlog, not the todo line, says whether T-3 is open.
    assert.deepEqual(graph.blockers("T-4"), []);
    assert.equal(graph.isOpen("T-3"), false);
    assert.equal(graph.known("#giulia-9"), false);
    // T-6's todo line waits for T-5, which waits for T-6.
    assert.deepEqual(graph.cycles(), [["T-5", "T-6"]]);
    assert.deepEqual(graph.chain("T-5"), ["T-6"]);
    assert.deepEqual([...seenFrom([{ id: 7, see: ["T-1", "D-2"] }, { id: 8, see: ["T-1"] }]).entries()], [["T-1", ["T-7", "T-8"]], ["D-2", ["T-7"]]]);
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-links-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Ann]\n");
    put(".claude/agents/giulia-ferri.md", "---\nname: giulia-ferri\n---\n");
    put(".claude/agent-memory/giulia-ferri/todo.md", "- [ ] P1 · 2026-10-29 · #giulia-1 · read the rules\n- [ ] P2 · 2026-10-29 · T-2 · her part of the dice\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n| 1 | Real dice. | |\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice\n- T-2 · P2 · medium · Giulia · 2026-10-01 · Core · the rolls\n- T-3 · P3 · low · Ann · 2026-10-01 · Core · the log\n\n## Postponed\n\n## Done\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("set --after and --see write the links, show reads them both ways with the chain, and a cycle or a missing number is refused", () => {
    assert.match(run("set", "T-1", "--after", "T-2, #giulia-1", "--see", "D-1"), /· the dice \(after: T-2, #giulia-1\) \(see: D-1\)$/);
    assert.match(run("set", "T-3", "--see", "T-1"), /· the log \(see: T-1\)$/);
    assert.match(run("set", "T-1", "--text", "the dice, fair"), /· the dice, fair \(after: T-2, #giulia-1\) \(see: D-1\)$/);
    assert.match(run("add", "the table (after: T-1)", "--goal", "Core"), /T-4 added: .* · the table \(after: T-1\) \(by: Claude\)$/);

    const shown = run("show", "T-1");
    assert.match(shown, /waits for: T-2 \(To do\), #giulia-1 \(open in a todo\)/);
    assert.match(shown, /the chain, in order: T-2 → #giulia-1 → T-1/);
    assert.match(shown, /waited for by: T-4/);
    assert.match(shown, /see: D-1/);
    assert.match(shown, /seen from: T-3/);

    const before = read("docs/TASKS.md");
    assert.match(fails("set", "T-2", "--after", "T-4"), /A cycle of waits, each waiting for the next: T-1 → T-2 → T-4 → T-1/);
    assert.match(fails("set", "T-2", "--after", "T-2"), /T-2 cannot wait for itself/);
    assert.match(fails("set", "T-3", "--see", "T-99, D-7"), /T-3 links to T-99[\s\S]*T-3 links to D-7/);
    assert.match(fails("set", "T-3", "--after", "giulia"), /An after names a backlog task/);
    assert.equal(read("docs/TASKS.md"), before);

    assert.match(run("set", "T-1", "--after", "", "--see", ""), /· the dice, fair$/);
});

test("a task's note is written once, in the notes folder, and show names it", () => {
    assert.equal(run("note", "T-2"), "docs/tasks/T-2.md");
    // A note is a document: its frontmatter on top, its body the heading.
    const note = splitFrontmatter(read("docs/tasks/T-2.md"));
    assert.equal(note.body, "# T-2 · the rolls\n");
    assert.deepEqual([note.data.title, note.data.type], ["T-2 · the rolls", "note"]);
    writeFileSync(join(root, "docs/tasks/T-2.md"), "# T-2 · the rolls\n\nWhere it got to.\n");
    assert.equal(run("note", "T-2"), "docs/tasks/T-2.md");
    assert.match(read("docs/tasks/T-2.md"), /Where it got to/);
    assert.match(run("show", "T-2"), /note: docs\/tasks\/T-2\.md/);
});

test("the check finds a cycle through a todo line, an after to a todo id nobody gave, a link to a missing task and an orphan note", () => {
    const tasks = read("docs/TASKS.md").replace("· the log", "· the log (after: #giulia-7) (see: T-50)").replace("· the rolls", "· the rolls (after: T-3)");
    writeFileSync(join(root, "docs/TASKS.md"), tasks);
    writeFileSync(join(root, ".claude/agent-memory/giulia-ferri/todo.md"), "- [ ] P1 · 2026-10-29 · #giulia-1 · read the rules\n- [ ] P2 · 2026-10-29 · T-3 · her part (after: T-2)\n");
    put("docs/tasks/T-40.md", "# T-40\n");

    const findings = JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8", env: environment() }).stdout);
    const has = (severity, pattern) => findings.some((finding) => finding.severity === severity && pattern.test(`${finding.file}:${finding.line} ${finding.message}`));
    assert.ok(has("error", /TASKS\.md:\d+ A cycle of waits, each waiting for the next: T-2 → T-3 → T-2/));
    assert.ok(has("warning", /TASKS\.md:\d+ T-3 waits for #giulia-7, which no colleague's todo holds/));
    assert.ok(has("error", /TASKS\.md:\d+ T-3 links to T-50, which does not exist/));
    assert.ok(has("warning", /docs\/tasks\/T-40\.md:null The note of T-40/));
    assert.ok(!has("warning", /#giulia-1/));
});

function run(...args)
{
    return execFileSync(process.execPath, [join(scripts, "backlog.mjs"), ...args], { cwd: root, encoding: "utf8", env: environment() }).trim();
}

function fails(...args)
{
    const result = spawnSync(process.execPath, [join(scripts, "backlog.mjs"), ...args], { cwd: root, encoding: "utf8", env: environment() });
    assert.notEqual(result.status, 0, `backlog.mjs ${args.join(" ")} should fail`);
    return `${result.stdout}${result.stderr}`;
}

function environment()
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...rest } = process.env;
    return rest;
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}

function read(path)
{
    return existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
}

test("the page serves a task's note by its number, and its data carries each task's links", async () => {
    const { pageServer } = await import("../page/serve.mjs");
    const { server } = await pageServer(root);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;

    try {
        await pageChecks(port);
    } finally {
        server.closeAllConnections();
        server.close();
    }
});

async function pageChecks(port)
{
    const note = await fetch(`http://127.0.0.1:${port}/note/2`);
    assert.equal(note.status, 200);
    assert.match(await note.text(), /Where it got to/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/note/3`)).status, 404);

    const data = await (await fetch(`http://127.0.0.1:${port}/data`)).json();
    const two = data.board.find((task) => task.id === 2);
    assert.deepEqual([two.after, two.blockedBy, two.waitedBy, two.note, two.noteHref], [["T-3"], ["T-3"], [], "docs/tasks/T-2.md", "/note/2"]);
    assert.deepEqual(data.board.find((task) => task.id === 3).see, ["T-50", "T-1"]);

    // Every document of the docs opens in the page: its address, its frontmatter's description; nothing outside the docs.
    const plan = data.documents.find((document) => document.name === "PLAN.md");
    assert.equal(plan.href, "/doc/PLAN.md");
    assert.equal((await fetch(`http://127.0.0.1:${port}${plan.href}`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/doc/..%2F.claude%2Fproject.md`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/doc/NONE.md`)).status, 404);
}

test("a goal closes once its tasks are closed, refuses new tasks while closed, opens again, and the check says when a closed goal has open ones", () => {
    const plan = (...args) => spawnSync(process.execPath, [join(scripts, "plan.mjs"), ...args], { cwd: root, encoding: "utf8", env: environment() });
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n\n### Later\n");
    assert.match(plan("close", "Core").stderr, /«Core» still has open tasks: T-1, T-2, T-3, T-4/);
    assert.match(plan("close", "Later").stdout, /«Later» closed on \d{4}-\d{2}-\d{2}\./);
    assert.match(read("docs/PLAN.md"), /^### Later · done \d{4}-\d{2}-\d{2}$/m);
    assert.match(plan("goals").stdout, /Core: 4 open, 0 done\nLater: closed on \d{4}-\d{2}-\d{2}, 0 done/);
    assert.match(fails("add", "more", "--goal", "Later"), /The goal «Later» closed on .*plan\.mjs open "Later"/);

    writeFileSync(join(root, "docs/TASKS.md"), read("docs/TASKS.md").replace("· Core · the log", "· Later · the log"));
    const findings = JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8", env: environment() }).stdout);
    assert.ok(findings.some((finding) => finding.kind === "plan" && /«Later» closed on .* but T-3 are still open/.test(finding.message)));

    assert.match(plan("open", "Later").stdout, /«Later» open again/);
    assert.match(read("docs/PLAN.md"), /^### Later$/m);
    assert.match(plan("close", "Elsewhere").stderr, /The goal «Elsewhere» is not in the plan/);
});

test("a part names its large task at the end of its text, one level deep, and the large one finds its parts", () => {
    assert.deepEqual(splitLinks("the format (in: T-23) (after: T-24)"), { text: "the format", after: ["T-24"], see: [], parent: "T-23", issue: null, due: null, type: null, by: null, fields: {} });
    assert.equal(joinLinks("the format", { after: ["T-24"], parent: "T-23" }), "the format (after: T-24) (in: T-23)");
    const tasks = [{ id: 23, parent: null }, { id: 24, parent: "T-23" }, { id: 25, parent: "T-23" }, { id: 26, parent: "T-25" }];
    assert.deepEqual([...partsOf(tasks).entries()], [["T-23", ["T-24", "T-25"]], ["T-25", ["T-26"]]]);
    assert.deepEqual(nestedParts(tasks), [{ id: "T-26", parent: "T-25" }]);
    const say = sayer("en");
    const errors = taskErrors({ id: 4, priority: "P1", effort: "high", to: "Ann", goal: "—", text: "ok", state: "todo", after: [], see: [], parent: "T-4" }, { words: en, people: ["Ann"], goals: [], say });
    assert.deepEqual(errors, ["T-4 cannot be a part of itself."]);
    assert.match(taskErrors({ id: 4, priority: "P1", effort: "high", to: "Ann", goal: "—", text: "ok", state: "todo", after: [], see: [], parent: "D-2" }, { words: en, people: ["Ann"], goals: [], say })[0], /An in names the large task/);
});

test("a part started starts its large task, the last part closed proposes closing it, list --atomic leaves it out, and the check follows it", () => {
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · — · the big one\n- T-2 · P2 · medium · Claude · 2026-10-01 · — · part one (in: T-1)\n- T-3 · P2 · medium · Claude · 2026-10-01 · — · part two\n- T-4 · P2 · medium · Claude · 2026-10-01 · — · elsewhere\n\n## Postponed\n\n## Done\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put(".claude/agent-memory/giulia-ferri/todo.md", "- [ ] P1 · 2026-10-29 · #giulia-1 · read the rules\n");
    assert.match(run("set", "T-3", "--in", "T-1"), /· part two \(in: T-1\)$/);
    assert.match(fails("set", "T-4", "--in", "T-2"), /T-4 is a part of T-2, which is itself a part/);
    assert.match(fails("set", "T-1", "--in", "T-4"), /is a part of T-1, which is itself a part/);
    assert.match(run("start", "T-2"), /T-2: In progress\nT-1: In progress/);
    assert.deepEqual(JSON.parse(run("list", "--atomic", "--json")).map((task) => task.id), [2, 3, 4]);
    assert.match(run("show", "T-1"), /parts, 0 of 2 closed: T-2 \(In progress\), T-3 \(To do\)\n {2}the next part to start: T-3/);
    assert.match(run("show", "T-2"), /part of: T-1 \(In progress\)/);
    assert.doesNotMatch(run("done", "T-2"), /Every part/);
    assert.match(run("done", "T-3"), /Every part of T-1 is closed: backlog\.mjs done T-1/);

    const check = () => JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8", env: environment() }).stdout);
    assert.ok(check().some((finding) => finding.severity === "note" && /Every part of T-1 is closed/.test(finding.message)));
    run("todo", "T-3");
    run("done", "T-1");
    assert.ok(check().some((finding) => finding.severity === "warning" && /T-1 is done but its parts T-3 are still open/.test(finding.message)));
});

test("list marks a blocked task with what it still waits for, and a large task with its parts closed", () => {
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · — · the big one\n- T-2 · P2 · medium · Claude · 2026-10-01 · — · part one (in: T-1)\n- T-3 · P2 · medium · Claude · 2026-10-01 · — · waits (after: T-2, #giulia-1)\n\n## Postponed\n\n## Done\n");
    const listed = run("list");
    assert.match(listed, /· the big one {2}0\/1 parts$/m);
    assert.match(listed, /· waits \(after: T-2, #giulia-1\) {2}⛓ T-2, #giulia-1$/m);
    assert.match(listed, /· part one \(in: T-1\)$/m);
});

test("a large task postponed with its parts starts again from its next part, a postponed one when none is to do", () => {
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n- T-1 · P2 · high · Claude · 2026-10-01 · — · the big one\n- T-2 · P2 · medium · Claude · 2026-10-01 · — · part one (in: T-1)\n- T-3 · P1 · medium · Claude · 2026-10-02 · — · part two (in: T-1)\n\n## Done\n");
    assert.match(run("show", "T-1"), /the next part to start: T-3/);
    assert.match(run("start", "T-3"), /T-3: In progress\nT-1: In progress/);
});

test("with Crew, the todo lines that cite no task are listed; take makes one a task created by the colleague, the line citing it and the waits following", () => {
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice (after: #giulia-1)\n\n## Postponed\n\n## Done\n");
    put(".claude/agent-memory/giulia-ferri/todo.md", "# Todo\r\n\r\n- [ ] P1 · 2026-10-28 · #giulia-1 · Tell Claude: the rolls · lose their sign\r\n  - [ ] a detail\r\n- [ ] P2 · 2026-10-29 · T-1 · retest the dice\r\n- [ ] P3 · 2026-10-30 · read the rules (after: #giulia-1)\r\n- [x] 2026-10-20 · closed\r\n");
    assert.equal(run("todos"), "giulia-ferri:3 · P1 · 2026-10-28 · Tell Claude: the rolls · lose their sign\ngiulia-ferri:6 · P3 · 2026-10-30 · read the rules (after: #giulia-1)\n2 open lines of the colleagues' todos cite no task.");
    assert.deepEqual(JSON.parse(run("todos", "--json")).map((todo) => [todo.ref, todo.id, todo.name]), [["giulia-ferri:3", "#giulia-1", "Giulia"], ["giulia-ferri:6", null, "Giulia"]]);
    assert.match(fails("take", "giulia-ferri:5"), /giulia-ferri:5 is no open line/);

    // Handed over: the task is Claude's, the line ticked and citing it, the waits on its old id now on the task.
    assert.match(run("take", "giulia-ferri:3", "--to", "Claude", "--type", "bug"), /^T-2 added from giulia-ferri:3, created by Giulia: - T-2 · P1 · medium · Claude · 2026-10-28 · .* · Tell Claude: the rolls - lose their sign \(type: bug\) \(by: Giulia\)$/);
    assert.equal(read(".claude/agent-memory/giulia-ferri/todo.md"), "# Todo\r\n\r\n- [x] 2026-10-28 · T-2 · Tell Claude: the rolls · lose their sign\r\n  - [ ] a detail\r\n- [ ] P2 · 2026-10-29 · T-1 · retest the dice\r\n- [ ] P3 · 2026-10-30 · read the rules (after: T-2)\r\n- [x] 2026-10-20 · closed\r\n");
    assert.match(read("docs/TASKS.md"), /· the dice \(after: T-2\)\n/);

    // Kept: the line stays open, citing the task.
    assert.match(run("take", "giulia-ferri:6", "--to", "Giulia", "--keep"), /^T-3 added from giulia-ferri:6, created by Giulia: .* · Giulia · 2026-10-30 · .* · read the rules \(after: T-2\) \(by: Giulia\)$/);
    assert.match(read(".claude/agent-memory/giulia-ferri/todo.md"), /\r\n- \[ \] P3 · 2026-10-30 · T-3 · read the rules \(after: T-2\)\r\n/);
    assert.match(run("todos"), /^0 open lines/);
});
