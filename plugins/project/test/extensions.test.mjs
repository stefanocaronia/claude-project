// What a project adds to the plugin without changing it: its own checks, its own fields on a task, and the formats its backlog is
// written in and read from; on a small project with one extension.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-extensions-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Ann]\nextensions: [tools/game.mjs]\nfields: { system: { name: System, values: [5e, ironsworn] }, area: Area }\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n\n## To decide\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice (system: 5e)\n- T-2 · P2 · medium · Ann · 2026-10-01 · Core · the log\n\n## Postponed\n\n## Done\n");
    put("tools/game.mjs", [
        "export const id = \"game\";",
        "export function check({ config }) { return [{ severity: \"warning\", file: \"docs/TASKS.md\", line: 7, message: \"a system without a playtest\" }]; }",
        "export const exporters = { lines: (tasks) => tasks.map((task) => `${task.id}: ${task.text}`).join(\"\\n\") };",
        "export const importers = { lines: (text) => text.split(\"\\n\").filter(Boolean).map((line) => ({ text: line, type: \"research\" })) };",
    ].join("\n"));
});

after(() => rmSync(root, { recursive: true, force: true }));

test("an extension's checks join the health under its id", () => {
    const findings = JSON.parse(run("check.mjs", "--json").stdout);
    assert.ok(findings.some((finding) => finding.kind === "game" && finding.severity === "warning" && finding.file === "docs/TASKS.md" && finding.line === 7 && finding.message === "a system without a playtest"));
    assert.match(run("check.mjs").stdout, /\[game\] docs\/TASKS\.md:7 {2}a system without a playtest/);
});

test("a project's own field reads from the end of a line, is set by its key, keeps to its values, and shows", () => {
    assert.match(run("backlog.mjs", "set", "T-2", "--system", "ironsworn", "--area", "the log book").stdout, /· the log \(system: ironsworn\) \(area: the log book\)$/m);
    assert.match(run("backlog.mjs", "set", "T-2", "--text", "the log, again").stdout, /· the log, again \(system: ironsworn\) \(area: the log book\)$/m);
    assert.match(run("backlog.mjs", "set", "T-2", "--system", "gurps").stderr, /The System «gurps» is not one of the project's: 5e, ironsworn/);
    assert.match(run("backlog.mjs", "set", "T-2", "--area", "").stdout, /· the log, again \(system: ironsworn\)$/m);
    assert.match(run("backlog.mjs", "show", "T-1").stdout, /System: 5e/);
    assert.deepEqual(JSON.parse(run("backlog.mjs", "list", "--json").stdout).map((task) => task.fields), [{ system: "5e" }, { system: "ironsworn" }]);
    assert.match(run("backlog.mjs", "add", "the map", "--type", "feature", "--system", "5e").stdout, /· the map \(type: feature\) \(by: Claude\) \(system: 5e\)$/m);
});

test("the backlog goes out as JSON, CSV or an extension's format, and comes in from them as new tasks, all or none", () => {
    const csv = run("backlog.mjs", "export", "--format", "csv").stdout;
    assert.match(csv, /^id,state,priority,effort,to,created,goal,type,due,parent,after,see,by,text,started,done,archived,system,area$/m);
    assert.match(csv, /^T-1,todo,P1,high,Claude,2026-10-01,Core,,,,,,,the dice,,,,5e,$/m);
    assert.deepEqual(JSON.parse(run("backlog.mjs", "export").stdout).map((task) => task.id), ["T-1", "T-2", "T-3"]);
    assert.match(run("backlog.mjs", "export", "--format", "lines").stdout, /^T-1: the dice$/m);
    assert.match(run("backlog.mjs", "export", "--format", "xml").stderr, /No format «xml»: json, csv, lines/);

    put("in.csv", "text,priority,type,system,to\n\"the rules, whole\",P1,bug,ironsworn,Ann\nthe index,,research,,\n");
    assert.match(run("backlog.mjs", "import", "in.csv", "--by", "Ann").stdout, /2 tasks imported: T-4, T-5/);
    const tasks = readFileSync(join(root, "docs/TASKS.md"), "utf8");
    assert.match(tasks, /^- T-4 · P1 · medium · Ann · \d{4}-\d{2}-\d{2} · — · the rules, whole \(type: bug\) \(by: Ann\) \(system: ironsworn\)$/m);
    assert.match(tasks, /^- T-5 · P2 · medium · Claude · \d{4}-\d{2}-\d{2} · — · the index \(type: research\) \(by: Ann\)$/m);
    put("in.txt", "one idea\nanother\n");
    assert.match(run("backlog.mjs", "import", "in.txt", "--format", "lines").stdout, /2 tasks imported: T-6, T-7/);
    put("bad.json", JSON.stringify([{ text: "fine" }, { text: "wrong", system: "gurps" }]));
    assert.match(run("backlog.mjs", "import", "bad.json").stderr, /The System «gurps»/);
    assert.doesNotMatch(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /fine/);
    // A file that starts with a byte-order mark, as PowerShell writes it, reads as any other.
    put("bom.json", `${String.fromCharCode(0xfeff)}${JSON.stringify([{ text: "from PowerShell" }])}`);
    assert.match(run("backlog.mjs", "import", "bom.json").stdout, /imported: T-8\b/);
});

test("an import from another tool: a preview first, the closed left out or archived, an epic a large task, the note, no double", () => {
    put("board.json", JSON.stringify([
        { key: "PRJ-1", text: "the epic", url: "https://example.test/PRJ-1", description: "All of it." },
        { key: "PRJ-2", text: "a story", parent: "PRJ-1", after: "PRJ-3" },
        { key: "PRJ-3", text: "a done one", state: "Closed", done: "2026-09-01" },
    ]));
    const preview = run("backlog.mjs", "import", "board.json", "--preview").stdout;
    assert.match(preview, /T-9 · .* · the epic \(by: Claude\) \[To do\] {2}\+ note/);
    assert.match(preview, /1 closed left out/);
    assert.match(preview, /2 tasks to import; nothing written/);
    assert.doesNotMatch(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /the epic/);
    // The story's wait for one closed and left out is over: it waits for nothing.
    assert.match(preview, /T-10 · .* · a story \(in: T-9\) \(by: Claude\) \[/);
    assert.match(run("backlog.mjs", "import", "board.json", "--done").stdout, /3 tasks imported: T-9, T-10, T-11/);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /^- T-10 · .* · a story \(after: T-11\) \(in: T-9\)/m);
    assert.match(readFileSync(join(root, "docs/tasks/T-9.md"), "utf8"), /All of it\.\n\nOrigin: PRJ-1 · https:\/\/example\.test\/PRJ-1\n/);
    const again = run("backlog.mjs", "import", "board.json", "--done").stdout;
    assert.match(again, /3 already imported, left out: PRJ-1 \(T-9\), PRJ-2 \(T-10\), PRJ-3 \(T-11\)/);
    assert.match(again, /Nothing new to import/);
});

test("a task deleted is gone, its note too, unless another cites it", () => {
    assert.match(run("backlog.mjs", "delete", "T-9").stderr, /T-9 is cited by T-10/);
    assert.match(run("backlog.mjs", "delete", "T-10", "T-9").stdout, /2 deleted: T-10, T-9/);
    assert.doesNotMatch(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /the epic|a story/);
    assert.throws(() => readFileSync(join(root, "docs/tasks/T-9.md")));
});

function run(script, ...args)
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    return spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env: { ...env, PROJECT_NO_GH: "1" } });
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
