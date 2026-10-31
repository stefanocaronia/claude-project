// A document's frontmatter, the YAML block between two `---` lines at its very top: its title, description, kind, the day it was created
// and the day it last changed, and whatever else a project keeps there. Pure.
import { parse } from "./vendor/yaml/index.js";

// The keys the plugin keeps, in their order; any other key a document has follows them as it was.
const ordered = ["title", "description", "type", "created", "updated"];
const day = /^\d{4}-\d{2}-\d{2}$/;

/** A text's frontmatter and the rest: { data, body }; data empty and body the whole text when it has none, or one that does not read. */
export function splitFrontmatter(given)
{
    // A byte order mark some editors write first is no part of the text.
    const text = String(given ?? "").replace(/^﻿/, "");
    const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);

    if (!match) {
        return { data: {}, body: text };
    }

    try {
        const data = parse(match[1]) ?? {};
        return typeof data === "object" && !Array.isArray(data)
            ? { data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value instanceof Date ? value.toISOString().slice(0, 10) : value])), body: text.slice(match[0].length).replace(/^\r?\n/, "") }
            : { data: {}, body: text };
    } catch {
        return { data: {}, body: text };
    }
}

/** The text with this frontmatter on top, the plugin's keys first; a value that YAML could misread written in quotes. */
export function joinFrontmatter(data, body)
{
    const keys = [...ordered.filter((key) => data[key] !== undefined && data[key] !== null), ...Object.keys(data).filter((key) => !ordered.includes(key) && data[key] !== undefined)];
    const value = (key, item) => (typeof item === "string" && (day.test(item) || /^[\w][\w .,'’()/-]*$/.test(item)) && !/^(true|false|null|yes|no|~)$/i.test(item) && !/: /.test(item) ? item : JSON.stringify(item));
    const lines = keys.map((key) => `${key}: ${value(key, data[key])}`);
    return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^(\r?\n)+/, "")}`;
}

/** A document's title: its first `# ` heading, without the marks of markdown; else its file's name. */
export function titleOf(body, name)
{
    const heading = /^# +(.+?)\s*#*\s*$/m.exec(body ?? "")?.[1];
    return heading ? plainLine(heading) : name.replace(/\.md$/i, "");
}

/** A document's description: its first paragraph of prose, the summary quoted under its title included, shortened; not a heading, a
 * table, a list, a label in bold, a line that opens a list (ending with a colon), nor anything in a code block; "" for none. */
export function firstParagraph(body)
{
    const lines = (body ?? "").split(/\r?\n/).map((one) => one.trim());
    const paragraph = [];
    let isCode = false;

    for (const line of lines) {
        if (/^(```|~~~)/.test(line)) {
            isCode = !isCode;
            continue;
        }

        const text = line.replace(/^>\s*(\[!\w+\]\s*)?/, "");
        const isProse = !isCode && text && !/^(#|\||[-*+] |\d+\. |---|<|!\[)/.test(text) && !/^\*\*[^*]+\*\*:?$/.test(text);

        if (isProse && (paragraph.length > 0 || !/:$/.test(text))) {
            paragraph.push(text);
        } else if (paragraph.length > 0) {
            break;
        }
    }

    return shortened(plainLine(paragraph.join(" ")));
}

/** The description to write in place of one the plugin made before 0.8.2, which took the first line that was no heading, table, list
 * or quote: a code line ("flowchart LR"), a label in bold, a line opening a list. "" when the description is not that one (the user's
 * or Claude's own stays), or the first paragraph says the same. */
export function betterDescription(description, body)
{
    const line = (body ?? "").split(/\r?\n/).map((one) => one.trim()).find((one) => one && !/^(#|\||[-*+] |\d+\. |>|```|---|<)/.test(one));
    const made = line ? shortened(plainLine(line)) : "";
    const now = firstParagraph(body);
    return made && description === made && now && now !== made ? now : "";
}

function shortened(text)
{
    return text.length > 200 ? `${text.slice(0, 197).replace(/\s+\S*$/, "")}…` : text;
}

/** A line of markdown as plain words: links as their text, no emphasis or code marks. */
function plainLine(text)
{
    return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}
