// The docs merged when two people changed them at once (D-18). Git runs this as the merge driver sync.mjs sets in the private docs' repo,
// while a pull puts our commits, one by one, on top of the others': in that rebase, <current> is the others' version, with ours replayed
// so far, and <base> and <other> are ours, before and after the commit being replayed.
//   node merge.mjs tasks|decisions|doc <base> <current> <other> <root>
// The backlog is merged task by task, the decisions row by row: a number both sides took stays the others', ours takes the next free one
// and our links to it follow, in this commit and in the next ones; a field both changed keeps ours. Any other doc is merged by its lines,
// its frontmatter key by key, and lines both sides added at the same place are all kept. What it cannot merge it leaves to git, as a
// conflict: sync.mjs then undoes the pull. Each merge's notes (a number changed, a change not kept) go to project-merge.json in the
// repo's git folder: the next commits of the same pull read the numbers changed there, and sync.mjs says them once the pull is done.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBacklog, renderBacklog } from "../lib/backlog.mjs";
import { joinFrontmatter, splitFrontmatter } from "../lib/frontmatter.mjs";
import { readable } from "../lib/words.mjs";
import { isMain } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";

const day = /^\d{4}-\d{2}-\d{2}$/;
const rowPattern = /^\|\s*(\d+)\s*\|(.*)\|\s*$/;
// Where the rows of the decisions stand while the rest of the file is merged by its lines.
const rowsHere = "\u0000project-merge-rows\u0000";
const same = (one, two) => JSON.stringify(one ?? null) === JSON.stringify(two ?? null);

