// Versions and releases as the trade keeps them: the next number from the work done, the notes by kind, a release that groups the work
// since the last one; on a small project.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readConfig } from "../lib/config.mjs";
import { compareContract, contractState, contractValue, pointerValue } from "../lib/contracts.mjs";
import { compareVersions, messageSummary, nextVersion, parseRelease, renderRelease, unreleased } from "../lib/release.mjs";
import { splitFrontmatter } from "../lib/frontmatter.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

test("the next version follows Semantic Versioning: a feature is minor, fixes alone a patch, a break major, minor before 1.0", () => {
    assert.deepEqual(nextVersion(null, []), { version: "0.1.0", kind: "first" });
    assert.deepEqual(nextVersion("0.7.1", [{ type: "feature" }, { type: "bug" }]), { version: "0.8.0", kind: "minor" });
    assert.deepEqual(nextVersion("0.7.1", [{ type: "bug" }, { type: "chore" }, { type: null }]), { version: "0.7.2", kind: "patch" });
    assert.deepEqual(nextVersion("0.7.1", [], true), { version: "0.8.0", kind: "breaking" });
    assert.deepEqual(nextVersion("1.4.2", [], true), { version: "2.0.0", kind: "breaking" });
    assert.ok(compareVersions("0.10.0", "0.9.3") > 0);
});

test("the notes list the work by kind, and a release read back says which tasks it holds", () => {
    const names = { breaking: "Breaking", added: "Added", fixed: "Fixed", maintenance: "Maintenance", other: "Other" };
    const text = renderRelease({ version: "0.8.0", day: "2026-11-02", summary: "Extensions grow.", breaking: ["fields: is a map"], tasks: [{ id: 3, type: "bug", text: "the fix" }, { id: 2, type: "feature", text: "the field" }, { id: 4, type: "test", text: "a playtest" }], names });
    assert.equal(text, "# v0.8.0 · 2026-11-02\n\nExtensions grow.\n\n## Breaking\n\n- fields: is a map\n\n## Added\n\n- T-2 · the field\n\n## Fixed\n\n- T-3 · the fix\n\n## Other\n\n- T-4 · a playtest\n");
    assert.deepEqual(parseRelease(text), { version: "0.8.0", day: "2026-11-02", summary: "Extensions grow.", tasks: [2, 3, 4] });
    assert.deepEqual(unreleased([{ id: 1, done: "2026-10-01" }, { id: 2, done: "2026-10-02" }, { id: 5, done: null }, { id: 6, done: "2026-10-01" }], [{ tasks: [2] }]).map((task) => task.id), [1, 6]);
});

test("a contract is a number read from a file, by a JSON pointer or a regex's group; one gone up asks a minor version, after 1.0 too", () => {
    assert.equal(contractValue('{ "engine": { "api": 3 } }', { file: "package.json", pointer: "/engine/api" }), "3");
    assert.equal(contractValue("engine:\n  api: 2.1\n", { file: "engine.yaml", pointer: "/engine/api" }), "2.1");
    assert.equal(contractValue("export const SAVE_FORMAT = 7;\n", { file: "src/save.js", pattern: "SAVE_FORMAT = (\\d+)" }), "7");
    assert.equal(contractValue('{ "engine": { "api": "next" } }', { file: "package.json", pointer: "/engine/api" }), null);
    assert.equal(contractValue("{ broken", { file: "package.json", pointer: "/engine/api" }), null);
    assert.equal(contractValue("", { file: "src/save.js", pattern: "(\\d+)" }), null);
    assert.equal(pointerValue({ "a/b": { "~c": 1 } }, "/a~1b/~0c"), 1);
    assert.equal(pointerValue({ a: 1 }, "/a/b"), undefined);
    assert.ok(compareContract("2.10", "2.9") > 0 && compareContract("3", "3.0") === 0 && compareContract("1", "2") < 0);
    assert.deepEqual(["4", "2", "3", null].map((current) => contractState({ name: "API", file: "x" }, current, "3").state), ["raised", "lowered", "same", "unread"]);
    assert.equal(contractState({ name: "API", file: "x" }, "3", null).state, "new");
    assert.deepEqual(nextVersion("1.4.2", [{ type: "bug" }], false, true), { version: "1.5.0", kind: "contract" });
    assert.deepEqual(nextVersion("0.4.2", [{ type: "feature" }], false, true), { version: "0.5.0", kind: "minor" });
    const names = { breaking: "Breaking", contracts: "Compatibility", added: "Added", fixed: "Fixed", maintenance: "Maintenance", other: "Other" };
    const contracts = [{ name: "API", before: "3", current: "4", state: "raised" }, { name: "Save", before: "2", current: "2", state: "same" }];
    assert.equal(renderRelease({ version: "1.5.0", day: "2026-11-02", summary: "", contracts, tasks: [{ id: 1, type: "bug", text: "the fix" }], names }), "# v1.5.0 · 2026-11-02\n\n## Compatibility\n\n- API: 3 → 4\n\n## Fixed\n\n- T-1 · the fix\n");
});

