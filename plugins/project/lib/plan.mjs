// The plan's text: the phases' table (`| 2. Name | outcome |`), the goals as `### Name (phase 2)` under the goals heading, and the line
// that says when it was updated. Pure.
import { escapeRegex } from "./text.mjs";

/** The goals of the plan, in order, each with the phase its heading names, or null. */
export function planGoals(text, words)
{
    const part = (text ?? "").split(/^## /m).find((section) => section.startsWith(words.goals)) ?? "";
    const phase = phaseSuffix(words);

    return [...part.matchAll(/^### (.+)$/gm)].map((match) => {
        const found = phase.exec(match[1]);
        return { name: match[1].replace(phase, "").trim(), phase: found ? Number(found[1]) : null };
    });
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

/** The end of a goal's heading that names its phase, «(phase 2)», the number caught. */
export function phaseSuffix(words)
{
    return new RegExp(`\\s*\\(${escapeRegex(words.phase)} (\\d+)\\)\\s*$`, "i");
}
