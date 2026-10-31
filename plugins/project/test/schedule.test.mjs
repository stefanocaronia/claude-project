// Due days, types, the day a task started and tasks stuck in progress, decisions tied to tasks: the pure parts, then the commands and the
// check on a small project.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatLine, moveTasks, parseLine } from "../lib/backlog.mjs";
import { readConfig } from "../lib/config.mjs";
import { decisionLinks, splitLinks } from "../lib/links.mjs";
import { daysBetween, dueOf, isStale, typeColor } from "../lib/schedule.mjs";
import { wordsOf } from "../lib/words.mjs";

const it = wordsOf("it");
const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

test("a due day said from today: late, today, near, far; a task stuck in progress only when nobody holds it", () => {
    assert.equal(daysBetween("2026-10-28", "2026-11-02"), 5);
    assert.deepEqual(dueOf("2026-10-28", "2026-10-30"), { day: "2026-10-28", days: -2, isLate: true, isNear: false });
    assert.deepEqual(dueOf("2026-10-30", "2026-10-30"), { day: "2026-10-30", days: 0, isLate: false, isNear: true });
    assert.equal(dueOf("2026-11-20", "2026-10-30").isNear, false);
    assert.equal(dueOf(null, "2026-10-30"), null);
    const doing = { state: "doing", started: "2026-10-25" };
    assert.equal(isStale(doing, false, "2026-10-30", 3), true);
    assert.equal(isStale(doing, true, "2026-10-30", 3), false);
    assert.equal(isStale({ ...doing, started: "2026-10-28" }, false, "2026-10-30", 3), false);
    assert.equal(isStale({ state: "doing", started: null }, false, "2026-10-30", 3), false);
    assert.equal(typeColor("bug"), "#E5493A");
    assert.equal(typeColor("design"), "#8993A4");
});

test("a line keeps its due day, its type and the day it started; start sets the day, waiting clears it, done keeps it", () => {
    const line = "- T-4 · P1 · alto · Claude · 2026-10-29 · — · il login (due: 2026-11-15) (type: bug) · iniziato 2026-10-30";
    const task = parseLine(line, "doing", it);
    assert.deepEqual([task.text, task.due, task.type, task.started], ["il login", "2026-11-15", "bug", "2026-10-30"]);
    assert.equal(formatLine(task, it), line);
    assert.deepEqual(splitLinks("x (type: chore) (due: 2026-01-02)"), { text: "x", after: [], see: [], parent: null, issue: null, due: "2026-01-02", type: "chore", by: null, fields: {} });

    const todo = { id: 1, state: "todo", started: null, done: null };
    const [started] = moveTasks([todo], [1], "doing", "2026-10-30").tasks;
    assert.equal(started.started, "2026-10-30");
    assert.equal(moveTasks([started], [1], "doing", "2026-11-02").tasks[0].started, "2026-10-30");
    assert.equal(moveTasks([started], [1], "done", "2026-11-02").tasks[0].started, "2026-10-30");
    assert.equal(moveTasks([started], [1], "postponed", "2026-11-02").tasks[0].started, null);
});

test("a project's types are the language's five and its own; decisions and tasks tie both ways", () => {
    assert.deepEqual(readConfig("language: it\ntypes: { design: Design }\n", "/p").types, { bug: "bug", feature: "funzione", chore: "manutenzione", research: "ricerca", test: "prova", design: "Design" });
    const { byTask, byDecision } = decisionLinks([{ id: 1, see: ["D-2", "D-9"] }, { id: 3, see: [] }], [{ number: 2, text: "Real dice.", why: "" }, { number: 5, text: "As T-3 asks", why: "and T-99" }], { task: "T", decision: "D" });
    assert.deepEqual([...byTask.entries()], [["T-1", ["D-2"]], ["T-3", ["D-5"]]]);
    assert.deepEqual([...byDecision.entries()], [["D-2", ["T-1"]], ["D-5", ["T-3"]]]);
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-schedule-"));
    put(".claude/project.yaml", "language: it\ndocs: docs\npeople: [Claude]\ntypes: { design: Design }\n");
    put("docs/README.md", "# Documenti\n\n- [Piano](PLAN.md)\n- [Compiti](TASKS.md)\n- [Decisioni](DECISIONI.md)\n");
    put("docs/PLAN.md", "# Piano\n\n## Traguardi\n\n### Nucleo (fase 1)\n");
    put("docs/DECISIONI.md", "# Decisioni\n\n| # | Decisione | Perché |\n|---|---|---|\n| 1 | Dadi veri, T-2. | |\n");
    put("docs/TASKS.md", "# Backlog\n\n## In corso\n\n- T-1 · P1 · alto · Claude · 2026-10-01 · Nucleo · fermo · iniziato 2026-01-01\n\n## Da fare\n\n- T-2 · P2 · medio · Claude · 2026-10-01 · Nucleo · i dadi\n\n## Rimandati\n\n## Fatti\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("set takes a due day and a type by its key or its name, refuses a type the project lacks; show, list and the check say them", () => {
    assert.match(run("set", "T-2", "--due", "2026-01-02", "--type", "funzione"), /· i dadi \(due: 2026-01-02\) \(type: feature\)$/m);
    assert.match(run("set", "T-2", "--type", "design"), /\(type: design\)$/m);
    assert.match(fails("set", "T-2", "--type", "estetica"), /Il tipo «estetica» non è del progetto: bug, feature, chore, research, test, design/);
    assert.match(fails("set", "T-2", "--due", "domani"), /Un due nomina un giorno/);

    const shown = run("show", "T-2", "T-1");
    assert.match(shown, /tipo: Design/);
    assert.match(shown, /scade il 2026-01-02 \(in ritardo di \d+ g\)/);
    assert.match(shown, /decisioni: D-1/);
    assert.match(shown, /In corso dal 2026-01-01 e nessuno lo tiene/);
    assert.match(run("list"), /· fermo · iniziato 2026-01-01 {2}⏸ In corso dal 2026-01-01/);

    const findings = JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8", env: environment() }).stdout).filter((finding) => finding.kind === "time").map((finding) => finding.message);
    assert.ok(findings.some((message) => /T-2 scadeva il 2026-01-02 ed è ancora aperto/.test(message)));
    assert.ok(findings.some((message) => /T-1 è in corso dal 2026-01-01 e nessuno lo tiene/.test(message)));

    run("todo", "T-1");
    assert.doesNotMatch(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /iniziato/);
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
    return { ...rest, PROJECT_NO_GH: "1" };
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
