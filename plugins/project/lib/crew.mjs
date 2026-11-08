// Crew's profiles as Crew reads them too, so that a colleague and the coordinator are one person in both plugins: their name, full name
// and role from the heading, their color from the contract's table, and a name compared without case or accents. Pure.
import { firstName } from "./todos.mjs";

/** Claude Code's agent colors as both plugins draw them (the contract's Colors); anything else is gray. */
export const crewColors = { red: "#C0453A", blue: "#3F7CC4", green: "#4E9A6B", yellow: "#C9A227", purple: "#8A63C9", orange: "#D9773A", pink: "#D0679B", cyan: "#2FA3B5" };
export const crewGray = "#888780";

/** A profile's `color:` as drawn: one of Claude Code's names, a hex as it is, else gray. */
export function colorOf(value)
{
    const color = String(value ?? "").trim();
    return crewColors[color.toLowerCase()] ?? (/^#[0-9a-f]{3,8}$/i.test(color) ? color : crewGray);
}

/** A profile, `.claude/agents/<id>.md`, as both plugins read it: the heading `# <First> <Last>, <role>` gives the full name, before the
 * first comma, its first word, the name, and the role, after it; without a heading, the id's first part is the name and the full name.
 * The frontmatter's `color:` gives the color. { name, fullName, role, color }. */
export function profileFrom(id, text)
{
    const profile = String(text ?? "").replace(/\r\n/g, "\n");
    const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(profile);
    const heading = /^# (.+)$/m.exec(frontmatter ? profile.slice(frontmatter[0].length) : profile)?.[1]?.trim() ?? "";
    const [full = "", ...role] = heading.split(",");
    const fullName = full.trim() || firstName(id);
    const color = /^color:\s*["']?([^"'\s#]+|#[0-9a-fA-F]+)["']?\s*$/m.exec(frontmatter?.[1] ?? "")?.[1];
    return { name: fullName.split(/\s+/)[0], fullName, role: role.join(",").trim(), color: colorOf(color) };
}

/** A name as compared: without case or accents, so that Nicolò and nicolo are one person. */
export function nameKey(name)
{
    return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
