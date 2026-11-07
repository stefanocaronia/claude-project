// The words the project's files are written in, by language: the headings of the states, the markers of a task line, the plan's and the
// decisions' headings. A project picks a language in .claude/project.yaml and overrides any word under `words:`.
import { escapeRegex, isMap } from "./text.mjs";

/** The internal keys of a task's states, in the order the backlog lists them; "archived" lives in the archive. */
export const stateKeys = ["doing", "todo", "postponed", "done"];
/** The priorities a task line may have, the most urgent first. */
export const priorityKeys = ["P1", "P2", "P3"];

/** The project's core files and folders, named in English whatever the project's language: the words inside them follow the language.
 * A project's own files and its extensions are named as the user likes. The specifications' file is there only in the projects that
 * keep one. */
export const coreFiles = { plan: "PLAN.md", tasks: "TASKS.md", decisions: "DECISIONS.md", specs: "SPECS.md", archive: "archive/TASKS-archive.md", index: "README.md", archiveFolder: "archive", notes: "tasks", releases: "releases" };

/** The names the Italian preset gave before the core went English, still read where a project has them and not the new ones, until
 * `init.mjs rename` renames them. */
export const legacyFiles = { decisions: "DECISIONI.md", archive: "archivio/TASKS-archivio.md", archiveFolder: "archivio", notes: "compiti" };

/** The words of each language the plugin speaks, by language: its states, priorities, efforts, types and markers, the plan's and the
 * decisions' headings, the verbs a decision that revises another uses, the months, and the core files' names. */
export const presets = {
    en: {
        states: { doing: "In progress", todo: "To do", postponed: "Postponed", done: "Done" },
        archived: "Archived",
        priorities: { P1: "high", P2: "normal", P3: "low" },
        efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max", none: "—" },
        noGoal: "—",
        startedMarker: "started",
        startedByMarker: "by",
        types: { bug: "bug", feature: "feature", chore: "chore", research: "research", test: "test" },
        doneMarker: "done",
        archivedMarker: "archived",
        goals: "Goals",
        phase: "phase",
        updated: "Updated on",
        open: "To decide",
        why: "Why",
        decision: "Decision",
        superseded: "Superseded by",
        revises: ["revises", "replaces", "supersedes", "corrects"],
        partly: "in part",
        wholly: ["whole", "wholly", "entirely", "in full"],
        months: ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
        repoProject: "project",
        repoDocs: "docs",
        files: coreFiles,
    },
    it: {
        states: { doing: "In corso", todo: "Da fare", postponed: "Rimandati", done: "Fatti" },
        archived: "Archiviati",
        priorities: { P1: "alta", P2: "normale", P3: "bassa" },
        efforts: { low: "basso", medium: "medio", high: "alto", xhigh: "extra", max: "max", none: "—" },
        noGoal: "—",
        startedMarker: "iniziato",
        startedByMarker: "da",
        types: { bug: "bug", feature: "funzione", chore: "manutenzione", research: "ricerca", test: "prova" },
        doneMarker: "fatto",
        archivedMarker: "archiviato",
        goals: "Traguardi",
        phase: "fase",
        updated: "Aggiornato il",
        open: "Da decidere",
        why: "Perché",
        decision: "Decisione",
        superseded: "Superata da",
        revises: ["rivede", "corregge", "sostituisce", "supera"],
        partly: "in parte",
        wholly: ["per intero", "interamente", "del tutto", "in tutto"],
        months: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
        repoProject: "progetto",
        repoDocs: "documenti",
        files: coreFiles,
    },
};

// The words of the core files' format: in English whatever the project's language, as the files' names are; the panel, the page and the
// messages show them in the project's language (its preset's words, the labels).
const formatKeys = ["states", "archived", "efforts", "noGoal", "startedMarker", "startedByMarker", "doneMarker", "archivedMarker", "goals", "phase", "updated", "open", "why", "decision", "superseded"];

/** The words of a project: its language's (types, priorities, the verbs read in its decisions), the format's in English, a project's
 * overrides on top, one level deep for the grouped ones; `legacy`, the format as the language's files wrote it before, still read. */
export function wordsOf(language, overrides = {})
{
    const base = presets[language] ?? presets.en;
    const format = Object.fromEntries(formatKeys.map((key) => [key, presets.en[key]]));
    const merged = { ...base, ...format };

    for (const [key, value] of Object.entries(overrides ?? {})) {
        merged[key] = isMap(value) && isMap(merged[key]) ? { ...merged[key], ...value } : value;
    }

    merged.legacy = base === presets.en ? null : Object.fromEntries(formatKeys.map((key) => [key, base[key]]));
    return merged;
}

/** The labels of a language: its own words for the states, the priorities, the efforts and the marks, for what the panel, the page and
 * the messages show. */
export function labelsOf(language)
{
    return presets[language] ?? presets.en;
}

/** A word of the format and, for a project whose files were written before the format went English, its old word: both read, the first
 * written. */
export function readable(words, key)
{
    const old = words.legacy?.[key];
    return typeof old === "string" && old !== words[key] ? [words[key], old] : [words[key]];
}

/** The same, as a regular expression's alternatives. */
export function readablePattern(words, key)
{
    return readable(words, key).map(escapeRegex).join("|");
}

/** The state a backlog heading names, in the format's words or the old ones; null for none. */
export function stateOfHeading(words, heading)
{
    return stateKeys.find((key) => words.states[key] === heading || words.legacy?.states?.[key] === heading) ?? null;
}

/** An effort as the format writes it: an old word of the language read as the format's. */
export function effortWord(words, value)
{
    const key = Object.entries(words.legacy?.efforts ?? {}).find(([, word]) => word === value)?.[0];
    return key && !Object.values(words.efforts).includes(value) ? words.efforts[key] : value;
}
