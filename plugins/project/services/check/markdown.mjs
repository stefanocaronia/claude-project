// What the check finds in the docs as markdown files: their line endings and links, the index, the frontmatter, the old names, the
// weight; and the mechanical fixes, whitespace and frontmatter.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { betterDescription, joinFrontmatter, splitFrontmatter } from "../../lib/frontmatter.mjs";
import { docFiles, legacyFormat, stampDoc } from "../docs.mjs";
import { read, realPath, shown } from "../files.mjs";

// The keys of a document's frontmatter.
const frontmatterKeys = ["title", "description", "type", "created", "updated"];

/** The docs with trailing spaces or runs of blank lines, as shown paths; without `isWritten`, only found. */
export function fixWhitespace(config, isWritten = true)
{
    const changed = [];

    for (const path of markdownFiles(config)) {
        const text = read(path);
        const newline = text.includes("\r\n") ? "\r\n" : "\n";
        const fixed = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, "")).join(newline).replace(new RegExp(`(${newline}){3,}`, "g"), newline + newline);

        if (fixed !== text) {
            if (isWritten) {
                writeFileSync(path, fixed);
            }

            changed.push(shown(config, path));
        }
    }

    return changed;
}

/** The markdown the check looks after: the configured folders' files (the docs and their subfolders by default, not the archive),
 * and the colleagues' memory and todo. */
export function markdownFiles(config)
{
    const folders = config.markdown ?? [config.docs, ...subfolders(config.docs).filter((name) => name !== config.archiveFolder && !name.startsWith(".")).map((name) => `${config.docs}/${name}`)];
    const docs = folders.filter(existsSync).flatMap((folder) => readdirSync(folder).filter((name) => name.endsWith(".md")).map((name) => `${folder}/${name}`));
    const memory = existsSync(config.memory) ? readdirSync(config.memory).flatMap((id) => ["MEMORY.md", "todo.md"].map((name) => `${config.memory}/${id}/${name}`).filter(existsSync)) : [];
    return [...docs, ...memory];
}

/** The markdown the check looks after: mixed line endings, double blank lines, trailing spaces, links that lead nowhere. */
export function checkMarkdown(config, say, add)
{
    for (const path of markdownFiles(config)) {
        const text = read(path);
        let blank = 0;
        let spaces = 0;

        if (text.includes("\r\n") && /[^\r]\n/.test(text)) {
            add("warning", "markdown", path, null, say("mixedEndings"));
        }

        for (const [index, line] of text.split(/\r?\n/).entries()) {
            blank = line.trim() === "" ? blank + 1 : 0;
            spaces += /[ \t]+$/.test(line) ? 1 : 0;

            if (blank === 2) {
                add("note", "markdown", path, index + 1, say("doubleBlank"));
            }

            for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
                checkLink(say, path, index + 1, match[1], add);
            }
        }

        if (spaces > 0) {
            add("note", "markdown", path, null, say("trailingSpaces", { count: spaces }));
        }
    }
}

/** A relative link of a markdown file: to a file that is not there, or to a heading its file does not have. */
function checkLink(say, file, line, target, add)
{
    if (/^[a-z]+:/i.test(target)) {
        return;
    }

    const [pathPart, anchor] = target.split("#");
    // A link is relative to where the file really is, past any link to its folder (.claude into a private repo).
    const linked = pathPart ? resolve(dirname(realPath(file)), safeDecode(pathPart)) : file;

    if (!existsSync(linked)) {
        add("error", "link", file, line, say("brokenLink", { target: pathPart }));
        return;
    }

    if (anchor && linked.endsWith(".md") && !headingSlugs(read(linked)).has(anchor.toLowerCase())) {
        add("warning", "link", file, line, say("badAnchor", { anchor, target: pathPart || say("thisFile") }));
    }
}

/** The docs of the docs folder that its index does not list: working notes, perhaps for the archive. */
export function checkIndex(config, say, add)
{
    const index = config.files.index;

    if (!existsSync(index)) {
        return;
    }

    const text = read(index);
    const name = index.split("/").at(-1);

    for (const file of readdirSync(config.docs).filter((entry) => entry.endsWith(".md") && entry !== name)) {
        if (!text.includes(`(${file})`)) {
            add("note", "index", `${config.docs}/${file}`, null, say("notIndexed", { index: name, archive: config.archiveFolder }));
        }
    }
}

/** Every markdown document of the project carries its frontmatter: title, description, kind, the day it was created and the day it
 * last changed; `--fix` writes what is missing. */
export function checkFrontmatter(config, say, add)
{
    for (const file of docFiles(config)) {
        const { data, body } = splitFrontmatter(read(file));
        const missing = frontmatterKeys.filter((key) => !data[key]);

        if (missing.length > 0) {
            add("note", "frontmatter", file, 1, say(missing.length === frontmatterKeys.length ? "frontmatterNone" : "frontmatterMissing", { list: missing.join(", ") }));
        } else if (data.type === "doc" && betterDescription(data.description, body)) {
            add("note", "frontmatter", file, 1, say("frontmatterWeak", { text: data.description }));
        }
    }
}

/** The documents whose frontmatter is missing or partial, written whole, the days from git (without `isWritten`, only found); their shown
 * paths. */
export function fixFrontmatter(config, isWritten = true)
{
    const changed = [];

    for (const file of docFiles(config)) {
        const text = read(file);
        const { data, body } = splitFrontmatter(text);

        if (frontmatterKeys.every((key) => data[key])) {
            // A description an older version made from a code line or a label is written again from the first paragraph; the days stay.
            const better = data.type === "doc" ? betterDescription(data.description, body) : "";

            if (better) {
                if (isWritten) {
                    writeFileSync(file, joinFrontmatter({ ...data, description: better }, body));
                }

                changed.push(shown(config, file));
            }

            continue;
        }

        const stamped = stampDoc(config, file, text);

        if (stamped !== text && Object.keys(data).length < Object.keys(splitFrontmatter(stamped).data).length) {
            if (isWritten) {
                writeFileSync(file, stamped);
            }

            changed.push(shown(config, file));
        }
    }

    return changed;
}

/** The core files a project still keeps under their old Italian names: read where they are, renamed by `init.mjs rename`. */
export function checkNames(config, say, add)
{
    for (const { from, to } of config.legacy ?? []) {
        add("note", "names", from, null, say("legacyName", { from: shown(config, from), to: shown(config, to) }));
    }

    for (const file of legacyFormat(config)) {
        add("note", "names", file, null, say("legacyFormat"));
    }
}

/** A doc of the docs folder too heavy to read whole: past the limit of tokens, counted as 3.5 characters each. */
export function checkWeight(config, say, add)
{
    for (const path of markdownFiles(config).filter((file) => file.startsWith(`${config.docs}/`))) {
        const tokens = Math.round(read(path).length / 3.5);

        if (tokens > config.limits.tokens) {
            add("warning", "weight", path, null, say("heavy", { thousands: Math.round(tokens / 1000) }));
        }
    }
}

/** The anchors of a file's headings, as GitHub and Obsidian make them. */
function headingSlugs(text)
{
    return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-")));
}

function subfolders(folder)
{
    return existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
}

function safeDecode(text)
{
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}
