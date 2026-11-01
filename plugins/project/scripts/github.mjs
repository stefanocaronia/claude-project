// The project on GitHub, made easy: what is there and what is missing, and the next steps, each a command Claude runs on the user's yes.
// It writes only local files (the Pages workflow, a release's notes for gh); what goes to GitHub it prints, never runs.
//   node github.mjs status [--json]      git, gh and the account, git's identity, the repo and its remote, the private docs' repo, a site,
//                                        its Pages workflow and its Pages
//   node github.mjs install              how to install git and gh here, then sign in
//   node github.mjs connect [--public] [--name <repo>] [--docs]   the commands that put the project, or its private docs (--docs), on GitHub
//   node github.mjs pages [--folder <dir>] [--build "<command>"] [--write]   the workflow that publishes the site on GitHub Pages
//   node github.mjs domain <domain>      the DNS records and the commands for a custom domain on the Pages
//   node github.mjs release <version> [--write]   the tag and the gh release of a version, with its notes
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { splitFrontmatter } from "../lib/frontmatter.mjs";
import { isMain, loadProject, ProjectError, read, runCli, write } from "./project.mjs";

// GitHub Pages' addresses, for an apex domain: its A and AAAA records.
const pagesA = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
const pagesAAAA = ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"];

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

function run(args)
{
    const [command, ...rest] = args;
    const { options, words } = optionsOf(rest);
    const { config, say } = loadProject();
    const state = githubState(config);

    if (command === "status") {
        console.log(options.json ? JSON.stringify(state, null, 2) : statusLines(state, say).join("\n"));
    } else if (command === "install") {
        console.log(installSteps(state, say).join("\n"));
    } else if (command === "connect") {
        console.log(connectSteps(config, state, say, options).join("\n"));
    } else if (command === "pages") {
        console.log(pagesSteps(config, state, say, options).join("\n"));
    } else if (command === "domain") {
        console.log(domainSteps(state, say, words[0]).join("\n"));
    } else if (command === "release") {
        console.log(releaseSteps(config, state, say, words[0], options).join("\n"));
    } else {
        throw new ProjectError(say("githubUsage"));
    }
}

/** What the project has of git and GitHub, read without changing anything; gh is asked only when it is installed. */
export function githubState(config)
{
    const root = config.root;
    const gitVersion = exec(root, "git", ["--version"]);
    const ghVersion = exec(root, "gh", ["--version"]);
    const account = ghVersion ? /Logged in to github\.com (?:account|as) (\S+)/.exec(exec(root, "gh", ["auth", "status"], true) ?? "")?.[1] ?? null : null;
    const top = gitVersion ? exec(root, "git", ["rev-parse", "--show-toplevel"])?.trim().replaceAll("\\", "/") ?? null : null;
    const remote = top ? withoutCredentials(exec(root, "git", ["remote", "get-url", "origin"])) : null;
    const branch = top ? exec(root, "git", ["branch", "--show-current"])?.trim() || "main" : null;
    // The docs, in a repo of their own when their top is not the project's.
    const docsTop = gitVersion && existsSync(config.docs) ? exec(config.docs, "git", ["rev-parse", "--show-toplevel"])?.trim().replaceAll("\\", "/") ?? null : null;
    const docsRepo = docsTop && docsTop.toLowerCase() !== (top ?? "").toLowerCase() ? docsTop : null;
    const docsRemote = docsRepo ? withoutCredentials(exec(docsRepo, "git", ["remote", "get-url", "origin"])) : null;
    const repo = gitHubRepo(remote);
    const site = siteOf(root);
    const workflow = pagesWorkflow(root);
    const pages = repo && account ? pagesOf(root, repo) : null;
    return {
        git: gitVersion ? gitVersion.trim().replace(/^git version /, "") : null,
        gh: ghVersion ? ghVersion.split("\n")[0].replace(/^gh version /, "").replace(/ \(.*$/, "") : null,
        account,
        identity: gitVersion ? { name: exec(root, "git", ["config", "user.name"])?.trim() || null, email: exec(root, "git", ["config", "user.email"])?.trim() || null } : null,
        repo: top,
        branch,
        remote,
        github: repo,
        docsRepo: docsRepo ? relative(root, docsRepo).replaceAll("\\", "/") || "." : null,
        docsRemote,
        docsGithub: gitHubRepo(docsRemote),
        site,
        workflow,
        pages,
        platform: process.platform,
    };
}

/** A remote's address without the user and token an https address may carry, so that status never prints a secret. */
export function withoutCredentials(remote)
{
    return remote?.trim().replace(/^(https?:\/\/)[^@/\s]*@/, "$1") || null;
}

/** A remote's owner and name on GitHub, `owner/name`, from its https or ssh address; null for another host or none. */
export function gitHubRepo(remote)
{
    return /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote ?? "")?.slice(1, 3).join("/") ?? null;
}

