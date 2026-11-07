// Two people on one project, each with their own clone of the private docs (D-18): a change pulls the others' latest first, so that the
// numbers follow theirs, and goes to them right after; what a chat wrote by hand goes at the end of the turn; the code's repo is never synced.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const identity = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test" };
let base;

before(() => {
    base = mkdtempSync(join(tmpdir(), "claude-project-sync-"));
    git(base, "init", "-q", "--bare", "remote.git");
    git(base, "clone", "-q", "remote.git", "seed");
    const seed = join(base, "seed");
    put(seed, "README.md", "# Docs\n\n- [Plan](PLAN.md)\n- [Tasks](TASKS.md)\n- [Decisions](DECISIONS.md)\n");
    put(seed, "PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n");
    put(seed, "DECISIONS.md", "# Decisions\n\n| # | Decision | Why |\n|---|---|---|\n| 1 | Real dice. | |\n");
    put(seed, "TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n- T-1 · P2 · medium · Claude · 2026-10-01 · Core · the dice (type: feature)\n\n## Postponed\n\n## Done\n");
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "The docs");
    git(seed, "push", "-q", "-u", "origin", "HEAD");

    for (const person of ["ann", "bob"]) {
        put(join(base, person), ".claude/project.yaml", "language: en\ndocs: docs\nsync: auto\npeople: [Claude, Ann, Bob]\n");
        git(join(base, person), "clone", "-q", join(base, "remote.git"), "docs");
    }
});

after(() => rmSync(base, { recursive: true, force: true }));

test("a task added by one is pushed at once, and the other's next number comes after it", () => {
    run("ann", "backlog.mjs", "add", "the map", "--type", "feature", "--goal", "Core");
    assert.match(git(base, "--git-dir", "remote.git", "log", "-1", "--format=%s"), /^backlog: add the map/);
    const added = run("bob", "backlog.mjs", "add", "the log", "--type", "feature", "--goal", "Core");
    assert.match(added, /T-3 added/);
    const tasks = readFileSync(join(base, "bob", "docs", "TASKS.md"), "utf8");
    assert.match(tasks, /T-2 .* the map/);
    assert.match(tasks, /T-3 .* the log/);
    // Ann, at her next change, has Bob's too.
    run("ann", "backlog.mjs", "start", "T-1");
    assert.match(readFileSync(join(base, "ann", "docs", "TASKS.md"), "utf8"), /T-3 .* the log/);
});

test("what a chat wrote by hand in the docs, a colleague's memory too, is committed and pushed by push; their memories merge line by line", () => {
    put(join(base, "ann", "docs"), "crew/memory/giulia/MEMORY.md", "- Ann likes short answers.\n");
    assert.equal(run("ann", "sync.mjs", "push"), "");
    assert.match(git(base, "--git-dir", "remote.git", "log", "-1", "--format=%s"), /^The docs, synced$/);
    assert.match(readFileSync(join(base, "ann", "docs", ".gitattributes"), "utf8"), /^crew\/memory\/\*\/MEMORY\.md merge=union$/m);
    // Both add a line to Giulia's memory at once: both lines stay.
    run("bob", "sync.mjs", "pull");
    put(join(base, "ann", "docs"), "crew/memory/giulia/MEMORY.md", "- Ann likes short answers.\n- Ann plays on Fridays.\n");
    put(join(base, "bob", "docs"), "crew/memory/giulia/MEMORY.md", "- Ann likes short answers.\n- Bob writes the rules.\n");
    run("ann", "sync.mjs", "push");
    assert.equal(run("bob", "sync.mjs", "push"), "");
    const memory = readFileSync(join(base, "bob", "docs", "crew", "memory", "giulia", "MEMORY.md"), "utf8");
    assert.match(memory, /Ann plays on Fridays/);
    assert.match(memory, /Bob writes the rules/);
    assert.match(run("bob", "sync.mjs", "status"), /kept in sync: 0 commits still to push/);
});

