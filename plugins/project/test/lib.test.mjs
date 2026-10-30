// The pure modules: the lines of the backlog, the plan, the decisions and the todos, the configuration, in English and Italian.
import assert from "node:assert/strict";
import { test } from "node:test";
import { citedTasks, effortKey, formatLine, moveTasks, nextId, parseBacklog, parseLine, renderArchive, renderBacklog, taskErrors } from "../lib/backlog.mjs";
import { defaultPort, readConfig, relativeTo, resolve } from "../lib/config.mjs";
import { citedDecisions, nextDecision, numbering, parseDecisions } from "../lib/decisions.mjs";
import { sayer } from "../lib/messages.mjs";
import { closeGoal, planGoals, planPhases, planUpdated } from "../lib/plan.mjs";
import { firstName, formatTodo, parseTodo } from "../lib/todos.mjs";
import { wordsOf } from "../lib/words.mjs";

const it = wordsOf("it");
const en = wordsOf("en");

test("a task line reads and writes back the same, done and archived marks included", () => {
    const line = "- T-12 · P2 · medio · Matteo · 2026-10-29 · Revisione e pulizia · La plancia, in tre parti · fatto 2026-10-30 · archiviato 2026-10-31";
    const task = parseLine(line, "archived", it);
    assert.deepEqual({ ...task }, { id: 12, priority: "P2", effort: "medio", to: "Matteo", created: "2026-10-29", goal: "Revisione e pulizia", text: "La plancia, in tre parti", after: [], see: [], parent: null, issue: null, due: null, type: null, by: null, started: null, done: "2026-10-30", archived: "2026-10-31", state: "archived" });
    assert.equal(formatLine(task, it), line);
    assert.equal(parseLine("- [ ] P2 · 2026-10-29 · a todo line", "todo", it), null);
});

test("the markers follow the language and the prefix the project picks", () => {
    const task = parseLine("- W-3 · P1 · high · Ann · 2026-01-02 · — · Ship it · done 2026-01-03", "done", en, "W");
    assert.equal(task.id, 3);
    assert.equal(task.done, "2026-01-03");
    assert.equal(formatLine(task, en, "W"), "- W-3 · P1 · high · Ann · 2026-01-02 · — · Ship it · done 2026-01-03");
});

test("a backlog is read by its sections and written back with its header, each state in order of number", () => {
    const text = [
        "# Backlog",
        "",
        "What it is.",
        "",
        "## Da fare",
        "",
        "- T-5 · P2 · medio · Claude · 2026-10-01 · — · cinque",
        "- T-2 · P1 · alto · Stefano · 2026-10-01 · — · due",
        "",
        "## In corso",
        "",
        "- T-7 · P3 · basso · Claude · 2026-10-02 · — · sette",
        "- not a task",
        "",
    ].join("\n");
    const { tasks, unread } = parseBacklog(text, it);
    assert.deepEqual(tasks.map((task) => [task.id, task.state, task.line]), [[5, "todo", 7], [2, "todo", 8], [7, "doing", 12]]);
    assert.deepEqual(unread, [{ line: 13, text: "- not a task" }]);

    const written = renderBacklog(tasks, text, it);
    assert.ok(written.startsWith("# Backlog\n\nWhat it is.\n\n## In corso\n\n- T-7 "));
    assert.ok(written.includes("## Da fare\n\n- T-2 · P1 · alto · Stefano · 2026-10-01 · — · due\n- T-5 "));
    assert.ok(written.includes("## Rimandati\n\n## Fatti\n"));
    assert.deepEqual(parseBacklog(written, it).tasks.map((task) => task.id), [7, 2, 5]);
});

test("a heading the language does not know leaves its lines unread", () => {
    const { tasks, unread } = parseBacklog("## Somewhere\n\n- T-1 · P2 · medio · Claude · 2026-10-01 · — · uno\n", it);
    assert.equal(tasks.length, 0);
    assert.equal(unread.length, 2);
});

test("the archive keeps its header and its tasks by number", () => {
    const tasks = [
        { id: 9, priority: "P2", effort: "medio", to: "Claude", created: "2026-10-01", goal: "—", text: "nove", done: "2026-10-02", archived: "2026-10-03", state: "archived" },
        { id: 4, priority: "P2", effort: "medio", to: "Claude", created: "2026-10-01", goal: "—", text: "quattro", done: null, archived: "2026-10-03", state: "archived" },
        { id: 1, priority: "P2", effort: "medio", to: "Claude", created: "2026-10-01", goal: "—", text: "vivo", done: null, archived: null, state: "todo" },
    ];
    const written = renderArchive(tasks, "# Archivio\n\n- T-1 · old\n", it);
    assert.equal(written, "# Archivio\n\n- T-4 · P2 · medio · Claude · 2026-10-01 · — · quattro · archiviato 2026-10-03\n- T-9 · P2 · medio · Claude · 2026-10-01 · — · nove · fatto 2026-10-02 · archiviato 2026-10-03\n");
});

