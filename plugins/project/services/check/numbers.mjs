// What the check finds in the numbers: a decision given twice, skipped, cited and missing or revised whole; a spec's; a contract's.
import { existsSync } from "node:fs";
import { citedDecisions, numbering } from "../../lib/decisions.mjs";
import { escapeRegex } from "../../lib/text.mjs";
import { readable } from "../../lib/words.mjs";
import { citingFiles } from "../docs.mjs";
import { read } from "../files.mjs";
import { readContracts } from "../releases.mjs";
import { readSpecs, specCitations } from "../specs.mjs";

/** The decisions' numbers: one given twice, one skipped. */
export function checkNumbering(config, say, decisions, add)
{
    const prefix = config.prefixes.decision;
    const seen = new Map();

    for (const row of decisions) {
        if (seen.has(row.number)) {
            add("error", "numbering", config.files.decisions, row.line, say("dupDecision", { id: `${prefix}-${row.number}`, other: seen.get(row.number) }));
        } else {
            seen.set(row.number, row.line);
        }
    }

    for (const number of numbering(decisions).missing) {
        add("note", "numbering", config.files.decisions, null, say("skipped", { id: `${prefix}-${number}` }));
    }
}

/** A decision cited anywhere that the table does not have. */
export function checkReferences(config, say, decisions, add)
{
    const prefix = config.prefixes.decision;
    const numbers = new Set(decisions.map((row) => row.number));
    const name = config.files.decisions.split("/").at(-1);

    for (const path of citingFiles(config)) {
        for (const [index, line] of read(path).split(/\r?\n/).entries()) {
            for (const number of citedDecisions(line, prefix)) {
                if (!numbers.has(number)) {
                    add("error", "references", path, index + 1, say("unknownDecision", { id: `${prefix}-${number}`, file: name }));
                }
            }
        }
    }
}

/** The specifications, where the project keeps them: a number used twice, a line that opens as a spec and does not read, a spec cited
 * anywhere (a task's see, a decision, the code, a doc) that the file does not have. */
export function checkSpecs(config, say, add)
{
    if (!existsSync(config.files.specs)) {
        return;
    }

    const prefix = config.prefixes.spec;
    const { specs, unread } = readSpecs(config);
    const seen = new Map();

    for (const spec of specs) {
        if (seen.has(spec.number)) {
            add("error", "numbering", config.files.specs, spec.line, say("dupSpec", { id: `${prefix}-${spec.number}`, other: seen.get(spec.number) }));
        } else {
            seen.set(spec.number, spec.line);
        }
    }

    for (const line of unread) {
        add("error", "specs", config.files.specs, line.line, say("unreadSpec", { prefix }));
    }

    const name = config.files.specs.split("/").at(-1);

    for (const cited of specCitations(config).filter((one) => !seen.has(one.number))) {
        add("error", "references", `${config.root}/${cited.file}`, cited.line, say("unknownSpec", { id: `${prefix}-${cited.number}`, file: name }));
    }
}

/** The contracts: one whose file does not hold its number, or whose number went down since the last release. */
export function checkContracts(config, say, add)
{
    for (const contract of readContracts(config)) {
        if (contract.state === "unread") {
            add("error", "contracts", `${config.root}/${contract.file}`, null, say("contractUnread", { name: contract.name, file: contract.file }));
        } else if (contract.state === "lowered") {
            add("error", "contracts", `${config.root}/${contract.file}`, null, say("contractLowered", { name: contract.name, before: contract.before, current: contract.current }));
        }
    }
}

/** Decisions that a later one revises whole: the candidates to mark as superseded. A number is read whole (D-34 is not D-344), and a
 * revision that goes on past the number, «rivede D-34 (1)», «rivede D-34 per le estensioni», is in part; whole is a number that ends
 * the clause, or one said whole, «rivede D-34 per intero». */
export function checkRevisions(config, say, decisions, add)
{
    const { words } = config;
    const prefix = config.prefixes.decision;
    const superseded = new Set(decisions.filter((row) => readable(words, "superseded").some((word) => row.text.startsWith(`${word} ${prefix}-`))).map((row) => row.number));
    const whole = words.wholly.map(escapeRegex).join("|");
    const verbs = new RegExp(`\\b(${words.revises.join("|")})\\s+(?:\\w{1,3}\\s+)?${escapeRegex(prefix)}-(\\d+)(?!\\d)(?=\\s*(?:[.;|]|$|(?:${whole})\\b))`, "gi");

    for (const row of decisions) {
        for (const match of row.text.matchAll(verbs)) {
            const revised = Number(match[2]);
            const around = row.text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12);

            if (!superseded.has(revised) && !around.includes(words.partly)) {
                add("note", "superseded", config.files.decisions, row.line, say("maybeSuperseded", { id: `${prefix}-${row.number}`, verb: match[1], other: `${prefix}-${revised}` }));
            }
        }
    }
}