test("the configuration says whether the project releases, the checks before one and its contracts; a wrong shape is told", () => {
    const empty = readConfig("", "/p");
    assert.deepEqual([empty.release, empty.contracts], [{ show: null, run: [], remember: [] }, []]);
    assert.equal(readConfig("release: false\n", "/p").release.show, false);
    assert.deepEqual(readConfig("release:\n  run: npm test\n  remember: [Read the changelog]\n", "/p").release, { show: null, run: ["npm test"], remember: ["Read the changelog"] });
    assert.deepEqual(readConfig("contracts:\n  - { name: API, file: package.json, pointer: /engine/api }\n", "/p").contracts, [{ name: "API", file: "/p/package.json", pointer: "/engine/api", pattern: null }]);
    assert.throws(() => readConfig("release: [npm test]\n", "/p"), /release is true, false or a map/);
    assert.throws(() => readConfig("contracts: { name: API }\n", "/p"), /contracts must be a list/);
    assert.throws(() => readConfig("contracts:\n  - { name: API, file: a.json, pointer: /a, pattern: (x) }\n", "/p"), /one of pointer/);
});

test("a project that does not release shows no versions until its first release or release: true; the checks before one are listed", async () => {
    const book = mkdtempSync(join(tmpdir(), "claude-project-book-"));
    const write = (path, text) => {
        mkdirSync(dirname(join(book, path)), { recursive: true });
        writeFileSync(join(book, path), text);
    };
    const release = (...args) => spawnSync(process.execPath, [join(scripts, "release.mjs"), ...args], { cwd: book, encoding: "utf8", env: env() });
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\n");
    write("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n\n- T-1 · P2 · medium · Claude · 2026-10-01 · — · chapter one (type: feature) · done 2026-10-10\n");
    assert.match(release("status").stdout, /This project shows no releases/);
    const { loadProject, showsReleases } = await import("../scripts/project.mjs");
    assert.equal(showsReleases(loadProject(book).config), false);
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\nrelease: true\n");
    assert.match(release("status").stdout, /No release yet[\s\S]*Suggested: v0\.1\.0/);
    // The checks before a release declare that the project releases.
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\nrelease:\n  run: [npm test]\n  remember: [Read the changelog]\n");
    assert.match(release("status").stdout, /No release yet[\s\S]*Before the release, Claude runs: npm test\. A failure stops the release\.\nAnd asks the user: Read the changelog\./);
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\nrelease:\n  show: false\n  run: [npm test]\n");
    assert.match(release("status").stdout, /This project shows no releases/);
    rmSync(book, { recursive: true, force: true });
});

