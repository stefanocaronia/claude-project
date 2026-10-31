// The specifications: what the project must do, one a line with its number, `- S-12 · the text`, under the headings of their sections;
// the file's other lines (a summary, a paragraph, a label in bold, a line under a spec) are the user's and stay as they are. Tasks cite
// a spec with `(see: S-12)`, a decision that changes one names it, code and tests name it; a spec dropped keeps its number, its text
// opening with the superseded marker. Pure.
import { escapeRegex } from "./text.mjs";
import { readable } from "./words.mjs";

/** The specs of the text, each with its number, its text, its section (the last `## ` heading above it), its group (the last label in
 * bold or `### ` heading within the section), its line and whether a decision superseded it; and the lines that open as a spec and do
 * not read as one. */
export function parseSpecs(text, words, prefix = "S")
{
    const specs = [];
    const unread = [];
    let section = "";
    let group = "";
    const superseded = readable(words, "superseded").map((word) => word.toLowerCase());

    (text ?? "").split(/\r?\n/).forEach((line, index) => {
        if (/^## /.test(line)) {
            section = line.slice(3).trim();
            group = "";
            return;
        }

        const label = /^(?:### +(.+?)|\*\*([^*]+)\*\*:?)\s*$/.exec(line);

        if (label) {
            group = (label[1] ?? label[2]).trim();
            return;
        }

        const spec = new RegExp(`^- ${escapeRegex(prefix)}-(\\d+) · (.+)$`).exec(line);

        if (spec) {
            const body = spec[2].trim();
            specs.push({ number: Number(spec[1]), text: body, section, group, line: index + 1, superseded: superseded.some((word) => body.toLowerCase().startsWith(word)) });
        } else if (new RegExp(`^- ${escapeRegex(prefix)}-\\d+`).test(line)) {
            unread.push({ line: index + 1, text: line });
        }
    });

    return { specs, unread };
}

/** The numbers of the specs a text cites, `S-12`, every time they appear; `SYS-3` or `CS-4` are no spec. */
export function citedSpecs(text, prefix = "S")
{
    return [...String(text).matchAll(new RegExp(`(?<![\\w-])${escapeRegex(prefix)}-(\\d+)\\b`, "g"))].map((match) => Number(match[1]));
}

/** The next free number: past every spec and every number cited anywhere, so that two sessions never take the same. */
export function nextSpec(specs, cited = [])
{
    return Math.max(0, ...specs.map((spec) => spec.number), ...cited) + 1;
}

/** A specifications' document numbered: each list line at the start of a line that is not one yet, `- text`, made `- S-n · text`, from
 * `first` on, the text as it was; the lines under it, the rest of the file and the specs already numbered as they are; the code blocks
 * left alone. { text, numbered: the specs given a number, as { number, text, line } }. */
export function numberSpecs(text, prefix = "S", first = 1)
{
    let next = first;
    let isCode = false;
    const numbered = [];
    const lines = (text ?? "").split("\n").map((line, index) => {
        if (/^(```|~~~)/.test(line)) {
            isCode = !isCode;
            return line;
        }

        const item = /^[-*+] (.*)$/.exec(line);

        if (isCode || !item || new RegExp(`^${escapeRegex(prefix)}-\\d+ · `).test(item[1]) || item[1].trim() === "") {
            return line;
        }

        numbered.push({ number: next, text: item[1].replace(/\r$/, ""), line: index + 1 });
        return `- ${prefix}-${next++} · ${item[1]}`;
    });

    return { text: lines.join("\n"), numbered };
}

/** How far each spec is covered, by what cites it: `done` when a task done or archived cites it, or code or a test names it; `doing`
 * when only open tasks do; `open` when nothing does; `dropped` for a spec superseded. Each with its tasks, its decisions and its files.
 * Tasks by `see`, decisions by their text or why, files as { number, file, line, isCode }, already found by the caller: only code and
 * tests cover a spec, a doc that names one does not. */
export function coverage(specs, { tasks = [], decisions = [], files = [], prefixes = { task: "T", decision: "D", spec: "S" } } = {})
{
    const id = (number) => `${prefixes.spec}-${number}`;
    const closed = (task) => task.state === "done" || task.state === "archived";

    return specs.map((spec) => {
        const own = id(spec.number);
        const citing = tasks.filter((task) => (task.see ?? []).includes(own));
        const deciding = decisions.filter((row) => citedSpecs(`${row.text} ${row.why ?? ""}`, prefixes.spec).includes(spec.number));
        const naming = files.filter((file) => file.number === spec.number && file.isCode !== false);
        const state = spec.superseded ? "dropped" : citing.some(closed) || naming.length > 0 ? "done" : citing.length > 0 ? "doing" : "open";
        return {
            ...spec,
            id: own,
            state,
            tasks: citing.map((task) => ({ id: `${prefixes.task}-${task.id}`, state: task.state, text: task.text })),
            decisions: deciding.map((row) => `${prefixes.decision}-${row.number}`),
            files: naming.map(({ file, line }) => ({ file, line })),
        };
    });
}
