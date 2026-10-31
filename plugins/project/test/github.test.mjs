// The project on GitHub: what github.mjs reads and the steps it gives, on small projects; with git and gh, and with none on the path.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gitHubRepo, pagesYaml, siteOf } from "../scripts/github.mjs";
import { onPath } from "../scripts/project.mjs";

const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

test("a remote's repo on GitHub, a site and how it builds, the Pages workflow, a program on the path", () => {
    assert.equal(gitHubRepo("git@github.com:stefanocaronia/claude-project.git"), "stefanocaronia/claude-project");
    assert.equal(gitHubRepo("https://github.com/a/b"), "a/b");
    assert.equal(gitHubRepo("https://gitlab.com/a/b.git"), null);
    assert.equal(gitHubRepo(null), null);

    const root = mkdtempSync(join(tmpdir(), "claude-project-site-"));
    assert.equal(siteOf(root), null);
    put(root, "site/index.html", "<h1>Hi</h1>");
    assert.deepEqual(siteOf(root), { kind: "static", folder: "site", build: null });
    put(root, "package.json", JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^5" } }));
    assert.deepEqual(siteOf(root), { kind: "vite", folder: "dist", build: "npm run build" });
    rmSync(root, { recursive: true, force: true });

    const built = pagesYaml("dist", "npm run build", "main", true);
    assert.match(built, /branches: \[main\]/);
    assert.match(built, /uses: actions\/setup-node@v4[\s\S]*cache: npm[\s\S]*run: npm ci\n {6}- run: npm run build/);
    assert.match(built, /upload-pages-artifact@v3\n {8}with:\n {10}path: dist\n[\s\S]*actions\/deploy-pages@v4/);
    assert.doesNotMatch(pagesYaml(".", null), /setup-node|run: /);

    assert.equal(onPath("node", dirname(process.execPath)), true);
    assert.equal(onPath("surely-no-such-program", dirname(process.execPath)), false);
});

test("without git and gh, status says what is missing and install says how; the start of a session tells Claude", async () => {
    // The page's port taken by another server, so that the start of the session starts no page of its own here.
    const other = createServer((request, response) => response.writeHead(404).end());
    await new Promise((done) => other.listen(0, "127.0.0.1", done));
    const root = project(`page: { port: ${other.address().port} }\n`);
    const bare = { ...environment(), PATH: dirname(process.execPath), Path: dirname(process.execPath) };
    const status = run(root, ["status"], bare).stdout;
    assert.match(status, /✗ git missing\n✗ gh missing/);
    assert.match(status, /Next: install git and gh/);
    assert.match(run(root, ["install"], bare).stdout, /gh auth login --web --git-protocol https\n {2}gh auth setup-git/);
    // Run apart, so that the server here answers it meanwhile.
    const output = await new Promise((done) => execFile(process.execPath, [join(scripts, "..", "page", "ensure.mjs")], { cwd: root, encoding: "utf8", env: { ...bare, CLAUDE_PROJECT_DIR: root } }, (error, stdout) => done(stdout)));
    const start = JSON.parse(output);
    assert.match(start.hookSpecificOutput.additionalContext, /git or gh is missing here \(git, gh\): .*offer the github skill/);
    other.close();
    rmSync(root, { recursive: true, force: true });
});

test("a repo not on GitHub: connect gives the commands, private by default; pages writes its workflow; domain gives the records; release its notes", { skip: onPath("git") ? false : "no git here" }, () => {
    const root = project();
    execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
    put(root, "public/index.html", "<h1>Hi</h1>");
    const env = environment();

    const status = run(root, ["status", "--json"], env);
    const state = JSON.parse(status.stdout);
    assert.deepEqual([state.branch, state.github, state.site], ["main", null, { kind: "static", folder: "public", build: null }]);
    assert.match(run(root, ["connect"], env).stdout, /a private repo[\s\S]*gh repo create claude-project-gh-[\w-]+ --private --source \. --remote origin --push/i);
    assert.match(run(root, ["connect", "--public", "--name", "site"], env).stdout, /gh repo create site --public/);
    assert.match(run(root, ["connect", "--docs"], env).stdout, /not in a repo of their own/);

    assert.match(run(root, ["pages", "--write"], env).stdout, /\.github\/workflows\/pages\.yml written: the folder public/);
    assert.match(readFileSync(join(root, ".github/workflows/pages.yml"), "utf8"), /path: public/);
    assert.match(JSON.parse(run(root, ["status", "--json"], env).stdout).workflow, /pages\.yml$/);

    const apex = run(root, ["domain", "example.com"], env).stdout;
    assert.equal(apex.match(/ A {5}185\.199\.1\d\d\.153/g).length, 4);
    assert.equal(apex.match(/ AAAA {2}2606:50c0:800\d::153/g).length, 4);
    assert.match(apex, /www\.example\.com {2}CNAME {2}<owner>\.github\.io/);
    assert.match(run(root, ["domain", "docs.example.com"], env).stdout, /docs\.example\.com {2}CNAME/);
    assert.match(run(root, ["domain", "nope"], env).stderr, /«nope» is not a domain/);

    assert.match(run(root, ["release", "0.1.0"], env).stderr, /No notes for v0\.1\.0/);
    put(root, "docs/releases/v0.1.0.md", "---\ntitle: v0.1.0\ndescription: The dice roll.\ntype: release\n---\n\n# v0.1.0 · 2026-10-31\n\nThe dice roll.\n\n## Added\n\n- T-1 · the dice\n");
    const release = run(root, ["release", "0.1.0", "--write"], env).stdout;
    assert.match(release, /git tag -a v0\.1\.0[\s\S]*gh release create v0\.1\.0 --title "v0\.1\.0" --notes-file "([^"]+)"/);
    const notes = /--notes-file "([^"]+)"/.exec(release)[1];
    assert.equal(readFileSync(notes, "utf8"), "The dice roll.\n\n## Added\n\n- T-1 · the dice\n");
    assert.ok(existsSync(notes));
    rmSync(root, { recursive: true, force: true });
});

function project(extra = "")
{
    const root = mkdtempSync(join(tmpdir(), "claude-project-gh-"));
    put(root, ".claude/project.yaml", `language: en\ndocs: docs\npeople: [Claude]\n${extra}`);
    put(root, "docs/TASKS.md", "# Backlog\n\n## In progress\n\n## To do\n\n## Postponed\n\n## Done\n");
    return root;
}

function environment()
{
    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    return env;
}

function run(root, args, env)
{
    return spawnSync(process.execPath, [join(scripts, "github.mjs"), ...args], { cwd: root, encoding: "utf8", env });
}

function put(root, path, text)
{
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}
