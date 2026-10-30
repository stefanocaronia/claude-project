// The project's configuration, .claude/project.yaml, read into one object with every default filled in. Pure: the scripts and the panel
// hand it the file's text and the project's root.
import { parse } from "./vendor/yaml/index.js";
import { wordsOf } from "./words.mjs";

/** Where the configuration lives, relative to the project's root. */
export const configFile = ".claude/project.yaml";

export const defaults = {
    language: "en",
    docs: "project",
    people: ["Claude"],
    agents: ".claude/agents",
    memory: ".claude/agent-memory",
    prefixes: { task: "T", decision: "D" },
    cites: [],
    skip: ["node_modules", ".git", "dist", "tmp", "sandbox", ".codegraph", "worktrees"],
    limits: { tokens: 25000, proposalDays: 14, planDays: 3, todoOpen: 15, closedStep: 400 },
    page: {},
    extensions: [],
};

/** The configuration from the file's text (empty when there is none), with the paths resolved against the root, "/" between parts. */
export function readConfig(text, root)
{
    const given = (text ? parse(text) : null) ?? {};

    if (typeof given !== "object" || Array.isArray(given)) {
        throw new Error(`${configFile} must be a map of settings (language: it, docs: project, ...), not ${Array.isArray(given) ? "a list" : typeof given}.`);
    }

    const language = given.language ?? defaults.language;
    const words = wordsOf(language, given.words);
    const files = { ...words.files, ...(given.files ?? {}) };
    const docs = resolve(root, given.docs ?? defaults.docs);
    const config = {
        root: clean(root),
        rootSetting: given.root === undefined ? undefined : resolve(root, given.root),
        name: given.name === undefined ? undefined : String(given.name),
        language,
        words,
        docs,
        files: {
            plan: resolve(docs, files.plan),
            tasks: resolve(docs, files.tasks),
            decisions: resolve(docs, files.decisions),
            archive: resolve(docs, files.archive),
            index: resolve(docs, files.index),
            inbox: files.inbox ? resolve(docs, files.inbox) : undefined,
            // The folder of the tasks' notes, one a task: T-12.md.
            notes: resolve(docs, files.notes),
        },
        repos: given.repos === undefined ? undefined : (Array.isArray(given.repos) ? given.repos : []).map((repo) => ({ name: String(repo.name), path: resolve(root, repo.path ?? ".") })),
        archiveFolder: files.archiveFolder,
        people: list(given.people, defaults.people),
        agents: resolve(root, given.agents ?? defaults.agents),
        memory: resolve(root, given.memory ?? defaults.memory),
        prefixes: { ...defaults.prefixes, ...(given.prefixes ?? {}) },
        cites: list(given.cites, [given.docs ?? defaults.docs, given.memory ?? defaults.memory]).map((path) => resolve(root, path)),
        markdown: given.markdown === undefined ? undefined : list(given.markdown, []).map((path) => resolve(root, path)),
        skip: [...new Set([...list(given.skip, defaults.skip), files.archiveFolder])],
        limits: { ...defaults.limits, ...(given.limits ?? {}) },
        page: { port: defaultPort(root), ...defaults.page, ...(given.page ?? {}) },
        extensions: list(given.extensions, defaults.extensions).map((path) => resolve(root, path)),
        // The project's key documents (a game's GDD, a business plan, a specification), the first to read: { name, path }.
        documents: (Array.isArray(given.documents) ? given.documents : []).map((document) => ({ name: String(document.name ?? document.path), path: resolve(root, String(document.path)) })),
    };

    return config;
}

/** The page's port when the configuration names none: one of 5800–5999, the same for a folder every time, so that two projects open
 * at once seldom meet on one port; page: { port } in the configuration picks another. */
export function defaultPort(root)
{
    let hash = 2166136261;

    for (const char of clean(root).toLowerCase()) {
        hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
    }

    return 5800 + (hash % 200);
}

/** A path against a folder, unless it is absolute; ".." and "." folded away. */
export function resolve(folder, path)
{
    const given = String(path).replaceAll("\\", "/");

    if (/^([a-zA-Z]:)?\//.test(given)) {
        return clean(given);
    }

    return clean(`${folder}/${given}`);
}

/** A path relative to a folder, for messages; the path itself when it is not under it. */
export function relativeTo(folder, path)
{
    const base = `${clean(folder)}/`;
    const full = clean(path);
    return full.toLowerCase().startsWith(base.toLowerCase()) ? full.slice(base.length) : full;
}

function clean(path)
{
    const parts = [];
    const given = String(path).replaceAll("\\", "/");
    const head = /^([a-zA-Z]:)?\//.exec(given)?.[0] ?? "";

    for (const part of given.slice(head.length).split("/")) {
        if (part === "" || part === ".") {
            continue;
        }

        if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") {
            parts.pop();
        } else {
            parts.push(part);
        }
    }

    return head + parts.join("/");
}

function list(value, fallback)
{
    if (value === undefined || value === null) {
        return fallback;
    }

    return Array.isArray(value) ? value.map(String) : [String(value)];
}