if (isMain(import.meta.url)) {
    const [kind, base, current, other, root] = process.argv.slice(2);
    let code = 1;

    try {
        const { config } = loadProject(root);
        const texts = [base, current, other].map((file) => (existsSync(file) ? readFileSync(file, "utf8") : ""));
        const notes = notesFile(config.docs);
        const earlier = existsSync(notes) ? readFileSync(notes, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
        const merged = kind === "tasks" ? mergeTasks(...texts, config, { archived: archiveIds(config), moved: movedOf(earlier, "tasks") })
            : kind === "decisions" ? mergeDecisions(...texts, config, { moved: movedOf(earlier, "decisions") })
            : mergeDoc(...texts);

        if (merged !== null) {
            writeFileSync(current, merged.text);
            merged.notes.length > 0 && appendFileSync(notes, `${JSON.stringify({ kind, notes: merged.notes })}\n`);
            code = 0;
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
    }

    process.exit(code);
}

/** The backlog merged task by task, or null when it cannot be: { text, notes }. `moved`, the numbers of ours an earlier commit of the same
 * pull changed, ours → now; `archived`, the archive's numbers, which a new one goes past too. */
export function mergeTasks(base, current, other, config, { archived = [], moved = new Map() } = {})
{
    const { words } = config;
    const prefix = config.prefixes.task;
    const [o, a, b] = [base, current, other].map((text) => parseBacklog(text, words, prefix));

    // A line that does not read as a task would be lost in the writing: the lines are merged as they are.
    if ([o, a, b].some((one) => one.unread.length > 0)) {
        return mergeDoc(base, current, other);
    }

    const clean = (list) => list.tasks.map(({ line, ...task }) => task);
    const renumber = (map) => (task) => {
        const link = (id) => (typeof id === "string" && id.startsWith(`${prefix}-`) && map.has(Number(id.slice(prefix.length + 1))) ? `${prefix}-${map.get(Number(id.slice(prefix.length + 1)))}` : id);
        return { ...task, id: map.get(task.id) ?? task.id, ...(task.after ? { after: task.after.map(link) } : {}), ...(task.see ? { see: task.see.map(link) } : {}), ...(task.parent ? { parent: link(task.parent) } : {}) };
    };
    const byId = (list) => new Map(list.map((task) => [task.id, task]));
    const theirs = byId(clean(a));
    const was = byId(clean(o).map(renumber(moved)));
    const notes = [];
    // Ours that this commit added with a number the others took meanwhile: the next free ones, in order; one for an issue the others
    // have a task for already is left out (one task an issue).
    // Ours are numbered as this commit wrote them, before the earlier commits' numbers changed: a task this commit added has its own
    // number still, which may be one an earlier task of ours moved to.
    const issues = new Set([...theirs.values()].map((task) => task.issue).filter(Boolean));
    const ownBefore = new Set(clean(o).map((task) => task.id));
    const added = clean(b).filter((task) => !ownBefore.has(task.id));
    const all = new Map(moved);
    const dropped = new Set();
    let next = Math.max(0, ...[...was.keys(), ...theirs.keys(), ...clean(b).map((task) => task.id), ...moved.values(), ...archived]) + 1;

    for (const task of added.sort((one, two) => one.id - two.id)) {
        if (task.issue && issues.has(task.issue)) {
            dropped.add(task.id);
            notes.push({ id: `${prefix}-${task.id}`, issue: task.issue, dropped: true });
        } else if (was.has(task.id) || (theirs.has(task.id) && !same(theirs.get(task.id), task))) {
            all.set(task.id, next);
            notes.push({ from: `${prefix}-${task.id}`, to: `${prefix}-${next}` });
            next += 1;
        }
    }

    const mine = byId(clean(b).filter((task) => !dropped.has(task.id)).map(renumber(all)));
    const merged = new Map();

    for (const id of [...new Set([...was.keys(), ...theirs.keys(), ...mine.keys()])].sort((one, two) => one - two)) {
        const [before, others, ours] = [was.get(id), theirs.get(id), mine.get(id)];

        if (same(others, ours) || same(before, ours)) {
            others && merged.set(id, others);
        } else if (same(before, others)) {
            ours && merged.set(id, ours);
        } else if (!others || !ours) {
            // Gone on one side (archived or deleted) and changed on the other: gone, and said.
            notes.push({ id: `${prefix}-${id}`, lost: true });
        } else {
            // Both changed it: each field as the side that changed it left it, ours where both did.
            const keys = [...new Set([...Object.keys(others), ...Object.keys(ours)])];
            const pick = (key) => (same(before?.[key], others[key]) ? ours[key] : same(before?.[key], ours[key]) ? others[key] : ours[key]);
            const clashed = keys.filter((key) => !same(before?.[key], others[key]) && !same(before?.[key], ours[key]) && !same(others[key], ours[key]));
            merged.set(id, Object.fromEntries(keys.map((key) => [key, pick(key)]).filter(([, value]) => value !== undefined)));
            clashed.length > 0 && notes.push({ id: `${prefix}-${id}`, kept: clashed });
        }
    }

    const header = mergeDoc(headerText(base, prefix), headerText(current, prefix), headerText(other, prefix));
    return { text: newlines(renderBacklog([...merged.values()], `${header?.text ?? headerText(other, prefix)}## `, words, prefix), current), notes };
}

/** The decisions merged row by row, the rest of the file by its lines; null when it cannot be: { text, notes }. `moved`, the numbers of
 * ours an earlier commit of the same pull changed. */
export function mergeDecisions(base, current, other, config, { moved = new Map() } = {})
{
    const prefix = config.prefixes.decision;
    const split = [base, current, other].map((text) => decisionRows(text, config.words));

    if (split.some((one) => one === null)) {
        return mergeDoc(base, current, other);
    }

    const renumber = (rows, map) => new Map([...rows].map(([number, row]) => (map.has(number) ? [map.get(number), row.replace(rowPattern, (_, __, cells) => `| ${map.get(number)} |${cells}|`)] : [number, row])));
    const [o, a, b] = split;
    const was = renumber(o.rows, moved);
    const theirs = a.rows;
    const all = new Map(moved);
    const notes = [];
    let next = Math.max(0, ...was.keys(), ...theirs.keys(), ...b.rows.keys(), ...moved.values()) + 1;

    // A row this commit added keeps its own number until it is found taken: by the others, or by an earlier row of ours that moved there.
    for (const [number, row] of [...b.rows].filter(([one]) => !o.rows.has(one)).sort(([one], [two]) => one - two)) {
        if (was.has(number) || (theirs.has(number) && theirs.get(number) !== row)) {
            all.set(number, next);
            notes.push({ from: `${prefix}-${number}`, to: `${prefix}-${next}`, decision: true });
            next += 1;
        }
    }

    const mine = renumber(b.rows, all);
    const rest = mergeDoc(o.rest, a.rest, b.rest);

    if (rest === null || !rest.text.includes(rowsHere)) {
        return null;
    }

    const rows = new Map();

    for (const number of [...new Set([...was.keys(), ...theirs.keys(), ...mine.keys()])]) {
        const [before, others, ours] = [was.get(number), theirs.get(number), mine.get(number)];

        if (others === ours || before === ours) {
            others !== undefined && rows.set(number, others);
        } else if (before === others) {
            ours !== undefined && rows.set(number, ours);
        } else if (others === undefined || ours === undefined) {
            notes.push({ id: `${prefix}-${number}`, lost: true });
        } else {
            rows.set(number, ours);
            notes.push({ id: `${prefix}-${number}`, kept: ["text"] });
        }
    }

    const table = [...rows.keys()].sort((one, two) => one - two).map((number) => rows.get(number));
    return { text: newlines(rest.text.replace(table.length > 0 ? rowsHere : `${rowsHere}\n`, table.join("\n")), current), notes: [...rest.notes, ...notes] };
}

/** A doc merged by its lines, its frontmatter key by key (a day both changed: the later), and lines both added at one place all kept;
 * null when the two changed the same lines. { text, notes } */
export function mergeDoc(base, current, other)
{
    if (current === other || base === other) {
        return { text: current, notes: [] };
    }

    if (base === current) {
        return { text: other, notes: [] };
    }

    // The same file made on both sides, each its own (two notes of one number): no line merge would make it one.
    if (base === "") {
        return null;
    }

    const [o, a, b] = [base, current, other].map((text) => splitFrontmatter(text));
    const hasFront = [current, other].some((text) => /^﻿?---\r?\n/.test(text));
    const body = mergeLines(o.body, a.body, b.body);

    if (body === null) {
        return null;
    }

    if (!hasFront) {
        return { text: newlines(body, current), notes: [] };
    }

    const keys = [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])];
    const pick = (key) => {
        const [was, theirs, mine] = [o.data[key], a.data[key], b.data[key]];
        return same(was, theirs) ? mine : same(was, mine) || same(theirs, mine) ? theirs : day.test(String(theirs)) && day.test(String(mine)) ? [theirs, mine].sort().at(-1) : mine;
    };
    const data = Object.fromEntries(keys.map((key) => [key, pick(key)]).filter(([, value]) => value !== undefined));
    return { text: newlines(joinFrontmatter(data, body), current), notes: [] };
}