/** The project's site, when it has one: a folder of a static site, or a build that makes one; null for none. { folder, build, kind } */
export function siteOf(root)
{
    const json = existsSync(join(root, "package.json")) ? safeJson(readFileSync(join(root, "package.json"), "utf8")) : null;
    const deps = { ...(json?.dependencies ?? {}), ...(json?.devDependencies ?? {}) };
    const builds = [["astro", "dist"], ["vite", "dist"], ["@11ty/eleventy", "_site"], ["next", "out"], ["react-scripts", "build"], ["@sveltejs/kit", "build"], ["vitepress", ".vitepress/dist"]];
    const tool = builds.find(([name]) => deps[name]);

    if (json?.scripts?.build && tool) {
        return { kind: tool[0], folder: tool[1], build: "npm run build" };
    }

    if (existsSync(join(root, "_config.yml")) && existsSync(join(root, "Gemfile"))) {
        return { kind: "jekyll", folder: "_site", build: "bundle exec jekyll build" };
    }

    // A static site: an index.html at the root or in one of the usual folders.
    const folder = [".", "site", "public", "www", "web"].find((one) => existsSync(join(root, one, "index.html")));
    return folder ? { kind: "static", folder, build: null } : null;
}

/** The workflow of the repo that deploys to GitHub Pages, its path; null for none. */
function pagesWorkflow(root)
{
    const folder = join(root, ".github", "workflows");

    if (!existsSync(folder)) {
        return null;
    }

    const found = readdirSync(folder).filter((name) => /\.ya?ml$/.test(name)).find((name) => /actions\/deploy-pages@/.test(readFileSync(join(folder, name), "utf8")));
    return found ? `.github/workflows/${found}` : null;
}

/** The Pages of a repo on GitHub: their address, how they build, their domain and whether HTTPS is enforced; null when they are off. */
function pagesOf(root, repo)
{
    const answer = exec(root, "gh", ["api", `repos/${repo}/pages`]);
    const pages = answer ? safeJson(answer) : null;
    return pages?.html_url ? { url: pages.html_url, build: pages.build_type ?? null, domain: pages.cname ?? null, https: pages.https_enforced ?? false } : null;
}

/** Where the project stands, a line each, and the next step. */
function statusLines(state, say)
{
    const mark = (ok) => (ok ? "✓" : "✗");
    const lines = [
        `${mark(state.git)} git ${state.git ?? say("githubMissing")}`,
        `${mark(state.gh)} gh ${state.gh ?? say("githubMissing")}`,
        `${mark(state.account)} ${say("githubAccount")}: ${state.account ?? say("githubNone")}`,
        `${mark(state.identity?.name && state.identity?.email)} ${say("githubIdentity")}: ${state.identity?.name ?? "?"} <${state.identity?.email ?? "?"}>`,
        `${mark(state.repo)} ${say("githubRepo")}: ${state.repo ? `${state.branch}` : say("githubNone")}`,
        `${mark(state.github)} ${say("githubRemote")}: ${state.github ?? state.remote ?? say("githubNone")}`,
        ...(state.docsRepo ? [`${mark(state.docsGithub)} ${say("githubDocsRepo")} ${state.docsRepo}: ${state.docsGithub ?? state.docsRemote ?? say("githubNone")}`] : []),
        ...(state.site ? [`· ${say("githubSite")}: ${state.site.kind}, ${state.site.folder}${state.site.build ? `, ${state.site.build}` : ""}`] : []),
        ...(state.site || state.workflow ? [`${mark(state.workflow)} ${say("githubWorkflow")}: ${state.workflow ?? say("githubNone")}`] : []),
        ...(state.pages ? [`✓ Pages: ${state.pages.url}${state.pages.domain ? ` (${state.pages.domain}${state.pages.https ? ", HTTPS" : ""})` : ""}`] : state.site && state.github ? [`✗ Pages: ${say("githubNone")}`] : []),
    ];
    return [...lines, "", say("githubNext", { step: nextStep(state, say) })];
}