test("two tasks added offline with one number: the first pushed keeps it, the other's moves to the next free one with its note and links", () => {
    const bob = join(base, "bob", "docs");
    const url = git(bob, "remote", "get-url", "origin");
    run("bob", "sync.mjs", "pull");
    run("ann", "sync.mjs", "pull");
    // Bob offline: his task and its part take the numbers Ann takes too.
    git(bob, "remote", "set-url", "origin", join(base, "nowhere.git"));
    const next = Number(/T-(\d+) added/.exec(run("ann", "backlog.mjs", "add", "the rules", "--type", "feature", "--goal", "Core"))[1]);
    assert.match(run("bob", "backlog.mjs", "add", "the inventory", "--type", "feature", "--goal", "Core"), new RegExp(`T-${next} added`));
    run("bob", "backlog.mjs", "add", "the inventory's slots", "--type", "feature", "--goal", "Core", "--in", `T-${next}`);
    run("bob", "backlog.mjs", "comment", `T-${next}`, "--", "Ten slots.");
    // Both change T-1 at once: Ann its priority, Bob its text.
    run("ann", "backlog.mjs", "set", "T-1", "--p", "P1");
    run("bob", "backlog.mjs", "set", "T-1", "--text", "the dice, all of them");
    // Bob back online.
    git(bob, "remote", "set-url", "origin", url);
    // His first task moves past Ann's; his second, numbered after his first, moves past it in turn.
    const told = run("bob", "sync.mjs", "push");
    assert.match(told, new RegExp(`Our T-${next} is now T-${next + 1}: its number was taken meanwhile`));
    assert.match(told, new RegExp(`Our T-${next + 1} is now T-${next + 2}`));
    const tasks = readFileSync(join(bob, "TASKS.md"), "utf8");
    assert.match(tasks, new RegExp(`T-${next} · .* the rules`));
    assert.match(tasks, new RegExp(`T-${next + 1} · .* the inventory \\(type`));
    assert.match(tasks, new RegExp(`T-${next + 2} · .* the inventory's slots \\(in: T-${next + 1}\\)`));
    assert.match(tasks, /T-1 · P1 · .* the dice, all of them/);
    assert.equal(existsSync(join(bob, "tasks", `T-${next}.md`)), false);
    assert.match(readFileSync(join(bob, "tasks", `T-${next + 1}.md`), "utf8"), new RegExp(`^# T-${next + 1} · the inventory[\\s\\S]*Ten slots\\.`, "m"));
    assert.equal(git(bob, "status", "--porcelain"), "");
    assert.equal(git(bob, "rev-list", "--count", "@{u}..HEAD"), "0");
    // Ann, at her next pull, has it all as Bob has.
    run("ann", "sync.mjs", "pull");
    assert.equal(readFileSync(join(base, "ann", "docs", "TASKS.md"), "utf8"), tasks);
    assert.match(run("ann", "check.mjs"), /\b0 errors\b/);
});

test("two decisions written offline with one number: the first pushed keeps it, the other's moves to the next", () => {
    const bob = join(base, "bob", "docs");
    const url = git(bob, "remote", "get-url", "origin");
    run("ann", "sync.mjs", "pull");
    run("bob", "sync.mjs", "pull");
    git(bob, "remote", "set-url", "origin", join(base, "nowhere.git"));
    const add = (person, text) => {
        const file = join(base, person, "docs", "DECISIONS.md");
        writeFileSync(file, readFileSync(file, "utf8").replace(/(\| 1 \| Real dice\. \| \|\r?\n)/, `$1| 2 | ${text} | |\n`));
    };
    add("ann", "Maps on squares.");
    run("ann", "sync.mjs", "push");
    add("bob", "Saves in JSON.");
    git(bob, "remote", "set-url", "origin", url);
    assert.match(run("bob", "sync.mjs", "push"), /Our decision D-2 is now D-3: its number was taken meanwhile/);
    assert.match(readFileSync(join(bob, "DECISIONS.md"), "utf8"), /\| 1 \| Real dice\. \| \|\r?\n\| 2 \| Maps on squares\. \| \|\r?\n\| 3 \| Saves in JSON\. \| \|\r?\n/);
});

