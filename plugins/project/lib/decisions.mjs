// The decisions' text: a table of rows `| 12 | what is decided | why |`, and the points still open as bullets under the heading of what is
// to decide. Pure.
import { escapeRegex } from "./text.mjs";
import { readable } from "./words.mjs";

/** The decided rows, each with its number, text, why and line, and the open points with their line. */
export function parseDecisions(text, words)
{
    const lines = (text ?? "").split(/\r?\n/);
    const openAt = lines.findIndex((line) => readable(words, "open").some((word) => line.startsWith(`## ${word}`)));
    const decided = [];
    const open = [];

    lines.forEach((line, index) => {
        const row = /^\|\s*(\d+)\s*\|(.*)\|\s*$/.exec(line);

        if (row !== null && (openAt < 0 || index < openAt)) {
            const cells = row[2];
            const last = cells.lastIndexOf(" | ");
            decided.push({ number: Number(row[1]), text: (last < 0 ? cells : cells.slice(0, last)).trim(), why: last < 0 ? "" : cells.slice(last + 3).trim(), line: index + 1 });
        }

        if (openAt >= 0 && index > openAt && line.startsWith("- ")) {
            open.push({ text: line.slice(2).trim(), line: index + 1 });
        }
    });

    return { decided, open, openLine: openAt < 0 ? null : openAt + 1 };
}

/** The numbers of the decisions a text cites, `D-12`, every time they appear. */
export function citedDecisions(text, prefix = "D")
{
    return [...String(text).matchAll(new RegExp(`\\b${escapeRegex(prefix)}-(\\d+)\\b`, "g"))].map((match) => Number(match[1]));
}

/** The next free number: past every row and every number cited anywhere, so that two sessions never take the same. */
export function nextDecision(decided, cited)
{
    return Math.max(0, ...decided.map((decision) => decision.number), ...cited) + 1;
}

/** An open point as the panel shows it: its priority when the line starts with one, the day it carries, and its text without either
 * (nor the parenthesis that holds the day). */
export function proposalOf(text, words, today)
{
    const priority = /^(P[1-3]) · /.exec(text)?.[1] ?? null;
    const rest = priority ? text.slice(5) : text;
    const day = dayOf(rest, words.months, today);
    const plain = rest.replace(new RegExp(`\\s*\\((?:[^()]*?, )?(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2} (?:${words.months.join("|")}))\\)`, "i"), "");
    return { priority, day, text: plain.trim() };
}

/** The day a text carries in parentheses, as YYYY-MM-DD: `(…, 12 october)` in the project's months takes this year, or the last when it
 * would fall ahead of today; `(… 2026-10-12)` as written. */
export function dayOf(text, months, today)
{
    const iso = /\((?:[^()]*?)(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];

    if (iso) {
        return iso;
    }

    const match = new RegExp(`\\((?:[^()]*?, )?(\\d{1,2}) (${months.join("|")})\\b`, "i").exec(text);

    if (!match) {
        return null;
    }

    const month = String(months.indexOf(match[2].toLowerCase()) + 1).padStart(2, "0");
    const year = Number(today.slice(0, 4));
    const day = `${year}-${month}-${match[1].padStart(2, "0")}`;
    return day > today ? `${year - 1}${day.slice(4)}` : day;
}

/** The numbers the table holds twice, and those it skips, below its highest. */
export function numbering(decided)
{
    const numbers = decided.map((decision) => decision.number);
    const twice = [...new Set(numbers.filter((number, index) => numbers.indexOf(number) !== index))];
    const highest = Math.max(0, ...numbers);
    const missing = Array.from({ length: highest }, (_, index) => index + 1).filter((number) => !numbers.includes(number));
    return { twice, missing };
}