test("moving tasks sets the day of done once, clears it when they open again, and names the ids it does not find", () => {
    const tasks = [
        { id: 1, state: "todo", done: null, archived: null },
        { id: 2, state: "done", done: "2026-10-01", archived: null },
    ];
    const done = moveTasks(tasks, [1, 2, 3], "done", "2026-10-30");
    assert.deepEqual(done.tasks.map((task) => [task.state, task.done]), [["done", "2026-10-30"], ["done", "2026-10-01"]]);
    assert.deepEqual(done.missing, [3]);
    assert.equal(moveTasks(done.tasks, [2], "doing", "2026-10-30").tasks[1].done, null);
});

test("the next number, the cited tasks and an effort's key", () => {
    assert.equal(nextId([]), 1);
    assert.equal(nextId([{ id: 4 }, { id: 11 }]), 12);
    assert.deepEqual(citedTasks("see T-12 and T-3, again T-12; not XT-4"), [12, 3]);
    assert.equal(effortKey("extra", it), "xhigh");
    assert.equal(effortKey("—", it), "none");
    assert.equal(effortKey("huge", it), undefined);
});

test("a task's errors name each wrong value, in the project's language", () => {
    const say = sayer("it");
    const task = { id: 1, priority: "P4", effort: "enorme", to: "Nessuno", goal: "Altrove", text: "a · b", state: "later" };
    const errors = taskErrors(task, { words: it, people: ["Claude"], goals: ["Uno"], say });
    assert.equal(errors.length, 6);
    assert.match(errors[0], /La priorità è P1, P2 o P3, non P4/);
    assert.match(errors[2], /Nessuno non può avere un compito: Claude/);
    assert.deepEqual(taskErrors({ ...task, priority: "P1", effort: "medio", to: "Claude", goal: "—", text: "ok", state: "todo" }, { words: it, people: ["Claude"], goals: [], say }), []);
});

test("the plan gives its goals with their phases, its phases' table and the day it was updated", () => {
    const plan = [
        "# Piano",
        "",
        "> Aggiornato il 2026-10-29. Breve.",
        "",
        "| Fase | Alla fine puoi… |",
        "|---|---|",
        "| 0. Progettazione | approvare |",
        "| 2. Ruoli e sessioni | giocare |",
        "",
        "## Traguardi",
        "",
        "### Ruoli e sessioni (fase 2)",
        "",
        "### Revisione e pulizia",
        "",
        "## Altro",
        "",
        "### Non è un traguardo",
    ].join("\n");
    assert.deepEqual(planGoals(plan, it), [{ name: "Ruoli e sessioni", phase: 2, description: "", closed: null }, { name: "Revisione e pulizia", phase: null, description: "", closed: null }]);
    assert.deepEqual(planPhases(plan), [{ number: 0, name: "Progettazione", outcome: "approvare" }, { number: 2, name: "Ruoli e sessioni", outcome: "giocare" }]);
    assert.equal(planUpdated(plan, it), "2026-10-29");
    assert.deepEqual(planGoals("## Goals\n\n### Ship (phase 1)\n\nThe first release.\n\n### Grow\n", en), [{ name: "Ship", phase: 1, description: "The first release.", closed: null }, { name: "Grow", phase: null, description: "", closed: null }]);
});

test("a goal closes with its day at the end of its heading, opens again, and keeps its name and phase", () => {
    const plan = "# Plan\n\n## Goals\n\n### Ship (phase 1)\n\nThe first release.\n\n### Grow\n";
    const closed = closeGoal(plan, en, "Ship", "2026-10-30");
    assert.equal(closed, "# Plan\n\n## Goals\n\n### Ship (phase 1) · done 2026-10-30\n\nThe first release.\n\n### Grow\n");
    assert.deepEqual(planGoals(closed, en).map((goal) => [goal.name, goal.phase, goal.closed]), [["Ship", 1, "2026-10-30"], ["Grow", null, null]]);
    assert.equal(closeGoal(closed, en, "Ship", null), plan);
    assert.equal(closeGoal(plan, en, "Elsewhere", "2026-10-30"), null);
    assert.equal(planGoals("## Traguardi\n\n### Il nucleo (fase 1) · fatto 2026-10-01\n", it)[0].closed, "2026-10-01");
});

