// A project's docs, kept in its repo, made private: a git repo of their own where they are, or in a folder made the repo, their history
// with them.
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { configFile, relativeTo } from "../../lib/config.mjs";
import { quoted } from "../../lib/text.mjs";
import { parseDocument, visit } from "../../lib/vendor/yaml/index.js";
import { fail } from "../errors.mjs";
import { read, shown, write } from "../files.mjs";
import { git } from "../git.mjs";
import { gitIn, ignoreFolder, initRepo } from "./init.mjs";

// Where private --write keeps the docs' rebuilt history in the project's repo while the docs' repo fetches it.
const historyRef = "refs/project-plugin/docs-history";

/** What private would do: the project's repo (none when it is not in one), the new repo's folder, where the docs land in it and under
 * which of its paths, the docs' commits in the project's repo, whether it tracks them; or the repo they are already in. */
export function privatePlan(config, container, say)
{
    if (!existsSync(config.docs)) {
        fail(say("privateNoDocs", { folder: shown(config, config.docs) }));
    }

    const top = git(config.root, ["rev-parse", "--show-toplevel"]).trim();
    const docsTop = git(config.docs, ["rev-parse", "--show-toplevel"]).trim();

    if (docsTop && docsTop.toLowerCase() !== top.toLowerCase()) {
        return { already: shown(config, docsTop) };
    }

    const prefix = top ? relativeTo(top, config.docs) : "";

    if (top && prefix.toLowerCase() === config.docs.toLowerCase()) {
        return { already: shown(config, top) };
    }

    // --in naming the docs' own folder is the docs' folder made the repo.
    const given = container ? resolve(config.root, container).replaceAll("\\", "/") : config.docs;
    const folder = given.toLowerCase() === config.docs.toLowerCase() ? config.docs : given;
    const isMoved = folder !== config.docs;
    const docs = isMoved ? `${folder}/${basename(config.docs)}` : config.docs;

    if (isMoved && existsSync(join(folder, ".git"))) {
        fail(say("privateRepoThere", { folder: shown(config, folder) }));
    }

    if (isMoved && (existsSync(docs) || relativeTo(config.docs, folder) !== folder)) {
        fail(say("privateDocsThere", { folder: shown(config, docs) }));
    }

    const history = top ? git(top, ["rev-list", "HEAD", "--", prefix]).split("\n").filter(Boolean) : [];
    const tracked = top ? git(top, ["ls-files", "--", prefix]).trim() !== "" : false;
    const repos = parseDocument(read(join(config.root, configFile))).get("repos");
    return { top, folder, docs, inner: isMoved ? basename(config.docs) : "", prefix, history, tracked, listsRepos: Boolean(repos?.items) };
}

/** private --write: the docs' history rebuilt, the docs moved when they go into another folder, their repo made with that history, the
 * project's repo leaving them, the configuration following; the files outside the docs that still name their old folder. */
export function privateWrite(config, plan, say)
{
    const head = docsHistory(plan);

    if (head) {
        gitIn(plan.top, ["update-ref", historyRef, head]);
    }

    try {
        if (plan.docs !== config.docs) {
            mkdirSync(plan.folder, { recursive: true });

            try {
                renameSync(config.docs, plan.docs);
            } catch (error) {
                if (readdirSync(plan.folder).length === 0) {
                    rmdirSync(plan.folder);
                }

                fail(say("privateBusy", { folder: shown(config, config.docs), error: error.code ?? error.message }));
            }
        }

        initRepo(plan.folder);

        // The history as the repo's main, the index as its last commit, the files as they are: what the project had not committed yet
        // shows as the docs' repo's own changes.
        if (head) {
            gitIn(plan.folder, ["fetch", "-q", plan.top, historyRef]);
            gitIn(plan.folder, ["update-ref", "refs/heads/main", "FETCH_HEAD"]);
            gitIn(plan.folder, ["reset", "-q"]);
        }
    } finally {
        if (head) {
            git(plan.top, ["update-ref", "-d", historyRef]);
        }
    }

    if (plan.top) {
        ignoreFolder(config.root, relativeTo(config.root, plan.folder));
    }

    if (plan.tracked) {
        gitIn(plan.top, ["rm", "-r", "-q", "--cached", "--", plan.prefix]);
    }

    followInConfig(config, plan);

    if (plan.docs === config.docs || !plan.top) {
        return [];
    }

    // The old folder as a path of its own, not the end of a longer one (project/ in plugins/project/).
    const pattern = `(^|[^[:alnum:]_./-])${plan.prefix.replace(/[.[\]()*+?^$|\\{}]/g, "\\$&")}/`;
    return git(plan.top, ["grep", "-l", "-I", "-E", "-e", pattern, "--", "."]).split("\n").filter(Boolean);
}

