// The documents' frontmatter kept true after a hand edit:
//   node docs.mjs stamp <file>…   (each a project's document: its frontmatter written whole, its last change today)
//   node docs.mjs hook            (the plugin's PostToolUse hook: the file Claude just wrote or edited, from the hook's JSON on stdin)
// Silent, and never in the way: a file that is no document of a project, or a project that does not read, is left alone.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findRoot, isDoc, isMain, loadProject, read, stampDoc, write } from "./project.mjs";

if (isMain(import.meta.url)) {
    const [command, ...files] = process.argv.slice(2);

    try {
        if (command === "hook") {
            const input = JSON.parse(readFileSync(0, "utf8") || "{}");
            const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;

            if (typeof file === "string" && file.toLowerCase().endsWith(".md")) {
                stamp(resolve(input.cwd ?? process.cwd(), file));
            }
        } else if (command === "stamp") {
            files.forEach((file) => stamp(resolve(file)));
        }
    } catch {
        // a hook never stops the work it follows
    }
}

/** A document touched just now: its frontmatter whole, its last change today; written only when that changes it. */
export function stamp(path)
{
    const file = path.replaceAll("\\", "/");
    const root = findRoot(dirname(file));

    if (root === null) {
        return false;
    }

    const { config } = loadProject(root);

    if (!isDoc(config, file)) {
        return false;
    }

    const text = read(file);
    const stamped = stampDoc(config, file, text, true);

    if (stamped !== text) {
        write(file, stamped);
        return true;
    }

    return false;
}
