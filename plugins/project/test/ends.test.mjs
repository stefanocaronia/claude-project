// A task's start and end keep the backlog tidy as the work goes: what start and done say of the waits, the code, the doubles and the
// tasks freed, and what committed says of a commit that does a task still open.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { similarTasks } from "../lib/backlog.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-ends-"));
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Ann]\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n| 1 | Real dice. | |\n");
    put("docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n"
        + "- T-1 · P1 · high · Claude · 2026-10-01 · Core · the dice roller with modifiers\n"
        + "- T-2 · P2 · medium · Claude · 2026-10-01 · Core · the roll log (after: T-1)\n"
        + "- T-3 · P3 · low · Ann · 2026-10-01 · Core · dice roller modifiers shown on screen\n"
        + "- T-4 · P2 · low · Ann · 2026-10-01 · Core · the save file\n\n## Postponed\n\n## Done\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-q", "-m", "The docs");
});

after(() => rmSync(root, { recursive: true, force: true }));

test("two texts are alike when most of the shorter one's words are the other's, two at least", () => {
    const alike = similarTasks({ text: "the dice roller with modifiers" }, [{ text: "dice roller modifiers shown on screen" }, { text: "the save file" }, { text: "dice somewhere" }]);
    assert.deepEqual(alike.map((task) => task.text), ["dice roller modifiers shown on screen"]);
});

test("start says the waits still open, the commits already citing the task and a task like it; done says what it frees and what reads like it", () => {
    const started = run("start", "T-2");
    assert.match(started, /T-2 waits for T-1, still open/);
    assert.doesNotMatch(started, /cited by/);

    commit("The roller (T-1)");
    const first = run("start", "T-1");
    assert.match(first, /T-1 is already cited by 1 commits/);
    assert.match(first, /T-1 reads like T-3, still open/);

    const done = run("done", "T-1");
    assert.match(done, /T-2 waited for T-1 and can start now/);
    assert.match(done, /T-3, still open, reads like T-1/);
    assert.doesNotMatch(run("done", "T-4"), /reads like|can start/);
});

test("committed names the tasks still open that the last commit does, and nothing once they are closed", () => {
    commit("The log (T-2), and the screen, see T-3");
    assert.match(run("committed"), /This commit does T-2, still open/);
    assert.doesNotMatch(run("committed"), /T-3/);
    run("done", "T-2");
    assert.equal(run("committed"), "");
});

function commit(message)
{
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-q", "--allow-empty", "-m", message);
}

function git(...args)
{
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function run(...args)
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    return execFileSync(process.execPath, [join(scripts, "backlog.mjs"), ...args], { cwd: root, encoding: "utf8", env }).trim();
}

function put(path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
