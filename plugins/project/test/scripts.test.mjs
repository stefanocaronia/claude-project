// The command lines on a small project made in a temporary folder: the backlog changed and read, the decisions read, the check's findings.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
let root;

before(() => {
    root = mkdtempSync(join(tmpdir(), "claude-project-"));
    files({
        ".claude/project.yaml": "language: it\ndocs: docs\npeople: [Claude, Stefano]\ncites: [docs, .claude/agent-memory, src]\n",
        ".claude/agents/matteo-conti.md": "---\nname: matteo-conti\n---\n",
        ".claude/agent-memory/matteo-conti/todo.md": "# Todo\n\n- [ ] P2 · 2026-10-29 · rileggere T-1\n- [ ] P2 · 2026-10-29 · rileggere T-99\n- [ ] senza data\n- [x] 2026-10-20 · chiuso\n- [x] 2026-10-21 · fatto T-1\n",
        "docs/README.md": "# Documenti\n\n- [Piano](PLAN.md)\n- [Compiti](TASKS.md)\n- [Decisioni](DECISIONI.md)\n",
        "docs/PLAN.md": "# Piano\n\n> Aggiornato il 2026-10-29.\n\n| Fase | Alla fine puoi… |\n|---|---|\n| 1. Nucleo | giocare |\n\n## Traguardi\n\n### Nucleo (fase 1)\n\nIl nucleo. Vedi [le decisioni](DECISIONI.md#da-decidere) e [niente](NIENTE.md).\n",
        "docs/TASKS.md": "# Backlog\n\nI compiti.\n\n## In corso\n\n## Da fare\n\n- T-1 · P1 · alto · Matteo · 2026-10-01 · Nucleo · i dadi\n\n## Rimandati\n\n## Fatti\n",
        "docs/DECISIONI.md": "# Decisioni\n\n| # | Decisione | Perché |\n|---|---|---|\n| 1 | Dadi veri. | I dadi non si piegano. |\n| 2 | Dadi segreti, rivede D-1. | |\n| 4 | Quattro, rivede D-2 in parte. | |\n\n## Da decidere\n\n- Una proposta vecchia (Stefano, 2026-01-05)\n- Una nuova senza data\n",
        "docs/NOTE.md": "# Note \n\n\n\nfine\n",
        "src/code.ts": "// D-1 and D-7\n",
    });
});

after(() => rmSync(root, { recursive: true, force: true }));