/** Three texts merged by their lines through git, the hunks both sides added at one place kept whole, theirs first; null for a clash. */
function mergeLines(base, current, other)
{
    if (current === other || base === other) {
        return current;
    }

    if (base === current) {
        return other;
    }

    const folder = mkdtempSync(join(tmpdir(), "claude-project-merge-"));

    try {
        const [o, a, b] = ["base", "current", "other"].map((name, index) => {
            const file = join(folder, name);
            writeFileSync(file, [base, current, other][index].replace(/\r\n/g, "\n"));
            return file;
        });
        let text;

        try {
            text = execFileSync("git", ["merge-file", "-p", "--diff3", "-L", "current", "-L", "base", "-L", "other", a, o, b], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        } catch (error) {
            // Its exit code counts the conflicts; its output has them marked.
            text = String(error.stdout ?? "");

            if (!text) {
                return null;
            }
        }

        return resolveHunks(text);
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
}

/** The conflicts git marked, each kept whole from both sides when the base had nothing there; null when one changed lines of the base. */
function resolveHunks(text)
{
    const out = [];
    let part = null;
    const hunk = { current: [], base: [], other: [] };

    for (const line of text.split("\n")) {
        if (part === null && line === "<<<<<<< current") {
            part = "current";
        } else if (part === "current" && line === "||||||| base") {
            part = "base";
        } else if (part === "base" && line === "=======") {
            part = "other";
        } else if (part === "other" && line === ">>>>>>> other") {
            if (hunk.base.some((one) => one.trim() !== "")) {
                return null;
            }

            out.push(...hunk.current, ...hunk.other.filter((one) => !hunk.current.includes(one) || one.trim() === ""));
            hunk.current = [];
            hunk.base = [];
            hunk.other = [];
            part = null;
        } else if (part) {
            hunk[part].push(line);
        } else {
            out.push(line);
        }
    }

    return part === null ? out.join("\n") : null;
}

/** The decisions' rows by number, and the rest of the text with one mark where the rows were; null without a table. */
function decisionRows(text, words)
{
    const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
    const openAt = lines.findIndex((line) => readable(words, "open").some((word) => line.startsWith(`## ${word}`)));
    const end = openAt < 0 ? lines.length : openAt;
    const rule = lines.findIndex((line, index) => index < end && /^\|\s*:?-{3,}/.test(line));

    if (rule < 0) {
        return (text ?? "").trim() === "" ? { rows: new Map(), rest: "" } : null;
    }

    const rows = new Map();
    let last = rule;

    for (let index = rule + 1; index < end && rowPattern.test(lines[index]); index += 1) {
        rows.set(Number(rowPattern.exec(lines[index])[1]), lines[index]);
        last = index;
    }

    return { rows, rest: [...lines.slice(0, rule + 1), rowsHere, ...lines.slice(last + 1)].join("\n") };
}

/** The numbers an earlier commit of the same pull changed, of one kind: ours → now. */
function movedOf(earlier, kind)
{
    const number = (id) => Number(String(id).split("-").at(-1));
    return new Map(earlier.filter((one) => one.kind === kind).flatMap((one) => one.notes).filter((one) => one.from).map((one) => [number(one.from), number(one.to)]));
}

/** What comes before the backlog's first section: its frontmatter and title. */
function headerText(text, prefix)
{
    const first = (text ?? "").search(new RegExp(`^(## |- ${prefix}-)`, "m"));
    return first >= 0 ? text.slice(0, first) : text ?? "";
}

/** The text with the newlines of the file it replaces. */
function newlines(text, like)
{
    const plain = text.replace(/\r\n/g, "\n");
    return like.includes("\r\n") ? plain.replace(/\n/g, "\r\n") : plain;
}

/** The numbers of the archived tasks, as the docs' working copy has them now: a new number goes past them too. */
function archiveIds(config)
{
    const text = existsSync(config.files.archive) ? readFileSync(config.files.archive, "utf8") : "";
    return parseBacklog(text, config.words, config.prefixes.task, true).tasks.map((task) => task.id);
}

/** Where the merges of one pull leave their notes: the docs' repo's own git folder. */
function notesFile(docs)
{
    const folder = execFileSync("git", ["-C", docs, "rev-parse", "--absolute-git-dir"], { encoding: "utf8", windowsHide: true }).trim();
    return join(folder, "project-merge.json");
}
