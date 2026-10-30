// When a task is due and whether it is stuck, from its days and today; the colors of its type. Pure.

/** How far a task's due day is: { day, days (from today, negative when past), isLate, isNear (within a week) }; null without one. */
export function dueOf(due, today)
{
    if (!due) {
        return null;
    }

    const days = daysBetween(today, due);
    return { day: due, days, isLate: days < 0, isNear: days >= 0 && days <= 7 };
}

/** Whether a task in progress has been for more than `limit` days with nobody holding it: no chat, no colleague at work. */
export function isStale(task, isHeld, today, limit)
{
    return task.state === "doing" && Boolean(task.started) && !isHeld && daysBetween(task.started, today) > limit;
}

/** The colors of the task types, as Jira's issue types: a bug red, a feature green, a chore blue, a research purple; others gray. */
export const typeColors = { bug: "#E5493A", feature: "#36B37E", chore: "#4C9AFF", research: "#8777D9", test: "#E2852B" };

export function typeColor(type)
{
    return typeColors[type] ?? "#8993A4";
}

/** Whole days from one day to another, YYYY-MM-DD. */
export function daysBetween(from, to)
{
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
