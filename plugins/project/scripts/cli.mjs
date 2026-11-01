#!/usr/bin/env node
// The plugin's commands as one command, `project`, the same outside Claude Code: `project backlog list`, `project check --fix`,
// `project page`. Installed from the plugin's own folder with `npm link`: no dependency, no registry. Each command is the script of the
// same name, run with the arguments that follow, from the folder the command is called in.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sayer } from "../lib/messages.mjs";
import { findRoot, loadProject } from "./project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Each command and its script; `page` starts the project's page, or says where it already is.
const commands = {
    backlog: join(here, "backlog.mjs"),
    plan: join(here, "plan.mjs"),
    decisions: join(here, "decisions.mjs"),
    specs: join(here, "specs.mjs"),
    check: join(here, "check.mjs"),
    init: join(here, "init.mjs"),
    snapshot: join(here, "snapshot.mjs"),
    "task-dates": join(here, "task-dates.mjs"),
    release: join(here, "release.mjs"),
    github: join(here, "github.mjs"),
    page: join(here, "..", "page", "ensure.mjs"),
};
const [command, ...args] = process.argv.slice(2);

if (!Object.hasOwn(commands, command ?? "")) {
    // The help in the project's language, English outside a project; on stderr, and an error, for a command that is not one.
    const from = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const isHelp = !command || ["help", "--help", "-h"].includes(command);
    let language = "en";

    try {
        language = findRoot(from) === null ? "en" : loadProject(from).config.language;
    } catch {
        // a configuration that does not read: the help in English
    }

    (isHelp ? console.log : console.error)(sayer(language)("cliUsage", { command: command ?? "" }));
    process.exitCode = isHelp ? 0 : 1;
} else {
    const run = spawnSync(process.execPath, [commands[command], ...args], { stdio: command === "page" ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" });

    // The page's starter speaks to a session start in JSON: on the command line, its line alone.
    if (command === "page" && run.stdout) {
        const line = run.stdout.trim().split("\n").at(-1) ?? "";

        try {
            console.log(JSON.parse(line).systemMessage);
        } catch {
            console.log(run.stdout.trim());
        }
    }

    process.exitCode = run.status ?? 1;
}