test("add, start, done, set and archive change the backlog; show and list read it", () => {
    assert.match(run("backlog.mjs", "next"), /^T-2$/m);
    assert.match(run("backlog.mjs", "add", "il registro", "--goal", "Nucleo", "--to", "Stefano", "--effort", "basso", "--p", "P3"), /T-2 aggiunto: - T-2 · P3 · basso · Stefano · \d{4}-\d{2}-\d{2} · Nucleo · il registro/);
    assert.match(run("backlog.mjs", "start", "T-1"), /T-1: In corso/);
    assert.match(run("backlog.mjs", "done", "t-2"), /T-2: Fatti/);
    assert.match(run("backlog.mjs", "set", "T-1", "--text", "i dadi e i tiri"), /· i dadi e i tiri$/m);

    const tasks = readFileSync(join(root, "docs/TASKS.md"), "utf8");
    assert.ok(tasks.startsWith("# Backlog\n\nI compiti.\n\n## In corso\n\n- T-1 · P1 · alto · Matteo · 2026-10-01 · Nucleo · i dadi e i tiri\n"));
    assert.match(tasks, /## Fatti\n\n- T-2 · .* · il registro · fatto \d{4}-\d{2}-\d{2}\n/);

    const listed = JSON.parse(run("backlog.mjs", "list", "--json"));
    assert.deepEqual(listed.map((task) => [task.id, task.state]), [[1, "doing"]]);
    assert.match(run("backlog.mjs", "goals"), /Nucleo: 1 in corso, 0 da fare, 0 rimandati, 1 fatti/);
    assert.match(run("backlog.mjs", "find", "REGISTRO"), /T-2 .* \[fatto\]/);

    assert.match(run("backlog.mjs", "archive", "--done"), /1 archiviati/);
    assert.match(readFileSync(join(root, "docs/archivio/TASKS-archivio.md"), "utf8"), /^- T-2 .* · fatto \d{4}-\d{2}-\d{2} · archiviato \d{4}-\d{2}-\d{2}\n$/);
    assert.match(run("backlog.mjs", "show", "T-2"), /stato: archiviato/);
});

test("a wrong value or an unknown task fails with a message that says how to fix it, and writes nothing", () => {
    const before = readFileSync(join(root, "docs/TASKS.md"), "utf8");
    assert.match(fails("backlog.mjs", "add", "x", "--to", "Nessuno"), /Nessuno non può avere un compito: Claude, Stefano, Matteo/);
    assert.match(fails("backlog.mjs", "add", "x", "--goal", "Altrove"), /Il traguardo «Altrove» non è nel piano: Nucleo/);
    assert.match(fails("backlog.mjs", "done", "T-50"), /T-50 non c'è nel backlog né nell'archivio/);
    assert.match(fails("backlog.mjs", "list", "--state", "later"), /Lo stato è uno fra/);
    assert.match(fails("backlog.mjs", "fly"), /Comandi: next, add/);
    assert.equal(readFileSync(join(root, "docs/TASKS.md"), "utf8"), before);
});

test("decisions: the next number past the cited ones, a decision whole, words and citations", () => {
    assert.equal(run("decisions.mjs", "next").split("\n")[0], "D-8");
    assert.match(run("decisions.mjs", "next"), /Citate ma non nella tabella: D-7/);
    assert.match(run("decisions.mjs", "show", "1"), /^D-1 \(riga 5\)\nDadi veri\.\nPerché: I dadi non si piegano\./);
    assert.match(fails("decisions.mjs", "show", "D-3"), /D-3: non c'è nella tabella/);
    assert.match(run("decisions.mjs", "find", "segreti"), /^D-2: Dadi segreti, rivede D-1./);
    assert.match(run("decisions.mjs", "find", "vecchia"), /Da decidere \(riga 11\): Una proposta vecchia/);
    assert.match(run("decisions.mjs", "cites", "D-1"), /src\/code\.ts:1: \/\/ D-1 and D-7[\s\S]*citazioni di D-1/);
});

test("the check finds what is wrong in the docs, by severity and kind", () => {
    const findings = JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: root, encoding: "utf8" }).stdout);
    const has = (kind, pattern) => findings.some((finding) => finding.kind === kind && pattern.test(`${finding.file}:${finding.line} ${finding.message}`));

    assert.ok(has("references", /^src\/code\.ts:1 D-7 non esiste in DECISIONI\.md/));
    assert.ok(has("numbering", /D-3 manca/));
    assert.ok(has("superseded", /D-2 rivede D-1 per intero/));
    assert.ok(!has("superseded", /D-4/));
    assert.ok(has("tasks", /todo\.md:5 Compito senza la data/));
    assert.ok(has("tasks", /todo\.md:5 Compito aperto senza priorità/));
    assert.ok(has("tasks", /todo\.md:4 T-99 non c'è nel backlog/));
    assert.ok(has("tasks", /todo\.md:7 La riga è spuntata ma T-1 è ancora aperto/));
    assert.ok(has("open", /DECISIONI\.md:11 Proposta del 2026-01-05/));
    assert.ok(has("link", /PLAN\.md:13 Il link a NIENTE\.md/));
    assert.ok(has("markdown", /NOTE\.md:3 Due righe vuote/));
    assert.ok(has("markdown", /NOTE\.md:null 1 righe con spazi/));
    assert.ok(has("index", /NOTE\.md:null Non è nel README/));
    assert.ok(!findings.some((finding) => finding.kind === "backlog"));
});

test("the check's --fix mends the whitespace and nothing else", () => {
    assert.match(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--fix"], { cwd: root, encoding: "utf8" }).stdout, /Spazi sistemati in: docs\/NOTE\.md/);
    assert.equal(readFileSync(join(root, "docs/NOTE.md"), "utf8"), "# Note\n\nfine\n");
});

test("without a configuration the scripts say how to make one", () => {
    const empty = mkdtempSync(join(tmpdir(), "claude-project-none-"));
    const result = spawnSync(process.execPath, [join(scripts, "backlog.mjs"), "list"], { cwd: empty, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "", PROJECT_CONFIG: "" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Nessun|No \.claude\/project\.yaml/);
    rmSync(empty, { recursive: true, force: true });
});

function run(script, ...args)
{
    return execFileSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env: environment() }).trim();
}

function fails(script, ...args)
{
    const result = spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env: environment() });
    assert.notEqual(result.status, 0, `${script} ${args.join(" ")} should fail`);
    return `${result.stdout}${result.stderr}`;
}

function environment()
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...rest } = process.env;
    return rest;
}

