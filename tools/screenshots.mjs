// The README's pictures, made again at will: a small project in English, written here with its plan, backlog, decisions, two releases and
// three weeks of commits; its page served and photographed by a headless Chrome or Edge, and its panel drawn by tools/preview.mjs and
// photographed the same way, both in the dark theme. Usage:
//   node tools/screenshots.mjs [--out images]   (CHROME_PATH names the browser where it is not in its usual place)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : join(repo, "images"));
const scripts = join(repo, "plugins", "project", "scripts");
const root = mkdtempSync(join(tmpdir(), "lumen-"));
const scratch = mkdtempSync(join(tmpdir(), "screenshots-"));
let chrome = null;

try {
    makeProject(root);
    mkdirSync(out, { recursive: true });
    chrome = await startBrowser();

    // The page, its overview: the project's state at a glance.
    process.env.PROJECT_NO_GH = "1";
    process.env.CLAUDE_PROJECT_DIR = root;
    const { pageServer } = await import("../plugins/project/page/serve.mjs");
    const { server } = await pageServer(root);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await photograph(chrome, url, { width: 1280, height: 860, selector: "#tabs button", clip: () => "({ x: 0, y: 0, width: innerWidth, height: innerHeight })", file: join(out, "page.png") });
    await photograph(chrome, `${url}#tasks`, { width: 1280, height: 860, selector: "#panel-tasks [data-edit-task]", clip: () => "({ x: 0, y: 0, width: innerWidth, height: innerHeight })", file: join(out, "page-tasks.png") });
    server.closeAllConnections();
    server.close();

    // The panel, as tools/preview.mjs draws it from the same project.
    const preview = join(scratch, "panel.html");
    execFileSync(process.execPath, [join(repo, "tools", "preview.mjs"), root, "--out", preview], { stdio: "ignore" });
    writeFileSync(preview, readFileSync(preview, "utf8").replace("<style>", "<style>h2{display:none}body{padding:24px;--pane:460px}"));
    await photograph(chrome, `file:///${preview.replaceAll("\\", "/")}`, { width: 560, height: 1400, selector: ".pane .surface", clip: (selector) => `(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: Math.min(box.height, 1180) + 24 }; })()`, file: join(out, "panel.png") });
    console.log(`written ${["page.png", "page-tasks.png", "panel.png"].map((name) => join(out, name)).join(", ")}`);
} finally {
    chrome?.process.kill();
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Lumen, a static site generator three weeks into its work: two goals closed, the live preview under way, the plugin API next. */
function makeProject(folder)
{
    const docs = {
        ".claude/project.yaml": "name: Lumen\nlanguage: en\ndocs: project\npeople: [Claude, Ann, Marco]\ncites: [project, .claude, src]\n",
        "project/README.md": "# Lumen — Project docs\n\n- [Plan](PLAN.md): the phases and the goals.\n- [Backlog](TASKS.md): the tasks.\n- [Decisions](DECISIONS.md): what is decided and why.\n",
        "project/PLAN.md": `# Lumen — Plan

> Updated on 2026-11-01. 0.2.0 is out with themes and the watcher; next, a preview that rebuilds only what changed, then the plugin API.

| Phase | At the end you can… |
|---|---|
| 1. The core | build a site from markdown, with templates, themes and a live preview |
| 2. Ready for others | extend it with plugins and read its docs, built with Lumen itself |

The plan holds the phases and the goals; the tasks are in the [backlog](TASKS.md).

## Goals

### Markdown to HTML (phase 1) · done 2026-10-18

Pages, front matter, links between pages, code highlighting.

### Templates and themes (phase 1) · done 2026-10-25

Layouts, partials and a default theme, light and dark; a theme switched with one line.

### Live preview (phase 1)

A dev server that rebuilds what a change touches and reloads the browser.

### Plugin API (phase 2)

Hooks before and after each build step; a plugin is a package.

### Docs site (phase 2)

The docs, built with Lumen itself.
`,
        "project/TASKS.md": `# Lumen — Backlog

The project's tasks, one a line, changed with the project plugin's backlog command. The archived ones are in the [archive](archive/TASKS-archive.md).

## In progress

- T-14 · P1 · high · Claude · 2026-10-26 · Live preview · Rebuild only the pages a change touches (see: D-5) (type: feature) (by: Ann) · started 2026-10-30
- T-21 · P2 · medium · Ann · 2026-10-29 · Plugin API · Name the hooks and their order (see: D-6) (type: research) (by: Ann) · started 2026-10-31

## To do

- T-16 · P1 · low · Marco · 2026-10-27 · Live preview · The dev server crashes when a file is renamed during a build (due: 2026-11-03) (type: bug) (by: Marco)
- T-15 · P1 · medium · Claude · 2026-10-26 · Live preview · Reload the browser over a websocket (after: T-14) (type: feature) (by: Ann)
- T-22 · P2 · high · Claude · 2026-10-29 · Plugin API · Run the plugins' hooks before and after each build step (after: T-21) (type: feature) (by: Ann)
- T-23 · P2 · medium · Ann · 2026-10-30 · Plugin API · A plugin is an npm package named lumen-plugin-* (see: D-7) (type: feature) (by: Claude)
- T-26 · P2 · low · Claude · 2026-10-31 · — · Code highlighting breaks on tabs in fenced blocks (type: bug) (by: Marco)
- T-24 · P3 · medium · Claude · 2026-10-30 · Docs site · Build the docs with Lumen itself (type: chore) (by: Ann)
- T-25 · P3 · low · Marco · 2026-10-31 · Docs site · A page for each configuration key (type: chore) (by: Marco)

## Postponed

- T-12 · P3 · medium · Ann · 2026-10-20 · — · An RSS feed of the newest pages (type: feature) (by: Ann)

## Done

- T-20 · P3 · low · Ann · 2026-10-29 · — · A contributing guide (type: chore) (by: Ann) · started 2026-10-30 · done 2026-10-31
- T-19 · P2 · medium · Claude · 2026-10-28 · Live preview · An error page in the browser when a build fails (type: feature) (by: Ann) · started 2026-10-29 · done 2026-10-30
- T-18 · P1 · low · Marco · 2026-10-28 · Live preview · The watcher misses files some editors save by renaming (type: bug) (by: Marco) · started 2026-10-28 · done 2026-10-29
- T-17 · P2 · low · Ann · 2026-10-27 · — · Release notes for 0.2.0 (type: chore) (by: Ann) · started 2026-10-28 · done 2026-10-28
- T-13 · P1 · medium · Claude · 2026-10-25 · Live preview · Watch the source folder for changes (type: feature) (by: Ann) · started 2026-10-26 · done 2026-10-28
- T-10 · P3 · low · Ann · 2026-10-21 · Templates and themes · Find partials by name in nested folders (type: bug) (by: Marco) · started 2026-10-24 · done 2026-10-25
- T-9 · P2 · low · Claude · 2026-10-20 · Templates and themes · Switch the theme with one line of the configuration (type: feature) (by: Ann) · started 2026-10-23 · done 2026-10-24
- T-11 · P2 · low · Claude · 2026-10-22 · — · CI on Linux, macOS and Windows (type: chore) (by: Claude) · started 2026-10-22 · done 2026-10-23
- T-8 · P2 · medium · Marco · 2026-10-19 · Templates and themes · The default theme, light and dark (see: D-4) (type: feature) (by: Marco) · started 2026-10-21 · done 2026-10-23
- T-7 · P1 · high · Claude · 2026-10-18 · Templates and themes · Layouts and partials (see: D-3) (type: feature) (by: Ann) · started 2026-10-19 · done 2026-10-21
`,
        "project/archive/TASKS-archive.md": `# Lumen — Archived tasks

- T-6 · P2 · medium · Ann · 2026-10-16 · Markdown to HTML · Benchmark: a thousand pages in under two seconds (type: research) (by: Ann) · started 2026-10-17 · done 2026-10-18 · archived 2026-10-25
- T-5 · P1 · low · Claude · 2026-10-15 · Markdown to HTML · A draft page shows up in the build (type: bug) (by: Marco) · started 2026-10-16 · done 2026-10-16 · archived 2026-10-25
- T-4 · P2 · low · Marco · 2026-10-14 · Markdown to HTML · Code highlighting with the theme's colors (type: feature) (by: Marco) · started 2026-10-15 · done 2026-10-17 · archived 2026-10-25
- T-3 · P2 · medium · Claude · 2026-10-13 · Markdown to HTML · Links between pages checked at build time (type: feature) (by: Ann) · started 2026-10-14 · done 2026-10-15 · archived 2026-10-25
- T-2 · P1 · low · Ann · 2026-10-12 · Markdown to HTML · Front matter: title, date, draft (see: D-1) (type: feature) (by: Ann) · started 2026-10-13 · done 2026-10-14 · archived 2026-10-25
- T-1 · P1 · medium · Claude · 2026-10-12 · Markdown to HTML · Pages from markdown files, one folder a section (see: D-2) (type: feature) (by: Ann) · started 2026-10-12 · done 2026-10-13 · archived 2026-10-25
`,
        "project/releases/v0.1.0.md": `# v0.1.0 · 2026-10-18

Pages from markdown with front matter, links checked at build time and code highlighted: a thousand pages in under two seconds.

## Added

- T-1 · Pages from markdown files, one folder a section
- T-2 · Front matter: title, date, draft
- T-3 · Links between pages checked at build time
- T-4 · Code highlighting with the theme's colors

## Fixed

- T-5 · A draft page shows up in the build

## Other

- T-6 · Benchmark: a thousand pages in under two seconds
`,
        "project/releases/v0.2.0.md": `# v0.2.0 · 2026-10-28

Layouts, partials and a default theme in light and dark, switched with one line; the source folder watched for changes.

## Added

- T-7 · Layouts and partials
- T-8 · The default theme, light and dark
- T-9 · Switch the theme with one line of the configuration
- T-13 · Watch the source folder for changes

## Fixed

- T-10 · Find partials by name in nested folders

## Maintenance

- T-11 · CI on Linux, macOS and Windows
- T-17 · Release notes for 0.2.0
`,
        "project/tasks/T-14.md": "# T-14 · Rebuild only the pages a change touches\n\nEach page records what it uses: its layout, its partials, the pages it links to and the data files it reads. A change rebuilds the pages that use what changed, and the pages that list them.\n",
    };

    for (const [path, text] of Object.entries(docs)) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), text);
    }

    // The decisions, each taken in the commit that brings it, so that the page counts those of the last days.
    const decisions = [
        "| 1 | A page is a markdown file with YAML front matter; nothing else is a page (Ann, 12 October). | What every editor and every other generator reads. |",
        "| 2 | One configuration file, lumen.yaml, at the site's root, and no configuration in JavaScript (Ann, 12 October). | A site anyone can read without running it. |",
        "| 3 | Templates are HTML with {{ }} slots: loops and ifs, no other logic (Claude, 18 October). | Themes stay readable by designers; logic goes to plugins. |",
        "| 4 | The default theme follows the system's light or dark, and a reader may switch it (Marco, 21 October). | |",
        "| 5 | The dev server rebuilds only the pages a change touches, from a graph of what each page uses (Ann, 26 October). | A thousand-page site reloads in under a second. |",
        "| 6 | Plugins hook before and after each build step, never inside one (Ann, 29 October). | The steps stay replaceable; a hook sees a whole step's output. |",
        "| 7 | A plugin is an npm package named lumen-plugin-*, found by its name (Claude, 30 October). | No registry to run. |",
    ];
    const decisionsDoc = (count) => `# Lumen — Decisions\n\n> What is decided and why, in short. A proposal stays under "To decide" until it is decided.\n\n| # | Decision | Why |\n|---|---|---|\n${decisions.slice(0, count).join("\n")}\n\n## To decide\n\n${count === decisions.length ? "- The graph of T-14 kept on disk between runs, or built again at each start? (Claude, 31 October)\n- The docs site on GitHub Pages or on a domain of its own? (Marco, 31 October)\n" : ""}`;

    // Three weeks of commits, each citing its task, by who did it; the decisions taken by then.
    const people = { Ann: "ann@example.com", Marco: "marco@example.com", Claude: "noreply@anthropic.com" };
    const commits = [
        ["2026-10-12T10:20", "Ann", "Start Lumen: the build command, the plan and the first decisions", null, 2],
        ["2026-10-13T16:05", "Claude", "Pages from markdown files, one folder a section (T-1)"],
        ["2026-10-14T11:40", "Ann", "Front matter: title, date, draft (T-2)"],
        ["2026-10-15T15:10", "Claude", "Check the links between pages at build time (T-3)"],
        ["2026-10-16T09:30", "Claude", "Leave the drafts out of the build (T-5)"],
        ["2026-10-17T17:45", "Marco", "Highlight code with the theme's colors (T-4)"],
        ["2026-10-18T12:15", "Ann", "Benchmark: a thousand pages in 1.4 s (T-6)", "v0.1.0", 3],
        ["2026-10-19T14:00", "Claude", "Layouts (T-7)"],
        ["2026-10-21T10:25", "Claude", "Partials (T-7)", null, 4],
        ["2026-10-22T18:10", "Marco", "The default theme, light (T-8)"],
        ["2026-10-23T09:50", "Claude", "CI on Linux, macOS and Windows (T-11)"],
        ["2026-10-23T16:35", "Marco", "The default theme, dark (T-8)"],
        ["2026-10-24T11:05", "Claude", "Switch the theme with one line (T-9)"],
        ["2026-10-25T15:20", "Ann", "Find partials in nested folders (T-10)"],
        ["2026-10-27T10:40", "Claude", "Watch the source folder (T-13)", null, 5],
        ["2026-10-28T09:15", "Claude", "Watcher: debounce, and folders created later (T-13)"],
        ["2026-10-28T17:30", "Ann", "Release notes for 0.2.0 (T-17)", "v0.2.0"],
        ["2026-10-29T12:10", "Marco", "Catch the files editors save by renaming (T-18)", null, 6],
        ["2026-10-30T10:05", "Claude", "An error page in the browser when a build fails (T-19)", null, 7],
        ["2026-10-30T16:50", "Claude", "The graph of what each page uses, first pass (T-14)"],
        ["2026-10-31T11:30", "Ann", "A contributing guide (T-20)"],
        ["2026-10-31T17:15", "Claude", "Rebuild from the graph: layouts and partials (T-14)"],
        ["2026-11-01T10:45", "Ann", "The hooks' names, a draft (T-21)"],
    ];
    const git = (gitArgs, env = {}) => execFileSync("git", gitArgs, { cwd: folder, env: { ...process.env, ...env }, stdio: "ignore" });
    git(["init", "-q", "-b", "main"]);
    // On GitHub, as most projects are: the panel offers no button to put it there.
    git(["remote", "add", "origin", "https://github.com/example/lumen.git"]);

    for (const [index, [at, who, message, tag, taken]] of commits.entries()) {
        const day = `${at}:00+01:00`;
        const env = { GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: people[who], GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: people[who], GIT_AUTHOR_DATE: day, GIT_COMMITTER_DATE: day };
        mkdirSync(join(folder, "src"), { recursive: true });
        writeFileSync(join(folder, "src", "build.js"), `// Lumen's build, step ${index + 1}.\n`);

        if (taken) {
            writeFileSync(join(folder, "project", "DECISIONS.md"), decisionsDoc(taken));
        }
        git(["add", "-A"]);
        git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], env);

        if (tag) {
            git(["-c", "tag.gpgsign=false", "tag", "-a", tag, "-m", tag], env);
        }
    }

    // The docs as the plugin keeps them: their frontmatter, and a clean check.
    execFileSync(process.execPath, [join(scripts, "check.mjs"), "--fix"], { cwd: folder, env: { ...process.env, CLAUDE_PROJECT_DIR: folder }, stdio: "ignore" });
    const check = execFileSync(process.execPath, [join(scripts, "check.mjs")], { cwd: folder, env: { ...process.env, CLAUDE_PROJECT_DIR: folder }, encoding: "utf8" });

    if (!/^0 errors/m.test(check)) {
        throw new Error(`The demo project does not check clean:\n${check}`);
    }
}

