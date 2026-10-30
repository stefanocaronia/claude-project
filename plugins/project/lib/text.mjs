// Small text helpers the modules share. Pure.

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