function files(entries)
{
    for (const [path, text] of Object.entries(entries)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
}

test("init sets a project up in its language, never overwrites, and a fresh project checks clean, with or without Crew", () => {
    const fresh = mkdtempSync(join(tmpdir(), "claude-project-init-"));
    const env = { ...environment(), CLAUDE_PROJECT_DIR: fresh };
    const init = (...args) => execFileSync(process.execPath, [join(scripts, "init.mjs"), ...args], { cwd: fresh, encoding: "utf8", env });
    execFileSync("git", ["init", "-q", fresh]);

    const first = init("--language", "it", "--private", "private", "--people", "Claude,Ann", "--name", "Prova");
    assert.match(first, /\+ \.claude\/project\.yaml/);
    assert.match(first, /\+ private\/ \(git init\)/);
    assert.match(first, /\+ private\/project\/DECISIONI\.md/);
    assert.match(readFileSync(join(fresh, ".gitignore"), "utf8"), /^\/private\/$/m);
    assert.match(readFileSync(join(fresh, ".claude/project.yaml"), "utf8"), /^people: \[Claude, Ann\]$/m);
    assert.match(readFileSync(join(fresh, "private/project/TASKS.md"), "utf8"), /## In corso\n\n## Da fare\n\n## Rimandati\n\n## Fatti\n$/);

    // No colleagues: the people of the configuration hold the tasks.
    const add = execFileSync(process.execPath, [join(scripts, "backlog.mjs"), "add", "il primo", "--goal", "Primo traguardo", "--to", "Ann"], { cwd: fresh, encoding: "utf8", env });
    assert.match(add, /T-1 aggiunto: - T-1 · P2 · medio · Ann/);
    const findings = JSON.parse(spawnSync(process.execPath, [join(scripts, "check.mjs"), "--json"], { cwd: fresh, encoding: "utf8", env }).stdout);
    assert.deepEqual(findings.filter((finding) => finding.severity !== "note"), []);
    assert.match(execFileSync(process.execPath, [join(scripts, "decisions.mjs"), "next"], { cwd: fresh, encoding: "utf8", env }), /^D-1$/m);

    const second = init("--language", "it", "--private", "private");
    assert.doesNotMatch(second, /^\+/m);
    assert.match(second, /= private\/project\/PLAN\.md \(c.è già/);
    assert.equal(readFileSync(join(fresh, ".gitignore"), "utf8").match(/\/private\//g).length, 1);
    rmSync(fresh, { recursive: true, force: true });
});

test("adopt finds a project's own docs and language, writes the configuration that reads them, and moves the plan's steps into the backlog", () => {
    const old = mkdtempSync(join(tmpdir(), "claude-project-adopt-"));
    const env = { ...environment(), CLAUDE_PROJECT_DIR: old };
    const init = (...args) => execFileSync(process.execPath, [join(scripts, "init.mjs"), ...args], { cwd: old, encoding: "utf8", env });
    const put = (path, text) => {
        mkdirSync(dirname(join(old, path)), { recursive: true });
        writeFileSync(join(old, path), text);
    };
    put("notes/plan/PLAN.md", "# Piano\n\n## Traguardi\n\n### Il nucleo (fase 1)\n\n- [ ] P1 · 2026-10-01 · i dadi\n  - con i tiri nascosti\n- [x] 2026-09-20 · il registro\n\nTesto del traguardo.\n");
    put("notes/plan/DECISIONI.md", "| # | Decisione | Perché |\n|---|---|---|\n| 1 | Dadi veri. | |\n\n## Da decidere\n\n- uno\n");
    put("src/dice.ts", "// D-1\n");
    put("lib/other.ts", "// nothing\n");

    const survey = init("adopt");
    assert.match(survey, /Documenti trovati in notes\/plan\//);
    assert.match(survey, /language: "it"/);
    assert.match(survey, /cites: \["notes\/plan",".claude","src"\]/);
    assert.match(survey, /1 open and 1 done checkbox steps under the goals/);
    assert.match(survey, /backlog notes\/plan\/TASKS\.md: missing, init writes it/);
    assert.match(survey, /Niente scritto/);
    assert.equal(existsSync(join(old, ".claude/project.yaml")), false);

    const written = init("adopt", "--write");
    assert.match(written, /\+ notes\/plan\/TASKS\.md/);
    assert.match(written, /= notes\/plan\/PLAN\.md \(c.è già/);
    assert.match(readFileSync(join(old, ".claude/project.yaml"), "utf8"), /^docs: notes\/plan$/m);

    const moved = init("adopt", "--steps");
    assert.match(moved, /→ - T-1 · P1 · medio · Claude · 2026-10-01 · Il nucleo · i dadi; con i tiri nascosti/);
    assert.match(moved, /2 passi spostati/);
    assert.match(readFileSync(join(old, "notes/plan/TASKS.md"), "utf8"), /## Da fare\n\n- T-1 · P1 · medio · Claude · 2026-10-01 · Il nucleo · i dadi; con i tiri nascosti\n/);
    assert.match(readFileSync(join(old, "notes/plan/archivio/TASKS-archivio.md"), "utf8"), /- T-2 · P2 · medio · Claude · 2026-09-20 · Il nucleo · il registro · fatto 2026-09-20 · archiviato \d{4}/);
    assert.equal(readFileSync(join(old, "notes/plan/PLAN.md"), "utf8"), "# Piano\n\n## Traguardi\n\n### Il nucleo (fase 1)\n\nTesto del traguardo.\n");
    assert.match(fails2(init, "adopt", "--write"), /c.è già/);
    rmSync(old, { recursive: true, force: true });
});

function fails2(run, ...args)
{
    try {
        run(...args);
    } catch (error) {
        return `${error.stdout}${error.stderr}`;
    }

    assert.fail(`${args.join(" ")} should fail`);
}
