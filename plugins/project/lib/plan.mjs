// The plan's text: the phases' table (`| 2. Name | outcome |`), the goals as `### Name (phase 2)` under the goals heading, and the line
// that says when it was updated. Pure.
import { escapeRegex } from "./text.mjs";

/** The goals of the plan, in order, each with the phase its heading names, or null. */
export function planGoals(text, words)
{
    const part = (text ?? "").split(/^## /m).find((section) => section.startsWith(words.goals)) ?? "";
    const phase = phaseSuffix(words);

    return [...part.matchAll(/^### (.+)$/gm)].map((match) => {
        const { heading, closed } = closedOf(match[1], words);
        const found = phase.exec(heading);
        // What the goal is: the text under its heading, up to the next one.
        const rest = part.slice((match.index ?? 0) + match[0].length);
        const description = rest.slice(0, rest.search(/^#{2,3} /m) < 0 ? rest.length : rest.search(/^#{2,3} /m)).trim();
        return { name: heading.replace(phase, "").trim(), phase: found ? Number(found[1]) : null, description, closed };
    });
}

/** The plan with a goal closed on a day, `### Name (phase 2) · done 2026-10-30`, or open again with no day; null when the goals have
 * no goal of that name. */
export function closeGoal(text, words, name, day)
{
    const part = new RegExp(`^## ${escapeRegex(words.goals)}`, "m").exec(text ?? "");

    if (!part) {
        return null;
    }

    let found = false;
    const phase = phaseSuffix(words);
    const after = text.slice(part.index).replace(/^### (.+)$/gm, (whole, heading) => {
        const { heading: bare } = closedOf(heading, words);

        if (found || bare.replace(phase, "").trim() !== name) {
            return whole;
        }

        found = true;
        return `### ${bare}${day ? ` · ${words.doneMarker} ${day}` : ""}`;
    });
    return found ? text.slice(0, part.index) + after : null;
}

/** The phases of the plan's table, by number, name and what one can do at the end. */
export function planPhases(text)
{
    return [...(text ?? "").matchAll(/^\| (\d+)\. ([^|]+) \| ([^|]+) \|\s*$/gm)].map((match) => ({ number: Number(match[1]), name: match[2].trim(), outcome: match[3].trim() }));
}

/** The day the plan says it was updated, as YYYY-MM-DD, or null. */
export function planUpdated(text, words)
{
    return new RegExp(`${escapeRegex(words.updated)} (\\d{4}-\\d{2}-\\d{2})`).exec(text ?? "")?.[1] ?? null;
}

/** A goal's heading without the day it closed, `· done 2026-10-30` at its end, and that day or null. */
function closedOf(heading, words)
{
    const match = new RegExp(`\\s*· ${escapeRegex(words.doneMarker)} (\\d{4}-\\d{2}-\\d{2})\\s*$`).exec(heading);
    return match ? { heading: heading.slice(0, match.index).trim(), closed: match[1] } : { heading: heading.trim(), closed: null };
}

/** The end of a goal's heading that names its phase, «(phase 2)», the number caught. */
export function phaseSuffix(words)
{
    return new RegExp(`\\s*\\(${escapeRegex(words.phase)} (\\d+)\\)\\s*$`, "i");
}
