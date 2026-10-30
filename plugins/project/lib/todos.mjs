// A colleague's todo lines, as Crew writes them: `- [ ] P2 · 2026-10-29 · text`, the priority on open lines, the date on all. Pure.

const taskPattern = /^(\s*)([-*]|\d+b?\.)\s+\[( |x)\]\s+(?:(P[1-3]) · )?(?:(\d{4}-\d{2}-\d{2}) · )?(.*)$/;

/** A checkbox line taken apart, or null when the line is not one. */
export function parseTodo(line)
{
    const match = taskPattern.exec(line);

    if (!match) {
        return null;
    }

    const [, indent, marker, box, priority, created, text] = match;
    return { indent, marker, done: box === "x", priority: priority ?? null, created: created ?? null, text };
}

/** The line again, with what it has of priority and date. */
export function formatTodo(task)
{
    const priority = task.priority && !task.done ? `${task.priority} · ` : "";
    const created = task.created ? `${task.created} · ` : "";
    return `${task.indent}${task.marker} [${task.done ? "x" : " "}] ${priority}${created}${task.text}`;
}

/** A line's text reduced to what stays when it is edited a little: no markdown, no case. */
export function todoKey(text, length)
{
    return text.replace(/\*\*|__|`|~~/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").toLowerCase().replace(/\s+/g, " ").trim().slice(0, length);
}

/** A colleague's first name, as the backlog writes who holds a task, from their agent id: matteo-conti → Matteo. */
export function firstName(id)
{
    const name = id.split("-")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
}
