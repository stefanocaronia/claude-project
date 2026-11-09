// The project's repo on GitHub: its name from the remote, without credentials; its site, and the workflow that publishes it on Pages.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function safeJson(text)
{
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
