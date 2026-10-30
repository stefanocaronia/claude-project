// The page as a browser draws it: a small project served, opened in a headless Chrome or Edge, its DOM read once the data is drawn and its
// console read for errors. Without such a browser on the machine (CHROME_PATH names one), the test is skipped.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const browser = findBrowser();

test("the page draws a small project's data in every tab, without an error in its console", { skip: browser ? false : "no Chrome or Edge here: set CHROME_PATH to run it" }, async () => {
    const root = project();
    const noGh = process.env.PROJECT_NO_GH;
    process.env.PROJECT_NO_GH = "1";
    const { pageServer } = await import("../page/serve.mjs");
    const { server } = await pageServer(root);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));

    try {
        const { dom, console } = await open(`http://127.0.0.1:${server.address().port}/`, root);
        assert.deepEqual(console, [], `the page's console said:\n${console.join("\n")}`);

        // Every tab drawn, each its panel.
        for (const tab of ["overview", "board", "rhythm", "decisions", "tasks", "health", "documents"]) {
            assert.match(dom, new RegExp(`id="panel-${tab}"`), `the ${tab} tab is missing`);
        }

        // What the data carries, drawn: tasks, a large task and its parts, a wait, a link, a note, a closed goal, a decision to take.
        assert.match(dom, /T-1<\/span>The release/);
        // A large task's parts as a chip that folds them, shown while one is in progress.
        assert.match(dom, /data-fold="1" aria-expanded="true"[^>]*><span aria-hidden="true">▾ 0\/2/);
        assert.match(dom, /⛓ T-2/);
        assert.match(dom, /<b>see<\/b> D-1/);
        assert.match(dom, /href="\/note\/1"/);
        assert.match(dom, /✓ closed on/);
        assert.match(dom, /Which dice to roll/);
        // A type as Jira draws it and its filter, a due day past, a task stuck in progress, a decision and its task both ways.
        assert.match(dom, /class="type-icon"[^>]*aria-label="bug"/);
        assert.match(dom, /id="filter-type-bug"/);
        assert.match(dom, /class="wait late"[^>]*>.*?\d+ d late/);
        assert.match(dom, /class="wait stale"/);
        assert.match(dom, /<b>tasks<\/b> [^<]*T-1/);
        assert.match(dom, /<b>decisions<\/b> D-1/);
        // A task added, changed and archived from the list; who created one.
        assert.match(dom, /id="new-task"/);
        assert.match(dom, /data-edit-task="1"/);
        assert.match(dom, /created by Ann/);
        assert.doesNotMatch(dom, /That did not work/);
    } finally {
        server.closeAllConnections();
        server.close();
        noGh === undefined ? delete process.env.PROJECT_NO_GH : (process.env.PROJECT_NO_GH = noGh);
        rmSync(root, { recursive: true, force: true });
    }
});

/** The page's DOM once drawn, and what its own scripts wrote to the console; the browser runs apart, so that the page's server, in this
 * process, answers it. */
async function open(url, root)
{
    const profile = join(root, "browser-profile");
    const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--virtual-time-budget=10000", "--enable-logging=stderr", "--v=0", "--dump-dom", url];
    const run = await new Promise((done) => execFile(browser, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => done({ stdout, stderr })));
    const origin = new URL(url).origin;
    const console = run.stderr.split(/\r?\n/).filter((line) => /:CONSOLE[:(]/.test(line) && line.includes(origin)).map((line) => line.replace(/^.*?CONSOLE[^\]]*\]\s*/, ""));
    return { dom: run.stdout, console };
}

/** A small project with something of everything the page draws. */
function project()
{
    const root = mkdtempSync(join(tmpdir(), "claude-project-page-"));
    const put = (path, text) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    put(".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Ann]\n");
    put(".claude/agents/matteo-conti.md", "---\nname: matteo-conti\ndescription: \"Matteo Conti, code review. Reviews.\"\ncolor: red\n---\n");
    put(".claude/agent-memory/matteo-conti/todo.md", "- [ ] P2 · 2026-10-29 · read the dice\n");
    put("docs/README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put("docs/PLAN.md", "# Plan\n\n> Updated on 2026-10-30.\n\n| Phase | At the end you can… |\n|---|---|\n| 1. Core | play |\n\n## Goals\n\n### Core (phase 1)\n\nThe dice and the log.\n\n### Old (phase 1) · done 2026-10-20\n\nWhat came first.\n");
    put("docs/DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n| 1 | Real dice, T-1. | They do not bend. |\n\n## To decide\n\n- Which dice to roll (Ann, 2026-10-29)\n");
    put("docs/TASKS.md", [
        "# Backlog",
        "",
        "## In progress",
        "",
        "- T-2 · P1 · high · Claude · 2026-10-02 · Core · the dice (in: T-1) · started 2026-01-01",
        "",
        "## To do",
        "",
        "- T-1 · P1 · high · Claude · 2026-10-01 · Core · The release",
        "- T-3 · P2 · medium · Matteo · 2026-10-03 · Core · the log (after: T-2) (see: D-1) (in: T-1)",
        "- T-4 · P3 · low · Ann · 2026-10-04 · — · a loose one (due: 2026-01-01) (type: bug) (by: Ann)",
        "",
        "## Postponed",
        "",
        "## Done",
        "",
        "- T-5 · P2 · medium · Claude · 2026-10-05 · Old · the first · done 2026-10-20",
        "",
    ].join("\n"));
    put("docs/tasks/T-1.md", "# T-1 · The release\n\nWhere it got to.\n");
    return root;
}

/** A Chrome or Edge to drive headless: CHROME_PATH, else where they install themselves on Windows, macOS and Linux. */
function findBrowser()
{
    const places = [
        process.env.CHROME_PATH,
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ];
    return places.find((place) => place && existsSync(place)) ?? null;
}
