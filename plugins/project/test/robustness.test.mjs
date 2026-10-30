// The faults of the first review, each as it was reproduced: writes at once, lines written by hand, a file that cannot be written,
// options, a link to the plugin, a broken extension or configuration, a name with regex characters, another site posting to the page.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { request } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(plugin, "scripts");
const run = promisify(execFile);
const tasks = "# Backlog\n\nNote above the sections stay.\n\n## In corso\n\n## Da fare\n\n- T-1 · P2 · medio · Claude · 2026-10-01 · — · uno\n- T-2 · P2 · medio · Claude · 2026-10-01 · — · due\n\n## Rimandati\n\n## Fatti\n\n- T-3 · P2 · medio · Claude · 2026-10-01 · — · tre · fatto 2026-10-02\n";

function project(extra = {})
{
    const root = mkdtempSync(join(tmpdir(), "claude-project-robust-"));
    const files = {
        ".claude/project.yaml": "language: it\ndocs: docs\npeople: [Claude, \"C++\"]\n",
        "docs/TASKS.md": tasks,
        "docs/PLAN.md": "# Piano\n\n## Traguardi\n\n### Nucleo\n",
        "docs/DECISIONI.md": "| # | Decisione | Perché |\n|---|---|---|\n| 1 | Uno (C++, 1 ottobre). | |\n\n## Da decidere\n",
        ...extra,
    };

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }

    return root;
}

function cli(root, script, ...args)
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    return spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env });
}

test("twelve adds at once give twelve tasks with twelve numbers", async () => {
    const root = project();
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    await Promise.all(Array.from({ length: 12 }, (_, index) => run(process.execPath, [join(scripts, "backlog.mjs"), "add", `nuovo ${index}`], { cwd: root, env })));
    const ids = [...readFileSync(join(root, "docs/TASKS.md"), "utf8").matchAll(/^- T-(\d+) /gm)].map((match) => Number(match[1]));
    assert.equal(ids.length, 15);
    assert.equal(new Set(ids).size, 15);
    rmSync(root, { recursive: true, force: true });
});

test("a line written by hand among the tasks does not read, and no change writes over it", () => {
    const root = project({ "docs/TASKS.md": tasks.replace("## Rimandati", "Una nota a mano.\n<!-- un commento -->\n\n## Sospesi da Ann\n\nTesto.\n\n## Rimandati") });
    const changed = cli(root, "backlog.mjs", "start", "T-1");
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /docs\/TASKS\.md:12, docs\/TASKS\.md:13, docs\/TASKS\.md:15, docs\/TASKS\.md:17/);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /Una nota a mano\./);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /^Note above the sections stay\.$/m);
    assert.match(JSON.stringify(JSON.parse(cli(root, "check.mjs", "--json").stdout)), /Riga che non si legge come un compito: Una nota a mano/);

    writeFileSync(join(root, "docs/PLAN.md"), "# Piano\n\n## Traguardi\n\n### Nucleo\n\n- [ ] il passo\n");
    writeFileSync(join(root, ".claude/project.yaml"), "language: it\ndocs: docs\n");
    const steps = cli(root, "init.mjs", "adopt", "--steps");
    assert.equal(steps.status, 1);
    assert.match(readFileSync(join(root, "docs/PLAN.md"), "utf8"), /- \[ \] il passo/);
    rmSync(root, { recursive: true, force: true });
});

test("an archive that cannot be written leaves the task where it was, and says how to go on", { skip: process.platform !== "win32" && process.getuid?.() === 0 }, () => {
    const root = project({ "docs/archivio/TASKS-archivio.md": "# Archivio\n" });
    chmodSync(join(root, "docs/archivio/TASKS-archivio.md"), 0o444);
    // Read-only on Windows makes the rename fail too: the archive is written whole first, or not at all.
    const archived = cli(root, "backlog.mjs", "archive", "T-3");
    chmodSync(join(root, "docs/archivio/TASKS-archivio.md"), 0o644);

    if (archived.status !== 0) {
        assert.match(archived.stderr, /non si può scrivere \(E(PERM|ACCES|BUSY)\): chiudilo/);
        assert.match(cli(root, "backlog.mjs", "show", "T-3").stdout, /T-3 .* tre/);
    } else {
        assert.match(readFileSync(join(root, "docs/archivio/TASKS-archivio.md"), "utf8"), /T-3 /);
    }

    rmSync(root, { recursive: true, force: true });
});

