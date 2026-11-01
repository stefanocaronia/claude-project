// Small helpers the modules share: text, regular expressions, the lists gh prints and the maps a YAML file holds. Pure.

/** A text as a regular expression matches it literally. */
export function escapeRegex(text)
{
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A text as words are compared: lower case, without accents. */
export function plain(text)
{
    return String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Markdown as plain text, enough for a label: no emphasis or code marks, a link as its words, one line. */
export function plainMarkdown(text)
{
    return String(text).replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
}

/** A value for a line of YAML: bare when it can be, quoted otherwise. */
export function quoted(text)
{
    return /^[\w./-]+$/.test(text) ? text : JSON.stringify(text);
}

/** A text cut to about 200 characters at a word's end, with an ellipsis; as it is when it is shorter. */
export function shortened(text)
{
    return text.length > 200 ? `${text.slice(0, 197).replace(/\s+\S*$/, "")}…` : text;
}

/** Whether a value is a map, `{ key: value }`: an object, not a list nor null. */
export function isMap(value)
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The items of a JSON list, as gh prints them, each made by `read`; empty when the text is no list or does not read. */
export function jsonList(json, read)
{
    try {
        const list = JSON.parse(json || "[]");
        return Array.isArray(list) ? list.map(read) : [];
    } catch {
        return [];
    }
}
