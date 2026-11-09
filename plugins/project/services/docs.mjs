// The project's documents: the plan's goals and the decisions read, the files a number may be cited in, each doc's frontmatter kept
// true, a task's note, and the core files still written in the format's old words.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDecisions } from "../lib/decisions.mjs";
import { firstParagraph, joinFrontmatter, splitFrontmatter, titleOf } from "../lib/frontmatter.mjs";
import { sayer } from "../lib/messages.mjs";
import { planGoals } from "../lib/plan.mjs";
import { expand, isFolder, normalized, read, realPath, today, write } from "./files.mjs";
import { git } from "./git.mjs";

/** The plan's goals, in order, each with its phase and, once closed, its day. */
export function readGoals(config)
{
    return planGoals(read(config.files.plan), config.words);
}

/** The decisions: { decided, open, openLine }, the rows of the table and the points still to decide. */
export function readDecisions(config)
{
    return parseDecisions(read(config.files.decisions), config.words);
}

/** Where a task's note is, `<docs>/tasks/T-12.md`, whether it is written or not. */
export function notePath(config, id)
{
    return `${config.files.notes}/${config.prefixes.task}-${id}.md`;
}

/** The text files under the configured places a decision may be cited in, a `*` in a part of a path matching any name; a file reached
 * by two paths (a folder and a link to it) once. A test in a folder (`*.test.*`, `*.spec.*`) is left out: its D-n are made-up data. */
export function citingFiles(config)
{
    const extensions = /\.(md|ts|tsx|js|mjs|cjs|yaml|yml|json|css|py)$/;
    const tests = /\.(test|spec)\.\w+$/;
    const skip = new Set(config.skip);
    const files = new Map();
    const add = (path) => files.set(realPath(path).toLowerCase(), path.replaceAll("\\", "/"));

    const walk = (path) => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, entry.name);

            if (entry.isDirectory()) {
                if (!skip.has(entry.name)) {
                    walk(child);
                }
            } else if (extensions.test(entry.name) && !tests.test(entry.name) && entry.name !== "package-lock.json") {
                add(child);
            }
        }
    };

    for (const place of config.cites.flatMap(expand)) {
        if (!existsSync(place)) {
            continue;
        }

        if (isFolder(place)) {
            walk(place);
        } else if (extensions.test(place)) {
            add(place);
        }
    }

    return [...files.values()];
}

/** The plugin's own markdown documents: the core (the plan, the backlog, the decisions, the index, with the archive's, the tasks' notes'
 * and the releases' folders) and the project-management docs the user adds beside them (a GDD, a specification) or names in
 * `documents:`; each once. Not the folders the user adds in the docs (playtests, branding), nor the project's own markdown, nor the
 * colleagues' memory, which is Crew's. */
export function docFiles(config)
{
    const markdown = (folder) => (existsSync(folder) ? readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".md")).map((name) => `${folder.replaceAll("\\", "/")}/${name}`) : []);
    const files = [
        ...[config.docs, dirname(config.files.archive), config.files.notes, config.files.releases].flatMap(markdown),
        ...(config.documents ?? []).map((document) => document.path).filter((path) => path.toLowerCase().endsWith(".md") && existsSync(path)),
    ];
    return [...new Map(files.map((file) => [normalized(file), file])).values()];
}

/** Whether a path is one of the project's documents, whatever its slashes and case. */
export function isDoc(config, path)
{
    const wanted = normalized(path);
    return docFiles(config).some((file) => normalized(file) === wanted);
}

/** A document's kind, for its frontmatter: the plan, the backlog, its archive, the decisions, the specifications, the index, a task's
 * note, a release's notes, or any other doc. */
function docType(config, path)
{
    const file = normalized(path);
    const kinds = { plan: config.files.plan, backlog: config.files.tasks, archive: config.files.archive, decisions: config.files.decisions, specs: config.files.specs, index: config.files.index };
    const kind = Object.entries(kinds).find(([, own]) => normalized(own) === file)?.[0];
    return kind ?? (normalized(dirname(path)) === normalized(config.files.notes) ? "note" : normalized(dirname(path)) === normalized(config.files.releases) ? "release" : "doc");
}

/** A document's text with its frontmatter whole and true: the title, description and kind it has or else found, the day it was created
 * (kept; for a file without one, its first day in git), the day it last changed (today when its body changed, or when touched is true,
 * as after a hand edit; else the one it has, or its last day in git). A project's own keys stay. */
export function stampDoc(config, path, text, touched = false)
{
    const say = sayer(config.language);
    const previous = existsSync(path) ? read(path) : null;
    const old = splitFrontmatter(previous ?? "");
    const { data: given, body } = splitFrontmatter(text);
    const isChanged = touched || previous === null || old.body.replace(/\r\n/g, "\n").trim() !== body.replace(/\r\n/g, "\n").trim();
    const type = given.type ?? old.data.type ?? docType(config, path);
    const name = path.split("/").at(-1);
    const kept = { ...old.data, ...given };
    const core = ["plan", "backlog", "archive", "decisions", "specs", "index"];
    const description = kept.description
        || (core.includes(type) ? say(`docDescription_${type}`)
        : type === "note" ? say("docDescription_note", { id: name.replace(/\.md$/i, "") })
        : type === "release" ? firstParagraph(body.replace(/^#.*$/m, "")) || say("docDescription_release", { version: name.replace(/\.md$/i, "") })
        : firstParagraph(body) || titleOf(body, name));
    const data = {
        ...kept,
        // A core file without a heading of its own takes its kind's name in the project's language.
        title: kept.title || (/^# /m.test(body) || !core.includes(type) ? titleOf(body, name) : say(`docTitle_${type}`)),
        description,
        type,
        created: kept.created || (previous === null ? today() : gitDay(path, "first") ?? today()),
        updated: isChanged ? today() : kept.updated || gitDay(path, "last") || today(),
    };
    return joinFrontmatter(data, body);
}

/** A document written with its frontmatter stamped; any other file as it is. */
export function writeDoc(config, path, text)
{
    write(path, isDoc(config, path) || docType(config, path) !== "doc" ? stampDoc(config, path, text) : text);
}

/** The first or the last day git has a file, YYYY-MM-DD, the last today while it has changes not committed; null outside git or for a
 * file it does not track. */
function gitDay(path, which)
{
    if (which === "last" && git(dirname(path), ["status", "--porcelain", "--", path.split("/").at(-1)]).trim() !== "") {
        return today();
    }

    const days = git(dirname(path), ["log", "--follow", "--format=%as", "--", path.split("/").at(-1)]).trim().split("\n").filter(Boolean);
    return (which === "first" ? days.at(-1) : days[0]) ?? null;
}

/** The core files still written in the format's old words of the language (`## In corso`, `· fatto`, `## Traguardi`, `## Da decidere`):
 * read as they are, rewritten in English by `init.mjs rename`. Their paths. */
export function legacyFormat(config)
{
    const old = config.words.legacy;

    if (!old) {
        return [];
    }

    const uses = {
        [config.files.tasks]: Object.values(old.states).map((state) => `## ${state}`).concat(` · ${old.doneMarker} `, ` · ${old.startedMarker} `),
        [config.files.archive]: [` · ${old.doneMarker} `, ` · ${old.archivedMarker} `],
        [config.files.plan]: [`## ${old.goals}`, `(${old.phase} `, `${old.updated} `],
        [config.files.decisions]: [`## ${old.open}`, `| ${old.decision} |`, `${old.superseded} `],
    };
    return Object.entries(uses).filter(([file, marks]) => existsSync(file) && marks.some((mark) => read(file).includes(mark))).map(([file]) => file);
}