test("--json and --done take no value: the word after them is a task", () => {
    const root = project();
    assert.deepEqual(JSON.parse(cli(root, "backlog.mjs", "show", "--json", "T-2").stdout).map((task) => task.id), [2]);
    assert.match(cli(root, "backlog.mjs", "archive", "--done").stdout, /1 archiviati/);
    rmSync(root, { recursive: true, force: true });
});

test("the scripts run through a link to the plugin's folder as from the folder itself", { skip: process.platform !== "win32" }, () => {
    const root = project();
    const link = join(mkdtempSync(join(tmpdir(), "claude-project-link-")), "plugin");
    symlinkSync(plugin, link, "junction");
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    assert.match(execFileSync(process.execPath, [join(link, "scripts", "decisions.mjs"), "next"], { cwd: root, encoding: "utf8", env }), /^D-2$/m);
    rmSync(dirname(link), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
});

test("an extension that does not load leaves the panel's data whole and says which", () => {
    const root = project();
    writeFileSync(join(root, ".claude/project.yaml"), "language: it\ndocs: docs\nextensions: [missing.mjs]\n");
    const snapshot = cli(root, "snapshot.mjs", "--no-health");
    assert.equal(snapshot.status, 0);
    assert.match(JSON.parse(snapshot.stdout).problems[0], /^missing\.mjs: /);
    rmSync(root, { recursive: true, force: true });
});

test("a configuration that does not read names its line, without a stack", () => {
    const root = project();
    writeFileSync(join(root, ".claude/project.yaml"), "language: it\ndocs: docs\nlanguage: en\n");
    const listed = cli(root, "backlog.mjs", "list");
    assert.equal(listed.status, 1);
    assert.match(listed.stderr, /^\.claude\/project\.yaml, line 3: .*unique.* Fix it, or run \/project:init again\./);
    assert.doesNotMatch(listed.stderr, /\n\s+at /);
    assert.equal(cli(root, "snapshot.mjs").status, 1);
    rmSync(root, { recursive: true, force: true });
});

test("a person with regex characters in the name holds tasks and counts on the page", async () => {
    const root = project();
    assert.match(cli(root, "backlog.mjs", "add", "il compilatore", "--to", "C++").stdout, /· C\+\+ ·/);
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    process.env.CLAUDE_PROJECT_DIR = root;
    const { loadProject } = await import("../scripts/project.mjs");
    const { collect } = await import("../page/collect.mjs");
    const { config, say } = loadProject(root);
    assert.equal((await collect(config, say, [])).decisions.byPerson["C++"], 1);
    delete process.env.CLAUDE_PROJECT_DIR;
    rmSync(root, { recursive: true, force: true });
});

test("the page refuses a change another site asks for, and a name that is not localhost", async () => {
    const root = project();
    const { pageServer } = await import("../page/serve.mjs");
    const { server } = await pageServer(root);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;
    const post = (headers) => fetch(`http://127.0.0.1:${port}/tidy/fix/whitespace`, { method: "POST", headers });
    assert.equal((await post({ origin: "http://127.0.0.1:5898" })).status, 403);
    assert.equal((await post({ origin: "https://example.com" })).status, 403);
    assert.equal((await post({ "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await post({ origin: `http://127.0.0.1:${port}` })).status, 200);
    assert.equal((await post({})).status, 200);
    assert.equal(await statusOf(port, `rebound.example:${port}`), 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/whoami`)).status, 200);
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
});

/** A GET to the page as a rebound DNS name would send it: fetch keeps the Host header its own. */
function statusOf(port, host)
{
    return new Promise((done, fail) => request({ host: "127.0.0.1", port, path: "/data", headers: { host } }, (response) => {
        response.resume();
        done(response.statusCode);
    }).on("error", fail).end());
}

test("a decision revised whole is read by its whole number, and a revision that goes on past the number is in part", () => {
    const table = [
        "| 34 | Trentaquattro. | |", "| 344 | Trecentoquarantaquattro. | |", "| 349 | Rivede D-344 (1). | |", "| 350 | Rivede D-344 per le estensioni. | |",
        "| 351 | Rivede D-34, corregge D-344 sul dado. | |", "| 352 | Rivede D-344 per intero. | |", "| 353 | Rivede D-34. | |",
    ];
    const root = project({ "docs/DECISIONI.md": `| # | Decisione | Perché |\n|---|---|---|\n${table.join("\n")}\n\n## Da decidere\n` });
    const notes = JSON.parse(cli(root, "check.mjs", "--json").stdout).filter((finding) => finding.kind === "superseded").map((finding) => finding.message);
    assert.deepEqual(notes.map((message) => message.split(":")[0]).sort(), ["D-352 Rivede D-344 per intero", "D-353 Rivede D-34 per intero"]);
    rmSync(root, { recursive: true, force: true });
});

test("a change to an open task leaves the archive alone, so a reader that holds it does not stop the change", () => {
    const root = project({ "docs/archivio/TASKS-archivio.md": "# Archivio\n\n- T-9 · P2 · medio · Claude · 2026-10-01 · — · nove · fatto 2026-10-02 · archiviato 2026-10-03\n" });
    const archive = join(root, "docs/archivio/TASKS-archivio.md");
    const before = statSync(archive).mtimeMs;
    assert.equal(cli(root, "backlog.mjs", "set", "T-1", "--type", "bug").status, 0);
    assert.equal(statSync(archive).mtimeMs, before);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /- T-1 · .* · uno \(type: bug\)/);
    rmSync(root, { recursive: true, force: true });
});

test("a task a failed write left in both files is written once by the next change", () => {
    const root = project({ "docs/archivio/TASKS-archivio.md": "# Archivio\n\n- T-3 · P2 · medio · Claude · 2026-10-01 · — · tre · fatto 2026-10-02 · archiviato 2026-10-03\n" });
    assert.equal(cli(root, "backlog.mjs", "archive", "T-3").status, 0);
    const all = `${readFileSync(join(root, "docs/TASKS.md"), "utf8")}${readFileSync(join(root, "docs/archivio/TASKS-archivio.md"), "utf8")}`;
    assert.equal(all.match(/^- T-3 /gm).length, 1);
    rmSync(root, { recursive: true, force: true });
});

test("the page changes, adds and archives tasks through the backlog's command line, and nothing else; what it adds is its owner's", async () => {
    const root = project();
    const noGh = process.env.PROJECT_NO_GH;
    process.env.PROJECT_NO_GH = "1";
    const { pageServer } = await import("../page/serve.mjs");
    const { server } = await pageServer(root);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const port = server.address().port;
    const post = async (payload) => (await fetch(`http://127.0.0.1:${port}/backlog`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).json();
    assert.equal((await post({ command: "start", id: "T-1" })).ok, true);
    assert.equal((await post({ command: "set", id: "T-2", priority: "P1" })).ok, true);
    assert.equal((await post({ command: "set", id: "T-2; rm -rf /", priority: "P1" })).ok, false);
    assert.equal((await post({ command: "set", id: "T-2" })).ok, false);
    assert.equal((await post({ command: "add", text: "  " })).ok, false);
    assert.match((await post({ command: "done", id: "T-9" })).message, /T-9 non c'è/);
    // A task added: its text one line without the separator, its fields, and its creator the page's owner (without gh, the first person not Claude).
    assert.equal((await post({ command: "add", text: "nuovo · compito\n  in due righe", priority: "P1", type: "bug", due: "2026-12-01", to: "Claude" })).ok, true);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /^- T-4 · P1 · .* · nuovo - compito in due righe \(due: 2026-12-01\) \(type: bug\) \(by: C\+\+\)$/m);
    assert.equal((await post({ command: "set", id: "T-4", text: "nuovo compito", due: "", type: "" })).ok, true);
    assert.equal((await post({ command: "archive", id: "T-2" })).ok, true);
    // A part of a large task, from the page's form.
    assert.equal((await post({ command: "add", text: "una parte", parent: "T-1", type: "", goal: "—" })).ok, true);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /^- T-5 · .* · una parte \(in: T-1\) \(by: C\+\+\)$/m);
    const tasks = readFileSync(join(root, "docs/TASKS.md"), "utf8");
    assert.match(tasks, /## In corso\n\n- T-1 /);
    assert.match(tasks, /^- T-4 · P1 · [^·]+ · Claude · \d{4}-\d{2}-\d{2} · — · nuovo compito \(by: C\+\+\)$/m);
    assert.doesNotMatch(tasks, /T-2 /);
    const data = await (await fetch(`http://127.0.0.1:${port}/data`)).json();
    assert.deepEqual(data.board.map((task) => [task.id, task.state]).sort((first, second) => first[0] - second[0]), [[1, "doing"], [2, "archived"], [3, "done"], [4, "todo"], [5, "todo"]]);
    assert.equal(data.board.find((task) => task.id === 4).by, "C++");
    assert.equal(data.decisions.all[0].number, 1);
    // A task done or archived, taken up again: back in progress, out of the archive, without its day done.
    assert.equal((await post({ command: "start", id: "T-2" })).ok, true);
    assert.equal((await post({ command: "start", id: "T-3" })).ok, true);
    assert.match(readFileSync(join(root, "docs/TASKS.md"), "utf8"), /^- T-2 · .* · due · iniziato \d{4}-\d{2}-\d{2}\n- T-3 · .* · tre · iniziato \d{4}-\d{2}-\d{2}$/m);
    noGh === undefined ? delete process.env.PROJECT_NO_GH : (process.env.PROJECT_NO_GH = noGh);
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
});

test("adopt --decisions moves a numbered list into the table with its numbers, and refuses a number the table has", () => {
    const root = project({ "design/flow.md": "# Flow\n\n## Decisioni prese\n\n1. **Uno.** Il primo. Perché: per cominciare.\n2. **Due** | con una barra\n   e una riga che continua.\n\n## Altro\n\nResta.\n" });
    writeFileSync(join(root, "docs/DECISIONI.md"), "# Decisioni\n\n| # | Decisione | Perché |\n|---|---|---|\n| 5 | Cinque. | |\n\n## Da decidere\n\n- aperta\n");
    assert.match(cli(root, "init.mjs", "adopt", "--decisions", "design/flow.md", "Decisioni prese").stdout, /2 decisioni spostate in docs\/DECISIONI\.md/);
    assert.equal(readFileSync(join(root, "docs/DECISIONI.md"), "utf8"), "# Decisioni\n\n| # | Decisione | Perché |\n|---|---|---|\n| 1 | **Uno.** Il primo. | per cominciare. |\n| 2 | **Due** / con una barra e una riga che continua. |  |\n| 5 | Cinque. | |\n\n## Da decidere\n\n- aperta\n");
    assert.equal(readFileSync(join(root, "design/flow.md"), "utf8"), "# Flow\n\n## Decisioni prese\n\nLe decisioni sono in [DECISIONI.md](../docs/DECISIONI.md).\n\n## Altro\n\nResta.\n");
    writeFileSync(join(root, "design/again.md"), "## Decisioni prese\n\n5. doppia\n");
    assert.match(cli(root, "init.mjs", "adopt", "--decisions", "design/again.md", "Decisioni prese").stderr, /D-5 sono già nella tabella/);
    rmSync(root, { recursive: true, force: true });
});
