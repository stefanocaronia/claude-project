// The project's releases, as the trade keeps them: a version, MAJOR.MINOR.PATCH, groups the work done since the last one; its notes,
// one file a version, list that work by kind, the first line its version and day. Pure.
import { escapeRegex, shortened } from "./text.mjs";

// The kind of work a task's type is in a release's notes, as Keep a Changelog groups it, in the notes' order; any other type is "other".
const kinds = new Map([["feature", "added"], ["bug", "fixed"], ["chore", "maintenance"]]);
const kindOrder = [...kinds.values(), "other"];
const kindOf = (task) => kinds.get(task.type) ?? "other";

/** A version as its three numbers, or null when it is not MAJOR.MINOR.PATCH. */
export function parseVersion(text)
{
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim().replace(/^v/, ""));
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

    if (!head) {
        return null;
    }

    const tasks = [...text.matchAll(new RegExp(`^- ${escapeRegex(prefix)}-(\\d+) · `, "gm"))].map((match) => Number(match[1]));
    const summary = text.slice(head.index + head[0].length).split(/\n#{1,6}\s/)[0].trim().split(/\n\s*\n/)[0].trim();
    return { version: head[1], day: head[2], summary, tasks };
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

    summary = shortened(summary);
    return summary.charAt(0).toUpperCase() + summary.slice(1);
}

/** Where a project stands with its releases: the last, the work done since, the next version it suggests, and what makes one due —
 * a goal closed since the last release, or an urgent fix (a P1 bug). */
export function releaseState(releases, tasks, goals, prefix = "T", contracts = [])
{
    const last = releases.at(-1) ?? null;
    const raised = contracts.filter((contract) => contract.state === "raised").map((contract) => contract.name);
    const pending = unreleased(tasks, releases);
    return {
        last,
        pending,
        counts: Object.fromEntries(kindOrder.map((kind) => [kind, pending.filter((task) => kindOf(task) === kind).length])),
        suggested: nextVersion(last?.version, pending, false, raised.length > 0),
        // A contract that went up since the last release: a release is due for it alone.
        raised,
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
 * before 1.0.0), a new feature or a contract gone up MINOR, fixes and the rest PATCH. { version, kind }, kind "breaking", "minor",
 * "contract" (a minor for a contract alone) or "patch"; 0.1.0 and "first" when there is no release yet. */
export function nextVersion(last, tasks, isBreaking = false, contractRaised = false)
{
    if (!last) {
        return { version: "0.1.0", kind: "first" };
    }

    const [major, minor, patch] = parseVersion(last);
    const hasFeature = tasks.some((task) => task.type === "feature");
    const kind = isBreaking ? (major === 0 ? "minor" : "major") : hasFeature || contractRaised ? "minor" : "patch";
    const version = kind === "major" ? `${major + 1}.0.0` : kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
    return { version, kind: isBreaking ? "breaking" : contractRaised && !hasFeature ? "contract" : kind };
}

/** A release's notes: its version and day, a summary, what breaks, the contracts that moved, then the tasks by kind as Keep a Changelog
 * groups them. */
export function renderRelease({ version, day, summary, breaking = [], contracts = [], tasks, prefix = "T", names })
{
    const groups = kindOrder.map((kind) => [kind, tasks.filter((task) => kindOf(task) === kind)]).filter(([, group]) => group.length > 0);
    const lines = [`# v${version} · ${day}`, ""];

    if (summary) {
        lines.push(summary, "");
    }

    if (breaking.length > 0) {
        lines.push(`## ${names.breaking}`, "", ...breaking.map((item) => `- ${item}`), "");
    }

    const moved = contracts.filter((contract) => contract.state === "raised" || contract.state === "lowered");

    if (moved.length > 0) {
        lines.push(`## ${names.contracts}`, "", ...moved.map((contract) => `- ${contract.name}: ${contract.before} → ${contract.current}`), "");
    }

    for (const [kind, group] of groups) {
        lines.push(`## ${names[kind]}`, "", ...group.map((task) => `- ${prefix}-${task.id} · ${task.text}`), "");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}
