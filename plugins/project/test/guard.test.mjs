// The core docs kept from a direct read or write: what the panel's hook refuses, and what it lets go.
import assert from "node:assert/strict";
import { test } from "node:test";
import { guardCall } from "../lib/guard.mjs";

const files = [
    { path: "project/TASKS.md", script: "backlog", owned: true },
    { path: "project/archive/TASKS-archive.md", script: "backlog", owned: true },
    { path: "project/DECISIONS.md", script: "decisions", owned: false },
    { path: "project/SPECS.md", script: "specs", owned: false },
];
const key = (call) => guardCall(call, files)?.key ?? null;

test("the backlog and its archive are the backlog's: no Read, Grep, Edit or Write of them, whatever the path's spelling", () => {
    assert.deepEqual(guardCall({ tool: "Read", file_path: "F:\\sviluppo\\AI\\claude-project\\project\\TASKS.md" }, files), { key: "guardOwned", file: "project/TASKS.md", script: "backlog" });
    assert.equal(key({ tool: "Read", file_path: "/f/sviluppo/AI/claude-project/project/tasks.md", offset: 10, limit: 5 }), "guardOwned");
    assert.equal(key({ tool: "Edit", file_path: "F:/x/project/TASKS.md" }), "guardOwned");
    assert.equal(key({ tool: "Write", file_path: "F:/x/project/archive/TASKS-archive.md" }), "guardOwned");
    assert.equal(key({ tool: "Grep", pattern: "T-15", path: "project/TASKS.md" }), "guardOwned");
    assert.equal(key({ tool: "Grep", pattern: "T-15", glob: "**/TASKS.md" }), "guardOwned");
    // Another file of the same name elsewhere, or a folder, goes.
    assert.equal(key({ tool: "Read", file_path: "F:/x/other/TASKS.md" }), null);
    assert.equal(key({ tool: "Grep", pattern: "T-15", path: "project" }), null);
});

test("the decisions and the specs are searched through their scripts, and read whole or in part to be edited", () => {
    assert.equal(key({ tool: "Grep", pattern: "D-14", path: "F:/x/project/DECISIONS.md" }), "guardSearch_decisions");
    assert.equal(key({ tool: "Bash", command: "grep -n S-3 project/SPECS.md" }), "guardSearch_specs");
    assert.equal(key({ tool: "Read", file_path: "F:/x/project/DECISIONS.md", offset: 28, limit: 1 }), null);
    assert.equal(key({ tool: "Edit", file_path: "F:/x/project/SPECS.md" }), null);
});

test("a shell reads a guarded file with grep, cat, sed, Get-Content, a redirect or node -e; git and the scripts go", () => {
    for (const command of [
        "cd /f/x && grep -nE \"^- T-(15|5[3-9]) \" project/TASKS.md",
        "cat project/TASKS.md | head -20",
        "sed -i 's/a/b/' project/releases/v1.md project/TASKS.md",
        "Get-Content project\\TASKS.md -TotalCount 20",
        "echo '- T-9 · x' >> project/TASKS.md",
        "node -e \"console.log(require('fs').readFileSync('project/TASKS.md','utf8'))\"",
        "/usr/bin/grep T-1 TASKS.md",
    ]) {
        assert.equal(key({ tool: "Bash", command }), "guardOwned", command);
    }

    assert.equal(key({ tool: "PowerShell", command: "Select-String -Path project/DECISIONS.md -Pattern D-14" }), "guardSearch_decisions");

    for (const command of [
        "git add project/TASKS.md project/DECISIONS.md && git commit -q -F msg.txt",
        "git diff project/TASKS.md",
        "node plugins/project/scripts/backlog.mjs show T-15 | grep goal",
        "grep -n releaseHidden lib/messages.mjs",
        "cat project/TASKS-notes.txt",
    ]) {
        assert.equal(key({ tool: "Bash", command }), null, command);
    }
});