/** The first thing missing, as the step that fixes it. */
function nextStep(state, say)
{
    return !state.git || !state.gh ? say("githubStepInstall")
        : !state.account ? say("githubStepLogin")
        : !state.identity?.name || !state.identity?.email ? say("githubStepIdentity")
        : !state.github ? say("githubStepConnect")
        : state.docsRepo && !state.docsGithub ? say("githubStepDocs")
        : state.site && !state.workflow ? say("githubStepPages")
        : state.site && !state.pages ? say("githubStepPagesOn")
        : say("githubStepNone");
}

/** How to install git and gh on this system, then sign in and set git's identity. */
function installSteps(state, say)
{
    const linux = state.platform === "linux" ? (read("/etc/os-release").match(/^ID(?:_LIKE)?=(.+)$/gm) ?? []).join(" ") : "";
    const install = state.platform === "win32" ? ["winget install --id Git.Git -e --source winget", "winget install --id GitHub.cli -e --source winget"]
        : state.platform === "darwin" ? ["brew install git gh"]
        : /fedora|rhel|centos/.test(linux) ? ["sudo dnf install git gh"]
        : /arch/.test(linux) ? ["sudo pacman -S git github-cli"]
        : ["sudo apt update && sudo apt install git gh", say("githubAptNote")];
    return [
        say("githubInstallTitle"),
        ...install.filter((line, index) => index > 0 || !state.git || !state.gh).map((line) => `  ${line}`),
        say("githubInstallThen"),
        "  gh auth login --web --git-protocol https",
        "  gh auth setup-git",
        say("githubIdentityHow"),
        '  git config --global user.name "<Name Surname>"',
        "  git config --global user.email \"<id>+<login>@users.noreply.github.com\"",
        say("githubNoreply"),
    ];
}

/** The commands that put the project on GitHub, or its private docs with --docs; nothing runs here. */
function connectSteps(config, state, say, options)
{
    if (options.docs) {
        if (!state.docsRepo) {
            return [say("githubNoDocsRepo")];
        }

        const name = typeof options.name === "string" ? options.name : `${basename(config.root)}-docs`;
        return state.docsGithub ? [say("githubAlready", { repo: state.docsGithub })] : [
            say("githubConnectDocs", { folder: state.docsRepo }),
            `  git -C "${state.docsRepo}" add -A`,
            `  git -C "${state.docsRepo}" commit -m "The project's docs"`,
            `  gh repo create ${name} --private --source "${state.docsRepo}" --remote origin --push`,
        ];
    }

    if (state.github) {
        return [say("githubAlready", { repo: state.github }), `  git push -u origin ${state.branch}`];
    }

    const name = typeof options.name === "string" ? options.name : basename(config.root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    return [
        say(options.public ? "githubConnectPublic" : "githubConnectPrivate", { name }),
        ...(state.repo ? [] : ["  git init -b main", "  git add -A", '  git commit -m "First commit"']),
        `  gh repo create ${name} --${options.public ? "public" : "private"} --source . --remote origin --push`,
        say("githubConnectAfter"),
    ];
}

/** The workflow that publishes the site on GitHub Pages, written with --write; then the commands that turn the Pages on. */
function pagesSteps(config, state, say, options)
{
    const site = state.site ?? { kind: "static", folder: ".", build: null };
    const folder = typeof options.folder === "string" ? options.folder : site.folder;
    const build = typeof options.build === "string" ? options.build : site.build;
    const branch = state.branch ?? "main";
    const workflow = pagesYaml(folder, build, branch, existsSync(join(config.root, "package-lock.json")));
    const path = ".github/workflows/pages.yml";

    if (options.write) {
        write(join(config.root, path), workflow);
    }

    return [
        options.write ? say("githubWorkflowWritten", { path, folder, branch }) : say("githubWorkflowDraft", { path, folder, branch }),
        ...(options.write ? [] : ["", workflow]),
        say("githubPagesOn"),
        `  gh api -X POST repos/${state.github ?? "<owner>/<repo>"}/pages -f build_type=workflow`,
        `  git add ${path} && git commit -m "Publish the site on GitHub Pages" && git push`,
        "  gh run watch",
        say("githubPagesAddress", { url: state.github ? `https://${state.github.split("/")[0].toLowerCase()}.github.io/${state.github.split("/")[1]}/` : "https://<owner>.github.io/<repo>/" }),
    ];
}

/** The GitHub Actions workflow that builds the site, when it is built, and deploys its folder to Pages on every push to the branch. */
export function pagesYaml(folder, build, branch = "main", hasLock = false)
{
    const steps = [
        "      - uses: actions/checkout@v4",
        ...(build && /npm|npx|pnpm|yarn/.test(build) ? [
            "      - uses: actions/setup-node@v4",
            "        with:",
            "          node-version: 20",
            ...(hasLock ? ["          cache: npm"] : []),
            `      - run: ${hasLock ? "npm ci" : "npm install"}`,
        ] : []),
        ...(build ? [`      - run: ${build}`] : []),
        "      - uses: actions/configure-pages@v5",
        "      - uses: actions/upload-pages-artifact@v3",
        "        with:",
        `          path: ${folder}`,
        "      - id: deployment",
        "        uses: actions/deploy-pages@v4",
    ];
    return [
        "# The site published on GitHub Pages at every push: written by the project plugin (github.mjs pages).",
        "name: Pages",
        "on:",
        "  push:",
        `    branches: [${branch}]`,
        "  workflow_dispatch:",
        "permissions:",
        "  contents: read",
        "  pages: write",
        "  id-token: write",
        "concurrency:",
        "  group: pages",
        "  cancel-in-progress: false",
        "jobs:",
        "  deploy:",
        "    environment:",
        "      name: github-pages",
        "      url: ${{ steps.deployment.outputs.page_url }}",
        "    runs-on: ubuntu-latest",
        "    steps:",
        ...steps,
        "",
    ].join("\n");
}

/** A custom domain on the Pages: the DNS records to set at the registrar, then the commands for GitHub. */
function domainSteps(state, say, domain)
{
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        throw new ProjectError(say("githubBadDomain", { value: domain ?? "" }));
    }

    const owner = (state.github ?? "<owner>/<repo>").split("/")[0].toLowerCase();
    const apex = domain.split(".").length === 2;
    const records = apex
        ? [...pagesA.map((ip) => `  ${domain}  A     ${ip}`), ...pagesAAAA.map((ip) => `  ${domain}  AAAA  ${ip}`), `  www.${domain}  CNAME  ${owner}.github.io`]
        : [`  ${domain}  CNAME  ${owner}.github.io`];
    return [
        say(apex ? "githubDomainApex" : "githubDomainSub", { domain }),
        ...records,
        say("githubDomainVerify"),
        say("githubDomainSet"),
        `  gh api -X PUT repos/${state.github ?? "<owner>/<repo>"}/pages -f cname=${domain}`,
        say("githubDomainCheck", { domain }),
        `  nslookup ${domain}`,
        say("githubDomainHttps"),
        `  gh api -X PUT repos/${state.github ?? "<owner>/<repo>"}/pages -F https_enforced=true`,
    ];
}