test("a contract gone up makes a release due and a minor version, its number kept in the notes; the check flags one unread or gone down", () => {
    const engine = mkdtempSync(join(tmpdir(), "claude-project-contracts-"));
    const write = (path, text) => {
        mkdirSync(dirname(join(engine, path)), { recursive: true });
        writeFileSync(join(engine, path), text);
    };
    const release = (...args) => spawnSync(process.execPath, [join(scripts, "release.mjs"), ...args], { cwd: engine, encoding: "utf8", env: env() });
    const check = () => JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: engine, encoding: "utf8", env: env() }).stdout).filter((finding) => finding.kind === "contracts");
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\ncontracts:\n  - { name: API, file: engine.json, pointer: /engine/api }\n  - { name: Saves, file: src/save.js, pattern: 'SAVE_FORMAT = (\\d+)' }\n");
    write("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    write("docs/PLAN.md", "# Plan\n\n## Goals\n");
    write("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n\n## To decide\n");
    write("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n\n- T-1 · P2 · medium · Claude · 2026-10-01 · — · the dice (type: feature) · done 2026-10-10\n");
    write("engine.json", JSON.stringify({ engine: { api: 3 } }));
    write("src/save.js", "export const SAVE_FORMAT = 2;\n");
    assert.match(release("status").stdout, /No release yet[^\n]*\nAPI: 3, recorded at the next release\.\nSaves: 2, recorded/);
    assert.match(release("write", "0.1.0", "--summary", "The dice.").stdout, /v0\.1\.0/);
    assert.deepEqual(splitFrontmatter(readFileSync(join(engine, "docs/releases/v0.1.0.md"), "utf8")).data.contracts, { API: 3, Saves: 2 });
    assert.match(release("status").stdout, /Last release: v0\.1\.0[\s\S]*Nothing done since the last release/);

    // The API goes up with no task done: a minor version, due for it alone, and the notes say it.
    write("engine.json", JSON.stringify({ engine: { api: 4 } }));
    assert.match(release("status").stdout, /API: 3 → 4, since the last release[\s\S]*Suggested: v0\.2\.0, a minor version: a contract went up\.[\s\S]*A release is due: API went up\./);
    assert.match(release("notes").stdout, /## Compatibility\n\n- API: 3 → 4/);
    assert.deepEqual(check(), []);

    // A contract gone down, or no longer read, is flagged; a release is not written while one does not read.
    write("src/save.js", "export const SAVE_FORMAT = 1;\n");
    assert.match(check().map((finding) => finding.message).join("\n"), /«Saves» went down since the last release, 2 → 1/);
    write("src/save.js", "export const FORMAT = 2;\n");
    assert.match(check().map((finding) => finding.message).join("\n"), /«Saves» does not read in src\/save\.js/);
    assert.match(release("write", "0.2.0").stderr, /«Saves» does not read in src\/save\.js/);
    write("src/save.js", "export const SAVE_FORMAT = 2;\n");
    assert.match(release("write", "0.2.0", "--summary", "The API grows.").stdout, /v0\.2\.0/);
    assert.deepEqual(splitFrontmatter(readFileSync(join(engine, "docs/releases/v0.2.0.md"), "utf8")).data.contracts, { API: 4, Saves: 2 });
    assert.match(release("status").stdout, /Last release: v0\.2\.0[\s\S]*Nothing done since the last release/);
    rmSync(engine, { recursive: true, force: true });
});

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-release-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\nrelease: true\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1) · done 2026-10-20\n\n### Next (phase 2)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n\n## To decide\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-3 · P2 · medium · Claude · 2026-10-01 · Next · the log\n\n## Postponed\n\n## Done\n\n- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice (type: feature) · done 2026-10-10\n- T-2 · P2 · medium · Claude · 2026-10-01 · Core · a crash (type: bug) · done 2026-10-12\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("a release groups the work since the last one: status says what is done and whether one is due, write keeps the notes, the next starts after", () => {
    assert.match(run("status").stdout, /No release yet[\s\S]*Done since: 2 tasks \(1 features, 1 fixes[\s\S]*Suggested: v0\.1\.0[\s\S]*A release is due: closed since the last one, Core/);
    assert.match(run("write", "0.1.0", "--summary", "The dice roll.").stdout, /docs\/releases\/v0\.1\.0\.md written: 2 tasks in v0\.1\.0/);
    const { data, body: notes } = splitFrontmatter(readFileSync(join(root, "docs/releases/v0.1.0.md"), "utf8"));
    assert.deepEqual([data.type, data.description], ["release", "The dice roll."]);
    assert.match(notes, /^# v0\.1\.0 · \d{4}-\d{2}-\d{2}\n\nThe dice roll\.\n\n## Added\n\n- T-1 · the dice\n\n## Fixed\n\n- T-2 · a crash\n$/);
    assert.match(run("status").stdout, /Last release: v0\.1\.0[\s\S]*Nothing done since the last release/);
    assert.match(run("write", "0.1.1").stderr, /Nothing done since the last release/);

    spawnSync(process.execPath, [join(scripts, "backlog.mjs"), "set", "T-3", "--type", "chore"], { cwd: root, env: env() });
    spawnSync(process.execPath, [join(scripts, "backlog.mjs"), "done", "T-3"], { cwd: root, env: env() });
    assert.match(run("status").stdout, /Suggested: v0\.1\.1, a patch[\s\S]*release when the work done makes a whole/);
    assert.match(run("notes").stdout, /^# v0\.1\.1 · [\s\S]*## Maintenance\n\n- T-3 · the log\n$/);
    assert.match(run("write", "0.0.9").stderr, /v0\.0\.9 does not come after the last release, v0\.1\.0/);
    assert.match(run("write", "next").stderr, /«next» is not a version/);
    assert.ok(!existsSync(join(root, "docs/releases/v0.0.9.md")));
    // The releases' folder is no doc of the index.
    assert.ok(!JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8", env: env() }).stdout).some((finding) => /releases/.test(finding.file ?? "")));
});

test("a version without notes takes its summary from a message: the name and version it opens with gone, its sentences while they fit", () => {
    assert.equal(messageSummary("rpg-engine 0.9.0: a game system's text in the campaign's language (D-542), and an effect that ended named in the journal.\n\nMore.", "0.9.0"), "A game system's text in the campaign's language (D-542), and an effect that ended named in the journal.");
    assert.equal(messageSummary("v0.9.0", "0.9.0"), "");
    assert.equal(messageSummary("Release 0.9.0", "0.9.0"), "");
    const long = messageSummary(`engine 1.0.0: the first. ${"A long sentence that goes on and on. ".repeat(10)}`, "1.0.0");
    assert.ok(long.length <= 200 && long.startsWith("The first. A long sentence"));
});

test("the repo's tags are the versions, the notes go with theirs; with neither, the package's version; a tag holds the work done by its day", { skip: spawnSync("git", ["--version"]).status === 0 ? false : "no git here" }, async () => {
    const tagged = mkdtempSync(join(tmpdir(), "claude-project-tags-"));
    const write = (path, text) => {
        mkdirSync(dirname(join(tagged, path)), { recursive: true });
        writeFileSync(join(tagged, path), text);
    };
    const release = (...args) => spawnSync(process.execPath, [join(scripts, "release.mjs"), ...args], { cwd: tagged, encoding: "utf8", env: env() });
    write(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude]\n");
    write("package.json", JSON.stringify({ name: "engine", version: "1.2.3" }));
    write("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n\n- T-1 · P2 · medium · Claude · 2026-10-01 · — · the dice (type: feature) · done 2026-10-10\n- T-2 · P2 · medium · Claude · 2026-10-01 · — · the map (type: feature) · done 2099-01-01\n");
    assert.match(release("status").stdout, /Last release: v1\.2\.3[\s\S]*Done since: 2 tasks[\s\S]*Suggested: v1\.3\.0/);

    const git = (...args) => spawnSync("git", ["-C", tagged, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
    git("tag", "v0.9.1");
    git("tag", "weather-v0.2.3");
    git("tag", "-a", "v0.9.0", "-m", "v0.9.0");
    // A tag without notes: its summary from its own message when it says more than the version, else from its commit's.
    const { readReleases, loadProject } = await import("../scripts/project.mjs");
    const releases = readReleases(loadProject(tagged).config);
    assert.deepEqual(releases.map(({ version, summary, source }) => [version, summary, source]), [["0.9.0", "One", "commit"], ["0.9.1", "One", "commit"]]);
    // The tag holds T-1, done before its day; T-2 is still to release, from v0.9.1 and not from the package.
    assert.match(release("status").stdout, /Last release: v0\.9\.1[\s\S]*Done since: 1 tasks[\s\S]*Suggested: v0\.10\.0/);
    assert.match(release("write", "0.10.0", "--summary", "The map comes.").stdout, /v0\.10\.0/);
    assert.match(release("status").stdout, /Last release: v0\.10\.0[\s\S]*Nothing done since the last release/);
    rmSync(tagged, { recursive: true, force: true });
});

function env()
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...rest } = process.env;
    return { ...rest, PROJECT_NO_GH: "1" };
}

function run(...args)
{
    return spawnSync(process.execPath, [join(scripts, "release.mjs"), ...args], { cwd: root, encoding: "utf8", env: env() });
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