/** A headless Chrome or Edge with its DevTools port: { process, port }. */
async function startBrowser()
{
    const path = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((one) => one && existsSync(one));

    if (!path) {
        throw new Error("No Chrome or Edge here: set CHROME_PATH.");
    }

    const child = spawn(path, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(scratch, "profile")}`, "--remote-debugging-port=0", "--hide-scrollbars", "--allow-file-access-from-files", "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const endpoint = await new Promise((done, fail) => {
        let text = "";
        child.stderr.on("data", (chunk) => {
            text += chunk;
            const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);

            if (match) {
                done(match[1]);
            }
        });
        child.on("exit", () => fail(new Error(`The browser stopped: ${text.slice(-500)}`)));
    });
    return { process: child, port: new URL(endpoint).port };
}

/** A page photographed at twice its size, in the dark theme, once `selector` is drawn: the region `clip` gives, an expression of the page. */
async function photograph(browser, url, { width, height, selector, clip, file })
{
    const target = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done) => socket.addEventListener("open", done, { once: true }));
    const waiting = new Map();
    let last = 0;
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        waiting.get(message.id)?.(message);
    });
    const send = (method, params = {}) => new Promise((done, fail) => {
        const id = ++last;
        waiting.set(id, (message) => (message.error ? fail(new Error(`${method}: ${message.error.message}`)) : done(message.result)));
        socket.send(JSON.stringify({ id, method, params }));
    });
    const value = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await send("Page.navigate", { url });

    for (let tries = 0; !(await value(`!!document.querySelector(${JSON.stringify(selector)})`)); tries++) {
        if (tries === 100) {
            throw new Error(`${url} never drew ${selector}`);
        }

        await new Promise((done) => setTimeout(done, 150));
    }

    // The charts and the fonts settle.
    await new Promise((done) => setTimeout(done, 1200));
    const region = await value(clip(selector));
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...region, scale: 1 } });
    writeFileSync(file, Buffer.from(data, "base64"));
    socket.close();
}