test("the decisions give their rows with the why, the open points, and their numbering", () => {
    const text = [
        "| # | Decisione | Perché |",
        "|---|---|---|",
        "| 1 | Uno, con | dentro | il perché |",
        "| 3 | Tre senza perché |",
        "| 3 | Tre di nuovo | due volte |",
        "",
        "## Da decidere",
        "",
        "- Un punto aperto (Stefano, 12 ottobre)",
        "| 9 | non è una riga decisa | |",
    ].join("\n");
    const { decided, open, openLine } = parseDecisions(text, it);
    assert.deepEqual(decided.map((row) => [row.number, row.text, row.why]), [[1, "Uno, con | dentro", "il perché"], [3, "Tre senza perché", ""], [3, "Tre di nuovo", "due volte"]]);
    assert.deepEqual(open, [{ text: "Un punto aperto (Stefano, 12 ottobre)", line: 9 }]);
    assert.equal(openLine, 7);
    assert.deepEqual(numbering(decided), { twice: [3], missing: [2] });
    assert.deepEqual(citedDecisions("D-4, D-40 and XD-5 and D-4"), [4, 40, 4]);
    assert.equal(nextDecision(decided, [7]), 8);
    assert.equal(nextDecision([], []), 1);
});

test("a todo line of Crew reads and writes back, and an agent id gives a first name", () => {
    const line = "  - [ ] P2 · 2026-10-29 · see T-12";
    assert.equal(formatTodo(parseTodo(line)), line);
    assert.equal(formatTodo({ ...parseTodo(line), done: true }), "  - [x] 2026-10-29 · see T-12");
    assert.equal(parseTodo("- plain"), null);
    assert.equal(firstName("matteo-conti"), "Matteo");
});

test("the configuration fills the defaults, resolves the paths and takes the language's words with overrides", () => {
    const config = readConfig("language: it\ndocs: private/project\npeople: [Claude, Stefano]\nwords:\n  states:\n    postponed: Più tardi\nextensions: [private/game.mjs]\n", "F:\\work\\engine");
    assert.equal(config.root, "F:/work/engine");
    assert.equal(config.docs, "F:/work/engine/private/project");
    assert.equal(config.files.decisions, "F:/work/engine/private/project/DECISIONI.md");
    assert.equal(config.files.archive, "F:/work/engine/private/project/archivio/TASKS-archivio.md");
    assert.equal(config.words.states.postponed, "Più tardi");
    assert.equal(config.words.states.doing, "In corso");
    assert.deepEqual(config.people, ["Claude", "Stefano"]);
    assert.deepEqual(config.cites, ["F:/work/engine/private/project", "F:/work/engine/.claude/agent-memory"]);
    assert.deepEqual(config.extensions, ["F:/work/engine/private/game.mjs"]);
    assert.ok(config.skip.includes("archivio"));

    const plain = readConfig("", "/home/me/app");
    assert.equal(plain.language, "en");
    assert.equal(plain.files.decisions, "/home/me/app/project/DECISIONS.md");
    assert.throws(() => readConfig("- a\n- b\n", "/x"), /must be a map/);
});

test("each project's page has a port of its own from its folder, the same every time, unless the configuration names one", () => {
    const port = readConfig("", "F:/work/engine").page.port;
    assert.ok(port >= 5800 && port < 6000);
    assert.equal(readConfig("", "f:\\work\\engine\\").page.port, port);
    assert.notEqual(defaultPort("F:/work/other"), port);
    assert.equal(readConfig("page: { port: 5790 }\n", "F:/work/engine").page.port, 5790);
});

test("paths resolve against a folder, absolute ones stay, and show relative to the root", () => {
    assert.equal(resolve("/a/b", "../c/./d"), "/a/c/d");
    assert.equal(resolve("/a/b", "C:\\x\\y"), "C:/x/y");
    assert.equal(resolve("F:/r", "../sib/src"), "F:/sib/src");
    assert.equal(relativeTo("F:/r", "f:/r/docs/x.md"), "docs/x.md");
    assert.equal(relativeTo("F:/r", "F:/other/x.md"), "F:/other/x.md");
});

test("a message falls back to English, and keeps a name it is not given", () => {
    assert.equal(sayer("fr")("count", { count: 3 }), "3 tasks.");
    assert.equal(sayer("it")("count", {}), "{count} compiti.");
});

test("a phase is closed once it has goals and every one is closed", async () => {
    const { phaseStates } = await import("../lib/plan.mjs");
    const phases = [{ number: 1, name: "Core", outcome: "play" }, { number: 2, name: "More", outcome: "more" }, { number: 3, name: "Empty", outcome: "-" }];
    const goals = [{ name: "a", phase: 1, closed: "2026-10-30" }, { name: "b", phase: 1, closed: "2026-10-30" }, { name: "c", phase: 2, closed: null }, { name: "d", phase: 2, closed: "2026-10-30" }];
    assert.deepEqual(phaseStates(phases, goals).map((phase) => [phase.number, phase.goals, phase.closedGoals, phase.isClosed]), [[1, 2, 2, true], [2, 2, 1, false], [3, 0, 0, false]]);
});
