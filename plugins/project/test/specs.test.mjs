// The specifications: one a line with its number, numbered from a document the project already has, cited by tasks, decisions and code,
// covered by what does them; on a small project.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { citedSpecs, coverage, nextSpec, numberSpecs, parseSpecs } from "../lib/specs.mjs";
import { wordsOf } from "../lib/words.mjs";
import { splitFrontmatter } from "../lib/frontmatter.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const en = wordsOf("en");
let root;

test("a spec line reads with its number, section and group; a superseded one is dropped; SYS-3 is no spec", () => {
    const text = "# Specs\n\n> What it must do.\n\n## Functions\n\n**Dice**\n- S-1 · Any notation.\n  a line under it\n- S-2 · Superseded by D-4: hidden rolls.\n\n### Saves\n- S-3 · A zip at each checkpoint.\n- S-14 broken\n";
    const { specs, unread } = parseSpecs(text, en);
    assert.deepEqual(specs.map(({ number, section, group, line, superseded }) => [number, section, group, line, superseded]), [[1, "Functions", "Dice", 8, false], [2, "Functions", "Dice", 10, true], [3, "Functions", "Saves", 13, false]]);
    assert.deepEqual(unread.map((one) => one.line), [14]);
    assert.deepEqual(citedSpecs("see S-12 and S-3, not SYS-3 nor CS-4 nor S-"), [12, 3]);
    assert.equal(nextSpec(specs, [9]), 10);
});

test("a document is numbered: each list line at the start of a line, the text as it was; code blocks and lines under a spec left alone", () => {
    const text = "# Spec\n\nScope: what it does.\n\n## Functions\n**Memory**\n- A campaign is a folder.\n  - a detail\n- S-7 · already numbered\n* A log, append only.\n\n```\n- not a spec\n```\n";
    const { text: numbered, numbered: list } = numberSpecs(text, "S", 1);
    assert.equal(numbered, "# Spec\n\nScope: what it does.\n\n## Functions\n**Memory**\n- S-1 · A campaign is a folder.\n  - a detail\n- S-7 · already numbered\n- S-2 · A log, append only.\n\n```\n- not a spec\n```\n");
    assert.deepEqual(list.map((one) => [one.number, one.line]), [[1, 7], [2, 10]]);
});

