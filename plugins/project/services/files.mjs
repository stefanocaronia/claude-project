// The project's files on disk: read, and written whole; their paths as the messages show them; the plugin's temporary folder; and
// today, as the files write a day.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { relativeTo } from "../lib/config.mjs";
import { fail } from "./errors.mjs";

// The codes of a file another program holds a moment, on Windows (the page, an editor).
const busyCodes = ["EPERM", "EBUSY", "EACCES"];

/** The plugin's folder in the system's temporary one: the chats' holds, gh's readings, the owner's picture, a release's notes. */
export const tempFolder = join(tmpdir(), "claude-project");

/** A path for messages: relative to the project's root, with "/". */
export function shown(config, path)
{
    return relativeTo(config.root, path.replaceAll("\\", "/"));
}

/** A file's text; "" for a file that is not there. */
export function read(path)
{
    // Without the byte-order mark some editors and PowerShell put first, which a heading, a frontmatter or JSON would not read past.
    return existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : "";
}

/** A file written, its folder made when missing. */
export function write(path, text)
{
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
}

/** A path for comparing: with "/", lowercased. */
export function normalized(path)
{
    return String(path).replaceAll("\\", "/").toLowerCase();
}

/** Where a path really is, past any link on the way; the path itself when it does not exist. */
export function realPath(path)
{
    try {
        return realpathSync.native(path);
    } catch {
        return path;
    }
}

/** Today, as the files write a day: the local date, YYYY-MM-DD. */
export function today(date = new Date())
{
    return date.toLocaleDateString("sv-SE");
}

/** A file put in place of another; on Windows a reader that holds the old one refuses it for a moment: tried again for a second before
 * giving up. */
function replace(from, to)
{
    for (let tries = 0; ; tries++) {
        try {
            renameSync(from, to);
            return;
        } catch (error) {
            if (!busyCodes.includes(error.code) || tries >= 20) {
                throw error;
            }

            pause(50);
        }
    }
}

/** A file written whole or not at all: to a temporary file beside it, then renamed; a file another program holds says so. */
export function writeWhole(path, text, say)
{
    const temporary = `${path}.${process.pid}.tmp`;

    try {
        write(temporary, text);
        replace(temporary, path);
    } catch (error) {
        try {
            unlinkSync(temporary);
        } catch {
            // nothing was written
        }

        if (busyCodes.includes(error.code)) {
            fail(say("cannotWrite", { file: path, code: error.code }));
        }

        throw error;
    }
}

/** Waits a few milliseconds: the scripts run synchronously, a lock or a held file waited for in place. */
export function pause(ms)
{
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The paths a configured place stands for, a `*` in a part of it matching any name there; the place itself without one. */
export function expand(pattern)
{
    const parts = pattern.split("/");
    const at = parts.findIndex((part) => part.includes("*"));

    if (at < 0) {
        return [pattern];
    }

    const base = parts.slice(0, at).join("/") || "/";
    const matcher = new RegExp(`^${parts[at].split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

    if (!isFolder(base)) {
        return [];
    }

    return readdirSync(base).filter((name) => matcher.test(name)).flatMap((name) => expand([base, name, ...parts.slice(at + 1)].join("/")));
}

export function isFolder(path)
{
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