/** The docs' commits in the project's repo as commits of their own: each one's tree the docs' folder, under their folder's name when the
 * new repo holds them in a subfolder, with its authors, days and message; one that leaves the docs as they were is none. The last, or
 * null when the project's repo never held them. */
function docsHistory(plan)
{
    if (plan.history.length === 0) {
        return null;
    }

    const fields = ["%H", "%an", "%ae", "%ad", "%cn", "%ce", "%cd", "%B"].join("%x00");
    const commits = gitIn(plan.top, ["log", "--reverse", "--date=raw", `--format=${fields}%x01`, "HEAD", "--", plan.prefix]).split("\x01").map((record) => record.replace(/^\n/, "")).filter(Boolean)
        .map((record) => record.split("\x00"));
    // The docs' folder in each commit, read at once: "<id> tree <size>", or "<name> missing" where the commit lacks it.
    const trees = gitIn(plan.top, ["cat-file", "--batch-check"], { input: commits.map(([hash]) => `${hash}:${plan.prefix}\n`).join("") }).split("\n");
    let parent = null;
    let last = null;

    for (const [index, [, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message]] of commits.entries()) {
        const [tree, kind] = trees[index].split(" ");

        if (kind !== "tree") {
            continue;
        }

        const wrapped = plan.inner ? gitIn(plan.top, ["mktree"], { input: `040000 tree ${tree}\t${plan.inner}\n` }).trim() : tree;

        if (wrapped === last) {
            continue;
        }

        const env = { GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_NAME: committerName, GIT_COMMITTER_EMAIL: committerEmail, GIT_COMMITTER_DATE: committerDate };
        parent = gitIn(plan.top, ["commit-tree", wrapped, ...(parent ? ["-p", parent] : []), "-F", "-"], { input: message, env }).trim();
        last = wrapped;
    }

    return parent;
}

/** The configuration after private: the paths under the docs' old folder under the new one, when the docs moved; the docs' repo in
 * repos:, when the project lists its repos. Changed in its text where those values are, so that the rest stays as the user wrote it. */
function followInConfig(config, plan)
{
    const path = join(config.root, configFile);
    const text = read(path);
    const yaml = parseDocument(text);
    const from = relativeTo(config.root, config.docs);
    const to = relativeTo(config.root, plan.docs);
    // [start, end, text]: a part of the file and what takes its place.
    const edits = [];

    if (from !== to) {
        // Only values naming a path: the project's name and its words stay what they are.
        for (const pair of yaml.contents?.items ?? []) {
            if (!["name", "language", "words", "people", "prefixes", "types"].includes(String(pair.key))) {
                visit(pair.value, { Scalar: (key, node) => {
                    if (key !== "key" && typeof node.value === "string" && (node.value === from || node.value.startsWith(`${from}/`))) {
                        edits.push([node.range[0], node.range[1], text.slice(node.range[0], node.range[1]).replace(from, to)]);
                    }
                } });
            }
        }
    }

    const repos = yaml.get("repos");
    const folder = relativeTo(config.root, plan.folder);

    if (repos?.items && !repos.items.some((repo) => String(repo.get?.("path") ?? "") === folder)) {
        const name = quoted(config.words.repoDocs);

        if (repos.flow) {
            const close = text.lastIndexOf("]", repos.range[1]);
            edits.push([close, close, `${repos.items.length > 0 ? ", " : ""}{ name: ${name}, path: ${quoted(folder)} }`]);
        } else {
            // A list item on lines of its own, at the list's indentation, after its last item.
            const last = repos.items.at(-1);
            const lineStart = text.lastIndexOf("\n", repos.items[0].range[0]) + 1;
            const dash = text.slice(lineStart, repos.items[0].range[0]);
            const end = text.indexOf("\n", last.range[1] - 1) + 1 || text.length;
            edits.push([end, end, `${end === text.length && !text.endsWith("\n") ? "\n" : ""}${dash}name: ${name}\n${" ".repeat(dash.length)}path: ${quoted(folder)}\n`]);
        }
    }

    write(path, edits.sort((one, other) => other[0] - one[0]).reduce((result, [start, end, put]) => `${result.slice(0, start)}${put}${result.slice(end)}`, text));
}
