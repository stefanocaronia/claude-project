// The project's releases, as the trade keeps them: a version, MAJOR.MINOR.PATCH, groups the work done since the last one; its notes,
// one file a version, list that work by kind, the first line its version and day. Pure.

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

/** A version as its three numbers, or null when it is not MAJOR.MINOR.PATCH. */
export function parseVersion(text)
{
    const match = versionPattern.exec(String(text ?? "").trim().replace(/^v/, ""));
    return match ? match.slice(1).map(Number) : null;
}

/** Negative, zero or positive as one version comes before, with or after another. */
export function compareVersions(first, second)
{
    const [a, b] = [parseVersion(first), parseVersion(second)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** A release's notes read back: its version, its day, its summary (the paragraph under the heading) and the tasks it lists, `- T-12 · …`. */
export function parseRelease(text, prefix = "T")
{
    const head = /^#\s+v?(\d+\.\d+\.\d+)\s+·\s+(\d{4}-\d{2}-\d{2})/m.exec(text);
    const tasks = [...text.matchAll(new RegExp(`^- ${prefix}-(\\d+) · `, "gm"))].map((match) => Number(match[1]));
    const summary = head ? (text.slice(head.index + head[0].length).split(/\n#{1,6}\s/)[0].trim().split(/\n\s*\n/)[0] ?? "").trim() : "";
    return head ? { version: head[1], day: head[2], summary, tasks } : null;
}

/** A version's summary from its tag's or its commit's message, for a version with no notes: the message's first paragraph without the
 * name and version it opens with («engine 0.9.1: …»), its sentences while they fit in about 200 characters; "" when it says nothing more
 * than the version. */
export function messageSummary(message, version)
{
    const number = String(version).replaceAll(".", "\\.");
    const first = String(message ?? "").trim().split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, " ").trim();
    const text = first.replace(new RegExp(`^[^:]{0,60}\\bv?${number}\\b[^:]{0,20}:\\s*`), "").replace(new RegExp(`^(release\\s+)?v?${number}\\.?$`, "i"), "");

    if (!text) {
        return "";
    }

    let summary = "";

    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ«"'(])/)) {
        if (summary && summary.length + 1 + sentence.length > 200) {
            break;
        }

        summary = summary ? `${summary} ${sentence}` : sentence;
    }

    summary = summary.length > 200 ? `${summary.slice(0, 197).replace(/\s+\S*$/, "")}…` : summary;
    return summary.charAt(0).toUpperCase() + summary.slice(1);
}

/** Where a project stands with its releases: the last, the work done since, the next version it suggests, and what makes one due —
 * a goal closed since the last release, or an urgent fix (a P1 bug). */
export function releaseState(releases, tasks, goals, prefix = "T")
{
    const last = releases.at(-1) ?? null;
    const pending = unreleased(tasks, releases);
    const count = (type) => pending.filter((task) => (type === "other" ? !["feature", "bug", "chore"].includes(task.type) : task.type === type)).length;
    return {
        last,
        pending,
        counts: { added: count("feature"), fixed: count("bug"), maintenance: count("chore"), other: count("other") },
        suggested: nextVersion(last?.version, pending),
        closedGoals: goals.filter((goal) => goal.closed && (!last || goal.closed > last.day)).map((goal) => goal.name),
        urgent: pending.filter((task) => task.type === "bug" && task.priority === "P1").map((task) => `${prefix}-${task.id}`),
    };
}

/** The tasks done and in no release yet, the oldest first: done, or archived after being done. A release known only by its tag, with no
 * notes to list its tasks, holds every task done by its day. */
export function unreleased(tasks, releases)
{
    const released = new Set(releases.flatMap((release) => release.tasks));
    const tagged = releases.filter((release) => release.tagOnly && release.day).map((release) => release.day).sort().at(-1) ?? "";
    return tasks.filter((task) => task.done && !released.has(task.id) && !(tagged && task.done <= tagged)).sort((first, second) => first.done.localeCompare(second.done) || first.id - second.id);
}

/** The next version for these tasks, by the rule of Semantic Versioning: a change that breaks what users rely on raises MAJOR (MINOR
 * before 1.0.0), a new feature MINOR, fixes and the rest PATCH. { version, kind }; 0.1.0 when there is no release yet. */
export function nextVersion(last, tasks, isBreaking = false)
{
    if (!last) {
        return { version: "0.1.0", kind: "first" };
    }

    const [major, minor, patch] = parseVersion(last);
    const kind = isBreaking ? (major === 0 ? "minor" : "major") : tasks.some((task) => task.type === "feature") ? "minor" : "patch";
    const version = kind === "major" ? `${major + 1}.0.0` : kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
    return { version, kind: isBreaking ? "breaking" : kind };
}

/** A release's notes: its version and day, a summary, what breaks, then the tasks by kind as Keep a Changelog groups them. */
export function renderRelease({ version, day, summary, breaking = [], tasks, prefix = "T", names })
{
    const groups = [
        ["added", tasks.filter((task) => task.type === "feature")],
        ["fixed", tasks.filter((task) => task.type === "bug")],
        ["maintenance", tasks.filter((task) => task.type === "chore")],
        ["other", tasks.filter((task) => !["feature", "bug", "chore"].includes(task.type))],
    ].filter(([, group]) => group.length > 0);
    const lines = [`# v${version} · ${day}`, ""];

    if (summary) {
        lines.push(summary, "");
    }

    if (breaking.length > 0) {
        lines.push(`## ${names.breaking}`, "", ...breaking.map((item) => `- ${item}`), "");
    }

    for (const [kind, group] of groups) {
        lines.push(`## ${names[kind]}`, "", ...group.map((task) => `- ${prefix}-${task.id} · ${task.text}`), "");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}