test("a clash the merge cannot settle undoes the pull: ours stays committed here, and the user is told how to mend it", () => {
    const bob = join(base, "bob", "docs");
    const url = git(bob, "remote", "get-url", "origin");
    run("ann", "sync.mjs", "pull");
    run("bob", "sync.mjs", "pull");
    git(bob, "remote", "set-url", "origin", join(base, "nowhere.git"));
    put(join(base, "ann", "docs"), "PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n\nThe dice first.\n");
    run("ann", "sync.mjs", "push");
    put(bob, "PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n\nThe map first.\n");
    git(bob, "remote", "set-url", "origin", url);
    // Both added a paragraph at the same place: both kept, theirs first.
    assert.equal(run("bob", "sync.mjs", "push"), "");
    assert.match(readFileSync(join(bob, "PLAN.md"), "utf8"), /The dice first\.\r?\n\r?\nThe map first\./);
    // Both changed the same line: a clash.
    run("ann", "sync.mjs", "pull");
    git(bob, "remote", "set-url", "origin", join(base, "nowhere.git"));
    put(join(base, "ann", "docs"), "PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n\nThe dice, first of all.\nThe map first.\n");
    run("ann", "sync.mjs", "push");
    put(bob, "PLAN.md", "# Plan\n\n## Goals\n\n### Core (phase 1)\n\nThe dice, never.\nThe map first.\n");
    git(bob, "remote", "set-url", "origin", url);
    assert.match(run("bob", "sync.mjs", "push"), /could not take the others' changes/);
    assert.match(readFileSync(join(bob, "PLAN.md"), "utf8"), /The dice, never\./);
    assert.equal(git(bob, "status", "--porcelain"), "");
    assert.equal(existsSync(join(bob, ".git", "rebase-merge")), false);
    // Mended by hand: Bob takes Ann's line, and the next push goes.
    git(bob, "reset", "-q", "--hard", "@{u}");
    assert.equal(run("bob", "sync.mjs", "push"), "");
});

test("one issue taken into the backlog by both offline: the task first pushed stands, the other is left out", () => {
    const bob = join(base, "bob", "docs");
    const url = git(bob, "remote", "get-url", "origin");
    run("ann", "sync.mjs", "pull");
    run("bob", "sync.mjs", "pull");
    git(bob, "remote", "set-url", "origin", join(base, "nowhere.git"));
    // The user's → Backlog, as the panel says it: gh is not asked here.
    const id = /^(T-\d+) added/m.exec(run("ann", "backlog.mjs", "add", "--issue=12", "--approved", "--type", "bug", "--goal", "Core", "--", "The crash"))[1];
    run("bob", "backlog.mjs", "add", "--issue=12", "--approved", "--type", "bug", "--goal", "Core", "--", "The crash, again");
    git(bob, "remote", "set-url", "origin", url);
    assert.match(run("bob", "sync.mjs", "push"), new RegExp(`^${id} was for #12, which someone else had already taken into the backlog`, "m"));
    const tasks = readFileSync(join(bob, "TASKS.md"), "utf8");
    assert.equal(tasks.match(/\(issue: #12\)/g).length, 1);
    assert.match(tasks, new RegExp(`${id} · .* The crash \\(issue: #12\\)`));
    assert.equal(git(bob, "status", "--porcelain"), "");
    assert.equal(git(bob, "rev-list", "--count", "@{u}..HEAD"), "0");
});

test("the start of a session says who works here, written from gh and kept out of the repo; a task says who started it, and is theirs", async () => {
    // The page's port taken, so that the start of the session starts no page of its own.
    const other = createServer((request, response) => response.writeHead(404).end());
    await new Promise((done) => other.listen(0, "127.0.0.1", done));
    const team = join(base, "team");
    put(team, ".claude/project.yaml", `language: en\ndocs: docs\npeople: [Claude, Ann, Bob]\ngithub: { logins: { Ann: asmith } }\npage: { port: ${other.address().port} }\n`);
    put(team, "docs/TASKS.md", "# Backlog\n\n## In progress\n\n- T-9 · P2 · medium · Ann · 2026-01-02 · — · the old one · started 2026-01-02 by Ann\n\n## To do\n\n## Postponed\n\n## Done\n");
    git(team, "init", "-q");
    // The user of gh is Bob by his first name; carla works on the repo and is none of the people.
    put(team, "gh.json", JSON.stringify({ me: "bsmith", name: "Bob Smith", collaborators: ["asmith", "bsmith", "carla", "dependabot[bot]"], issues: [], pulls: [] }));
    const fake = { PROJECT_FAKE_GH: join(dirname(fileURLToPath(import.meta.url)), "fake-gh.mjs"), FAKE_GH_STATE: join(team, "gh.json") };
    const start = () => new Promise((done) => execFile(process.execPath, [join(scripts, "..", "page", "ensure.mjs")], { cwd: team, encoding: "utf8", env: { ...process.env, ...identity, ...fake, CLAUDE_PROJECT_DIR: team } }, (error, stdout) => done(JSON.parse(stdout).hookSpecificOutput.additionalContext)));
    const told = await start();
    assert.match(told, /This machine is Bob's: me: Bob is now in \.claude\/project\.local\.yaml/);
    assert.match(told, /The project's people: Ann, Bob\. Here you work with Bob;/);
    assert.match(told, /On GitHub, carla work on the repo and are none of the project's people/);
    assert.equal(readFileSync(join(team, ".claude", "project.local.yaml"), "utf8"), "me: Bob\n");
    assert.match(git(team, "check-ignore", ".claude/project.local.yaml"), /project\.local\.yaml/);
    // The next start finds it there: written once, excluded once.
    const again = await start();
    assert.doesNotMatch(again, /This machine is Bob's/);
    assert.match(again, /Here you work with Bob;/);
    assert.equal(readFileSync(join(team, ".git", "info", "exclude"), "utf8").match(/project\.local\.yaml/g).length, 1);
    other.close();

    // Bob starts a task: in his name. Ann's, in progress for months, is hers on her machine, not stuck here; on hers, it is.
    const local = (script, ...args) => execFileSync("node", [join(scripts, script), ...args], { cwd: team, encoding: "utf8", env: { ...process.env, ...identity, ...fake, CLAUDE_PROJECT_DIR: team } });
    local("backlog.mjs", "add", "the map", "--type", "feature");
    local("backlog.mjs", "start", "T-10");
    assert.match(readFileSync(join(team, "docs", "TASKS.md"), "utf8"), /T-10 · .* the map \(type: feature\) \(by: Claude\) · started \d{4}-\d{2}-\d{2} by Bob\r?\n/);
    const tasks = () => Object.fromEntries(JSON.parse(local("snapshot.mjs", "--no-health")).tasks.map((task) => [task.id, task]));
    assert.deepEqual([tasks()[9].startedBy, tasks()[9].startedByOther, tasks()[9].stale, tasks()[10].startedByOther], ["Ann", true, false, false]);
    assert.match(local("backlog.mjs", "show", "T-9"), /in progress since 2026-01-02, started by Ann/);
    assert.equal(JSON.parse(local("backlog.mjs", "list", "--json")).find((task) => task.id === 9).startedBy, "Ann");
    writeFileSync(join(team, ".claude", "project.local.yaml"), "me: ann\n");
    assert.deepEqual([tasks()[9].startedByOther, tasks()[9].stale], [false, true]);

    // Ann's GitHub picture, by the login the configuration gives her, on her tasks: asked of gh, and none while it has none; once
    // downloaded, inline in the panel's snapshot.
    const faces = () => JSON.parse(local("snapshot.mjs", "--no-health")).faces;
    assert.deepEqual(faces(), {});
    assert.ok(JSON.parse(readFileSync(join(team, "gh.json"), "utf8")).calls.includes("api users/asmith --jq .avatar_url"));
    const picture = join(tmpdir(), "claude-project", "avatar-asmith.jpg");
    const had = existsSync(picture);

    if (!had) {
        mkdirSync(dirname(picture), { recursive: true });
        writeFileSync(picture, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }

    try {
        assert.deepEqual(Object.keys(faces()), ["Ann"]);
        assert.match(faces().Ann, /^data:image\/jpeg;base64,/);
    } finally {
        if (!had) {
            rmSync(picture);
        }
    }
});

test("the coordinator Crew hired is Claude in the backlog: by their name, drawn with their portrait, never a colleague to hand a task to", () => {
    const crewed = join(base, "crewed");
    put(crewed, ".claude/project.yaml", "language: en\ndocs: docs\npeople: [Claude, Ann]\n");
    put(crewed, "docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n");
    put(crewed, ".claude/agents/marco-coordinator.md", "---\nname: marco-coordinator\ndescription: \"Marco Rossi, the team's coordinator. Talks with the user.\"\ncoordinator: true\ncolor: blue\n---\n\n# Marco Rossi\n");
    put(crewed, ".claude/agents/giulia-tester.md", "---\nname: giulia-tester\ndescription: \"Giulia Bianchi, tester. Plays the game.\"\ncolor: green\n---\n\n# Giulia Bianchi\n");
    assert.match(run("crewed", "backlog.mjs", "add", "the map", "--type", "feature", "--to", "Marco", "--by", "marco rossi"), /^T-1 added: - T-1 · P2 · medium · Claude · .* the map \(type: feature\) \(by: Claude\)$/m);
    assert.match(run("crewed", "backlog.mjs", "add", "the dice", "--type", "test", "--to", "Giulia"), /· Giulia ·/);
    const snapshot = JSON.parse(run("crewed", "snapshot.mjs", "--no-health"));
    assert.deepEqual(snapshot.colleagues.map((one) => one.id), ["giulia-tester"]);
    assert.deepEqual([snapshot.coordinator.id, snapshot.coordinator.name, snapshot.coordinator.fullName, snapshot.coordinator.color], ["marco-coordinator", "Marco", "Marco Rossi", "blue"]);
    // A portrait Claude drew, where Crew had no picture made: drawn as the picture would be; the picture wins where both are.
    put(crewed, ".claude/agent-memory/marco-coordinator/avatar.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"#36c\"/></svg>\n");
    assert.match(JSON.parse(run("crewed", "snapshot.mjs", "--no-health")).coordinator.portrait, /^data:image\/svg\+xml;base64,/);
    put(crewed, ".claude/agent-memory/marco-coordinator/avatar-small.jpg", "\xff\xd8\xff\xd9");
    assert.match(JSON.parse(run("crewed", "snapshot.mjs", "--no-health")).coordinator.portrait, /^data:image\/jpeg;base64,/);
    // Without Crew's coordinator, Claude is Claude.
    put(crewed, ".claude/agents/marco-coordinator.md", "---\nname: marco-coordinator\ndescription: \"Marco Rossi, the team's coordinator.\"\n---\n");
    assert.equal(JSON.parse(run("crewed", "snapshot.mjs", "--no-health")).coordinator, null);
});

test("docs that are not a repo of their own are never synced, and the code's repo is left alone", () => {
    const solo = join(base, "solo");
    put(solo, ".claude/project.yaml", "language: en\ndocs: docs\nsync: auto\n");
    put(solo, "docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n");
    git(solo, "init", "-q");
    assert.match(execFileSync("node", [join(scripts, "sync.mjs"), "status"], { cwd: solo, encoding: "utf8", env: { ...process.env, ...identity, CLAUDE_PROJECT_DIR: solo } }), /is not the top of a git repo of its own/);
    execFileSync("node", [join(scripts, "sync.mjs"), "push"], { cwd: solo, encoding: "utf8", env: { ...process.env, ...identity, CLAUDE_PROJECT_DIR: solo } });
    assert.equal(git(solo, "status", "--porcelain").includes("docs/"), true);
    assert.equal(existsSync(join(solo, "docs", ".gitattributes")), false);
});

function run(person, script, ...args)
{
    const root = join(base, person);
    return execFileSync("node", [join(scripts, script), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...identity, CLAUDE_PROJECT_DIR: root, PROJECT_NO_GH: "1" } }).trim();
}

function git(folder, ...args)
{
    return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", env: { ...process.env, ...identity } }).trim();
}

function put(folder, path, text)
{
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
}
