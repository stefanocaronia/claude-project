// The words the project's files are written in, by language: the headings of the states, the markers of a task line, the plan's and the
// decisions' headings. A project picks a language in .claude/project.yaml and overrides any word under `words:`.

/** The internal keys of a task's states, in the order the backlog lists them; "archived" lives in the archive. */
export const stateKeys = ["doing", "todo", "postponed", "done"];
/** The internal keys of the efforts, as Claude Code's levels; "none" when a task does not say. */
export const effortKeys = ["low", "medium", "high", "xhigh", "max", "none"];
export const priorityKeys = ["P1", "P2", "P3"];

export const presets = {
    en: {
        states: { doing: "In progress", todo: "To do", postponed: "Postponed", done: "Done" },
        archived: "Archived",
        priorities: { P1: "high", P2: "normal", P3: "low" },
        efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max", none: "—" },
        noGoal: "—",
        startedMarker: "started",
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
        files: { plan: "PLAN.md", tasks: "TASKS.md", decisions: "DECISIONS.md", archive: "archive/TASKS-archive.md", index: "README.md", archiveFolder: "archive", notes: "tasks" },
    },
    it: {
        states: { doing: "In corso", todo: "Da fare", postponed: "Rimandati", done: "Fatti" },
        archived: "Archiviati",
        priorities: { P1: "alta", P2: "normale", P3: "bassa" },
        efforts: { low: "basso", medium: "medio", high: "alto", xhigh: "extra", max: "max", none: "—" },
        noGoal: "—",
        startedMarker: "iniziato",
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
        files: { plan: "PLAN.md", tasks: "TASKS.md", decisions: "DECISIONI.md", archive: "archivio/TASKS-archivio.md", index: "README.md", archiveFolder: "archivio", notes: "compiti" },
    },
};

export const languages = Object.keys(presets);

/** The words of a language with a project's overrides on top, one level deep for the grouped ones. */
export function wordsOf(language, overrides = {})
{
    const base = presets[language] ?? presets.en;
    const merged = { ...base };

    for (const [key, value] of Object.entries(overrides ?? {})) {
        merged[key] = isPlainObject(value) && isPlainObject(base[key]) ? { ...base[key], ...value } : value;
    }

    return merged;
}

function isPlainObject(value)
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