test("a spec is covered by a task done or by code, in progress by an open task, not covered by nothing; a doc naming it covers nothing", () => {
    const specs = [{ number: 1, text: "a", superseded: false }, { number: 2, text: "b", superseded: false }, { number: 3, text: "c", superseded: false }, { number: 4, text: "d", superseded: true }];
    const tasks = [{ id: 1, state: "done", see: ["S-1"], text: "one" }, { id: 2, state: "todo", see: ["S-2", "D-1"], text: "two" }];
    const states = coverage(specs, { tasks, decisions: [{ number: 5, text: "Changes S-3.", why: "" }], files: [{ number: 3, file: "docs/GDD.md", line: 4, isCode: false }, { number: 2, file: "src/a.mjs", line: 1, isCode: true }], prefixes: { task: "T", decision: "D", spec: "S" } });
    assert.deepEqual(states.map((spec) => [spec.id, spec.state]), [["S-1", "done"], ["S-2", "done"], ["S-3", "open"], ["S-4", "dropped"]]);
    assert.deepEqual(states[2].decisions, ["D-5"]);
    assert.deepEqual(states[1].tasks.map((task) => task.id), ["T-2"]);
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-specs-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\ncites: [docs, src]\ndocuments:\n  - { name: Specification, path: docs/SPEC.md }\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n- [Spec](SPEC.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n| 1 | The log stays append only (S-2). | |\n\n## To decide\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n");
    put("docs/SPEC.md", "# The engine — Specification\n\n> What the tool does.\n\n## Functions\n\n**Memory**\n- A campaign is a folder of markdown files.\n- A log, append only.\n\n**Dice**\n- Any notation.\n");
    put("src/dice.mjs", "// S-3: any notation\nexport const dice = 1;\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("adopt makes a project's spec the core's SPECS.md: numbered, links and configuration following; then tasks cite specs, and the check and the page see them", async () => {
    const dry = run("specs.mjs", "adopt", "docs/SPEC.md");
    assert.match(dry.stdout, /docs\/SPEC\.md becomes docs\/SPECS\.md: 3 specifications numbered, in 1 sections[\s\S]*S-1 · A campaign[\s\S]*already name an S- number[\s\S]*Nothing changed/);
    assert.ok(existsSync(join(root, "docs/SPEC.md")));
    assert.match(run("specs.mjs", "adopt", "docs/SPEC.md", "--write").stdout, /3 specifications numbered in docs\/SPECS\.md; changed: docs\/SPECS\.md, docs\/README\.md, \.claude\/project\.yaml/);
    const { data, body } = splitFrontmatter(readFileSync(join(root, "docs/SPECS.md"), "utf8"));
    assert.equal(data.type, "specs");
    assert.match(body, /^# The engine — Specification\n\n> What the tool does\.\n\n## Functions\n\n\*\*Memory\*\*\n- S-1 · A campaign is a folder of markdown files\.\n- S-2 · A log, append only\.\n\n\*\*Dice\*\*\n- S-3 · Any notation\.\n$/);
    assert.match(readFileSync(join(root, "docs/README.md"), "utf8"), /\[Spec\]\(SPECS\.md\)/);
    assert.match(readFileSync(join(root, ".claude/project.yaml"), "utf8"), /path: docs\/SPECS\.md/);
    assert.ok(!existsSync(join(root, "docs/SPEC.md")));
    assert.match(run("specs.mjs", "adopt", "docs/SPECS.md").stderr, /already keeps its specifications in docs\/SPECS\.md/);

    // A task cites a spec; one that is not there is refused; show says what the task must satisfy.
    assert.equal(run("backlog.mjs", "add", "The log", "--see", "S-2", "--type", "feature", "--state", "done").status, 0);
    assert.equal(run("backlog.mjs", "add", "The search", "--type", "feature", "--see", "S-1").status, 0);
    assert.match(run("backlog.mjs", "add", "Nothing", "--type", "feature", "--see", "S-9").stderr, /S-9/);
    assert.match(run("backlog.mjs", "show", "T-2").stdout, /Does S-1: A campaign is a folder of markdown files\./);
    assert.match(run("specs.mjs", "add", "Campaigns export to a zip", "--section", "Functions").stdout, /S-4 added/);
    assert.match(readFileSync(join(root, "docs/SPECS.md"), "utf8"), /- S-3 · Any notation\.\n- S-4 · Campaigns export to a zip\n/);
    assert.match(run("specs.mjs", "list").stdout, /4 specifications: 2 covered, 1 in progress, 1 not covered\./);
    assert.match(run("specs.mjs", "show", "S-2").stdout, /S-2 \(line \d+, Functions\) · covered[\s\S]*T-1 · Done · The log[\s\S]*D-1/);

    // The check: an S- number the file does not have, anywhere, and a line that opens as a spec and does not read.
    put("src/save.mjs", "// S-77: the saves\n");
    const findings = JSON.parse(run("check.mjs", "--json").stdout);
    assert.ok(findings.some((finding) => finding.kind === "references" && /S-77/.test(finding.message) && finding.file === "src/save.mjs"));
    rmSync(join(root, "src/save.mjs"));

    // The page and the panel.
    const { loadProject } = await import("../services/config.mjs");
    const { collect } = await import("../page/collect.mjs");
    const config = loadProject(root).config;
    const page = await collect(config, (key) => key, []);
    assert.deepEqual(page.specs.counts, { total: 4, done: 2, doing: 1, open: 1 });
    assert.deepEqual(page.specs.list.find((spec) => spec.id === "S-3").files, [{ file: "src/dice.mjs", line: 1 }]);
    assert.deepEqual(page.board.find((task) => task.id === 2).specs, ["S-1"]);
    const panel = JSON.parse(run("snapshot.mjs", "--no-health").stdout);
    assert.deepEqual([panel.specs.total, panel.specs.done, panel.specs.inProgress.map((spec) => [spec.id, spec.tasks])], [4, 2, [["S-1", ["T-2"]]]]);
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
