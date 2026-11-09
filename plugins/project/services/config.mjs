// The project on disk: its root, the folder with .claude/project.yaml from here up; its configuration, read through lib/config.mjs;
// and its name.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { configFile, localConfigFile, readConfig } from "../lib/config.mjs";
import { sayer } from "../lib/messages.mjs";
import { legacyFiles } from "../lib/words.mjs";
import { firstLine, ProjectError } from "./errors.mjs";
import { read } from "./files.mjs";

/** The project whose configuration is in this folder or above: its config and the function that speaks its language. */
export function loadProject(from = process.env.CLAUDE_PROJECT_DIR || process.cwd())
{
    // A configuration kept elsewhere, for trying it on a project before it is written there: read once for its `root:`, which names the
    // project, then from that root.
    if (process.env.PROJECT_CONFIG) {
        const file = process.env.PROJECT_CONFIG;
        const text = read(file);
        const root = configOf(text, dirname(file), file).rootSetting ?? from;
        const config = configOf(text, root, file);
        return { config, say: sayer(config.language) };
    }

    const root = findRoot(from);

    if (root === null) {
        throw new ProjectError(sayer("en")("noConfig"));
    }

    const config = configOf(read(join(root, configFile)), root, configFile, read(join(root, localConfigFile)));
    return { config, say: sayer(config.language) };
}

/** The nearest folder from here up that holds .claude/project.yaml; null when none does. */
export function findRoot(from)
{
    let folder = from;

    while (true) {
        if (existsSync(join(folder, configFile))) {
            return folder;
        }

        const parent = dirname(folder);

        if (parent === folder) {
            return null;
        }

        folder = parent;
    }
}

/** The project's name: the configuration's, else the title of its README, else its folder's. */
export function projectName(config)
{
    return config.name ?? readmeTitle(config.root) ?? config.root.split("/").at(-1);
}

/** The first `# ` heading of a folder's README, as its project calls itself; null without one. */
export function readmeTitle(folder)
{
    return /^# (.+)$/m.exec(read(join(folder, "README.md")))?.[1]?.trim() ?? null;
}

/** The configuration, or a message that says which line of the file is wrong; in English, since the language is in the file that does
 * not read. */
function configOf(text, root, file, local = "")
{
    try {
        return withLegacyNames(readConfig(text, root, local));
    } catch (error) {
        const line = error?.linePos?.[0]?.line;
        throw new ProjectError(`${error?.file ?? file}${line ? `, line ${line}` : ""}: ${firstLine(error)} Fix it, or run /project:init again.`);
    }
}

/** A project made before the core went English: each core file or folder it has under its old Italian name, and not under the new one,
 * read where it is; `legacy` lists them, for the check to say and `init.mjs rename` to rename. */
function withLegacyNames(config)
{
    const legacy = [];
    const files = { ...config.files };
    let { archiveFolder, skip } = config;

    for (const key of ["decisions", "archive", "notes"].filter((one) => !config.namedFiles.includes(one))) {
        const old = `${config.docs}/${legacyFiles[key]}`;

        if (!existsSync(files[key]) && existsSync(old)) {
            legacy.push({ key, from: old, to: files[key] });
            files[key] = old;

            if (key === "archive") {
                archiveFolder = legacyFiles.archiveFolder;
                skip = [...new Set([...skip, archiveFolder])];
            }
        }
    }

    return { ...config, files, archiveFolder, skip, legacy };
}