/** A version on GitHub: the tag on the release's commit and a release with its notes (written apart, without their frontmatter, with --write). */
function releaseSteps(config, state, say, version, options)
{
    const clean = String(version ?? "").replace(/^v/, "");
    const source = join(config.files.releases, `v${clean}.md`);

    if (!clean || !existsSync(source)) {
        throw new ProjectError(say("githubNoRelease", { version: clean }));
    }

    const { body } = splitFrontmatter(read(source));
    const notes = join(tmpdir(), "claude-project", `release-v${clean}.md`).replaceAll("\\", "/");

    if (options.write) {
        write(notes, body.replace(/^#[^\n]*\n+/, ""));
    }

    // The title, the version alone, as GitHub's releases have it; the summary opens the notes.
    const title = `v${clean}`;
    return [
        say("githubReleaseSteps", { version: clean }),
        `  git tag -a v${clean} -m "v${clean}"`,
        `  git push origin v${clean}`,
        `  gh release create v${clean} --title "${title.replaceAll('"', "'")}" --notes-file "${notes}"`,
        ...(options.write ? [] : [say("githubReleaseWrite")]),
        ...(state.github ? [] : [say("githubReleaseNoRemote")]),
    ];
}

/** A command's output, or null when it is missing or fails; with all, the output whatever the exit (gh auth status speaks on stderr). */
function exec(folder, command, args, all = false)
{
    const result = spawnSync(command, args, { cwd: folder, encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GH_PROMPT_DISABLED: "1" } });

    if (result.error) {
        return null;
    }

    return all ? `${result.stdout ?? ""}${result.stderr ?? ""}` : result.status === 0 ? result.stdout : null;
}

function safeJson(text)
{
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function optionsOf(args)
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        if (args[index].startsWith("--")) {
            const value = args[index + 1];
            options[args[index].slice(2)] = value === undefined || value.startsWith("--") || ["json", "public", "docs", "write"].includes(args[index].slice(2)) ? true : (index++, value);
        } else {
            words.push(args[index]);
        }
    }

    return { options, words };
}
