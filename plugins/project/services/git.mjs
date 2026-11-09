// git, run in a folder: the top of its repo, the project's repos, a file moved with its history.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { realPath } from "./files.mjs";

// The top of the repo each folder is in, by folder.
const tops = new Map();

/** The top of the git repo a folder is in, lowercased, for comparing; "" outside git. A folder in a repo stays in it while a script or
 * the page runs: git is asked once; a folder in none, again, until it is. */
export function repoTop(folder)
{
    if (!tops.get(folder)) {
        tops.set(folder, git(folder, ["rev-parse", "--show-toplevel"]).trim().toLowerCase());
    }

    return tops.get(folder);
}

/** The project's repos: the configured ones, else the project's and, when the docs are a repo of their own, theirs. */
export function projectRepos(config)
{
    if (config.repos) {
        return config.repos;
    }

    const project = repoTop(config.root);
    const docs = existsSync(config.docs) ? repoTop(realPath(config.docs)) : "";
    return [{ name: config.words.repoProject, path: config.root }, ...(docs && docs !== project ? [{ name: config.words.repoDocs, path: realPath(config.docs) }] : [])];
}

/** A file or folder moved to its new path, with `git mv` where git tracks it, so that its history follows; renamed where git does not. */
export function moveFile(from, to)
{
    const folder = dirname(from);
    mkdirSync(dirname(to), { recursive: true });

    if (git(folder, ["ls-files", "--error-unmatch", "--", basename(from)]) !== "") {
        git(folder, ["mv", "--", basename(from), relative(folder, to).replaceAll("\\", "/")]);
    }

    // git mv says nothing either way: a file still in its place is one it did not move.
    if (existsSync(from)) {
        renameSync(from, to);
    }
}

/** A git command in a folder, its output; empty when git fails or is missing. */
export function git(folder, args)
{
    try {
        return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return "";
    }
}
