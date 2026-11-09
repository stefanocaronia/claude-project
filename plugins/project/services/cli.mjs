// The command line every command shares: whether a module is the one node runs, its options and words, its errors printed; and the
// programs on the path.
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectError } from "./errors.mjs";
import { realPath } from "./files.mjs";

/** Whether a program is on the path, without running it: `git`, `gh`; on Windows with its .exe or .cmd. */
export function onPath(name, path = process.env.PATH ?? process.env.Path ?? "", windows = process.platform === "win32")
{
    const names = windows ? [`${name}.exe`, `${name}.cmd`, name] : [name];
    return pathFolders(path, windows).some((folder) => names.some((one) => existsSync(join(folder, one))));
}

/** Whether `project`, the plugin's own command (npm link in its folder), is on the path: a link to its scripts/cli.mjs, or npm's
 * shim on Windows that names it. */
export function projectCommandOnPath(path = process.env.PATH ?? process.env.Path ?? "", windows = process.platform === "win32")
{
    const names = windows ? ["project.cmd", "project"] : ["project"];

    for (const folder of pathFolders(path, windows)) {
        for (const name of names.map((one) => join(folder, one)).filter((one) => existsSync(one))) {
            try {
                if (realPath(name).replaceAll("\\", "/").endsWith("/scripts/cli.mjs") || /claude-project[\\/]+scripts[\\/]+cli\.mjs/.test(readFileSync(name, "utf8").slice(0, 4000))) {
                    return true;
                }
            } catch {
                // a file that does not read is no shim of ours
            }
        }
    }

    return false;
}

function pathFolders(path, windows)
{
    return path.split(windows ? ";" : delimiter).filter(Boolean);
}

/** Whether the module of this URL is the one node was asked to run, through links too. */
export function isMain(url)
{
    return Boolean(process.argv[1]) && realPath(resolve(process.argv[1])).toLowerCase() === realPath(fileURLToPath(url)).toLowerCase();
}

/** Runs a command line: a ProjectError is printed and exits 1, anything else is a bug and throws. */
export async function runCli(main)
{
    try {
        await main();
    } catch (error) {
        if (error instanceof ProjectError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
        }

        throw error;
    }
}

/** The options and the words of a command line: the options named in `flags` take no value, the others the word after them, or the one
 * after their = (--text=…), which may start with -- too; one with no word after it is true. After a lone --, every word is text, so that
 * a text never reads as an option. */
export function commandLine(args, flags = [])
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];

        if (arg === "--") {
            words.push(...args.slice(index + 1));
            break;
        } else if (/^--[^=]+=/.test(arg)) {
            options[arg.slice(2, arg.indexOf("="))] = arg.slice(arg.indexOf("=") + 1);
        } else if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const value = args[index + 1];
            options[name] = flags.includes(name) || value === undefined || value.startsWith("--") ? true : (index++, value);
        } else {
            words.push(arg);
        }
    }

    return { options, words };
}
