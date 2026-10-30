// The panel's small drawings, each at a fixed size, so that the width never shrinks them; the text around them is the surface's own.
// They are Crew's (github.com/stefanocaronia/claude-crew, MIT), so that the two panels side by side look alike; the light and dark
// colors follow savvy-progress by johnnyvizz (MIT).
import type { Member } from "../types";

const font = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif";
const theme = `<style>
.k{fill:#e4e4e1}
@media (prefers-color-scheme: dark){.k{fill:#333331}}
</style>`;
// A colleague color in the light theme's tint, the one their initials sit on.
const tints: Record<string, string> = { red: "#b42318", blue: "#1d4ed8", green: "#15803d", yellow: "#8a6100", purple: "#7e22ce", orange: "#c2410c", pink: "#be185d", cyan: "#0e7490" };

/** A colleague's portrait in a circle, or their initials on their color; a person without a profile in gray. */
export function faceSvg(member: Member, uri: string | undefined, size: number): string
{
    const radius = size / 2;
    const initials = member.fullName.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
    const color = tints[member.color] ?? (/^#[0-9a-f]{6}$/i.test(member.color) ? member.color : "#6b6b67");
    const face = uri
        ? `<clipPath id="face"><circle cx="${radius}" cy="${radius}" r="${radius}"/></clipPath><image href="${uri}" x="0" y="0" width="${size}" height="${size}" clip-path="url(#face)" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${radius}" cy="${radius}" r="${radius}" fill="${color}"/><text x="${radius}" y="${radius + radius * 0.28}" text-anchor="middle" font-family="${font}" font-size="${radius * 0.78}" font-weight="600" fill="#ffffff">${xml(initials)}</text>`;
    return svg(size, size, face, false);
}

/** Claude: an orange pixel critter on a round cream background, as Crew draws it in a meeting. */
export function claudeSvg(size: number): string
{
    const rows = [".X........X.", "..X......X..", "..XXXXXXXX..", ".XXXXXXXXXX.", ".XXEEXXEEXX.", "XXXEEXXEEXXX", "XXXXXXXXXXXX", ".XXXXXXXXXX.", "..X.X..X.X..", "..X.X..X.X.."];
    const runs = rows.flatMap((row, y) => [...row.matchAll(/X+|E+/g)].map((run) => `<rect x="${(run.index ?? 0) + 2}" y="${y + 3}" width="${run[0].length}" height="1" fill="${run[0][0] === "E" ? "#2B1D17" : "#D97757"}"/>`));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}"><circle cx="8" cy="8" r="8" fill="#F3E6DC"/><g shape-rendering="crispEdges">${runs.join("")}</g></svg>`;
}

/** A priority as an issue tracker draws it: P1 two red chevrons up, P2 an orange equals, P3 a blue chevron down. */
export function prioritySvg(priority: string): string | undefined
{
    const stroke = (color: string) => `fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
    const marks: Record<string, string> = {
        P1: `<path d="M3.5 7.5L7 4l3.5 3.5M3.5 11L7 7.5l3.5 3.5" ${stroke("#E5493A")}/>`,
        P2: `<path d="M3 5.5h8M3 8.5h8" ${stroke("#E2852B")}/>`,
        P3: `<path d="M3.5 5.5L7 9l3.5-3.5" ${stroke("#4C8FE0")}/>`,
    };
    const mark = marks[priority];
    return mark ? svg(14, 14, mark, false) : undefined;
}

/** A task's type as Jira draws an issue type: a rounded square in its color with a white sign, a bug a dot, a feature a bookmark, a
 * chore a tick, a research a lens; a type of the project's own its first letter. */
export function typeSvg(type: string, color: string): string
{
    const signs: Record<string, string> = {
        bug: `<circle cx="7" cy="7" r="2.6" fill="#ffffff"/>`,
        feature: `<path d="M4.5 3.5h5v7L7 8.6 4.5 10.5z" fill="#ffffff"/>`,
        chore: `<path d="M4 7.2l2 2 4-4.4" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
        research: `<circle cx="6.3" cy="6.3" r="2.4" fill="none" stroke="#ffffff" stroke-width="1.5"/><path d="M8.1 8.1l2.2 2.2" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>`,
        test: `<path d="M5.4 3.2h3.2M6 3.2v2.9L3.7 10.2a.7.7 0 0 0 .6 1h5.4a.7.7 0 0 0 .6-1L8 6.1V3.2" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    };
    const sign = signs[type] ?? `<text x="7" y="10" text-anchor="middle" font-family="${font}" font-size="8" font-weight="700" fill="#ffffff">${xml(type.slice(0, 1).toUpperCase())}</text>`;
    return svg(14, 14, `<rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="${color}"/>${sign}`, false);
}

/** The effort a task needs as four gray bars, low to max; undefined for none or a level it does not know. */
export function effortSvg(level: string): string | undefined
{
    const filled = ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 } as Record<string, number>)[level];

    if (filled === undefined) {
        return undefined;
    }

    return svg(16, 12, [0, 1, 2, 3].map((index) => `<rect x="${index * 4}" y="1" width="3" height="10" rx="1" fill="#8a8a86" fill-opacity="${index < filled ? 1 : 0.3}"/>`).join(""), false);
}


/** A wide bar's square middle, filled or the track, stretched to the room it is given: its rounded ends are `barEndSvg`. */
export function wideBarSvg(color: string | undefined, isFilled: boolean): string
{
    const paint = isFilled ? `fill="${color ?? "#8a8a86"}"` : `class="k"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="6" viewBox="0 0 300 6" preserveAspectRatio="none">${theme}<rect ${paint} width="300" height="6"/></svg>`;
}

/** A rounded end of a wide bar, 3 px wide and never stretched; the filled part's end over the track, where the track goes on. */
export function barEndSvg(side: "start" | "end", color: string | undefined, isFilled: boolean, isOverTrack = false): string
{
    const half = side === "start" ? "M3 0A3 3 0 0 0 3 6Z" : "M0 0A3 3 0 0 1 0 6Z";
    const track = isOverTrack ? `<rect class="k" width="3" height="6"/>` : "";
    return svg(3, 6, track + (isFilled ? `<path d="${half}" fill="${color ?? "#8a8a86"}"/>` : `<path class="k" d="${half}"/>`));
}

function svg(width: number, height: number, body: string, isThemed = true): string
{
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${isThemed ? theme : ""}${body}</svg>`;
}

function xml(text: string): string
{
    return text.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}
