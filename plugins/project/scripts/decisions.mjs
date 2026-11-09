// The project's decisions, read deterministically: the next free number, a decision by its number, decisions by words, where one is cited.
//   node decisions.mjs next
//   node decisions.mjs show 287 540
//   node decisions.mjs find <words>… [--full]
//   node decisions.mjs cites 287
import { nextDecision, numbering, citedDecisions } from "../lib/decisions.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";
import { citingFiles, readDecisions } from "../services/docs.mjs";
import { read, shown } from "../services/files.mjs";
import { pullDocs } from "../services/sync.mjs";

// How much of a decision find shows, without --full.
const shownLength = 220;

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

function run(args)
{
    const [command, ...rest] = args;
    const full = rest.includes("--full");
    const words = rest.filter((arg) => arg !== "--full");
    const { config, say } = loadProject();

    // A new number, where the docs are in sync among the project's people, comes after the others' latest decisions (D-18).
    if (command === "next") {
        pullDocs(config, say).forEach((line) => console.error(line));
    }

    const { decided, open } = readDecisions(config);
    const prefix = config.prefixes.decision;
    const id = (number) => `${prefix}-${number}`;
    const numberOf = (word) => Number(word.replace(new RegExp(`^${escapeRegex(prefix)}-`, "i"), ""));

    if (command === "next") {
        // Every number cited in the configured places, each time it appears.
        const cited = citingFiles(config).flatMap((file) => citedDecisions(read(file), prefix));
        const { twice } = numbering(decided);
        console.log(id(nextDecision(decided, cited)));

        if (twice.length > 0) {
            console.log(say("twice", { list: twice.map(id).join(", ") }));
        }

        const highest = Math.max(0, ...decided.map((decision) => decision.number));
        const ahead = [...new Set(cited.filter((number) => number > highest))].sort((one, other) => one - other);

        if (ahead.length > 0) {
            console.log(say("citedAhead", { list: ahead.map(id).join(", ") }));
        }
    } else if (command === "show" && words.length > 0) {
        for (const number of words.map(numberOf)) {
            const found = decided.filter((decision) => decision.number === number);

            if (found.length === 0) {
                console.log(say("notInTable", { id: id(number) }));
                process.exitCode = 1;
            }

            for (const decision of found) {
                console.log(`${id(decision.number)} (${say("line")} ${decision.line})\n${decision.text}${decision.why === "" ? "" : `\n${config.labels.why}: ${decision.why}`}\n`);
            }
        }
    } else if (command === "find" && words.length > 0) {
        const wanted = words.map(plain);
        const holds = (text) => wanted.every((word) => plain(text).includes(word));
        const cut = (text) => (full || text.length <= shownLength ? text : `${text.slice(0, shownLength)}…`);
        const found = decided.filter((decision) => holds(`${decision.text} ${decision.why}`));
        const pending = open.filter((point) => holds(point.text));
        found.forEach((decision) => console.log(`${id(decision.number)}: ${cut(decision.text)}`));
        pending.forEach((point) => console.log(say("openPoint", { line: point.line, text: cut(point.text) })));

        if (found.length + pending.length === 0) {
            console.log(say("noneFound", { words: words.join(" ") }));
            process.exitCode = 1;
        }
    } else if (command === "cites" && words.length === 1) {
        const number = numberOf(words[0]);
        const pattern = new RegExp(`\\b${escapeRegex(prefix)}-${number}\\b`);
        let count = 0;

        for (const file of citingFiles(config)) {
            read(file).split("\n").forEach((line, index) => {
                if (pattern.test(line)) {
                    count++;
                    const at = line.search(pattern);
                    console.log(`${shown(config, file)}:${index + 1}: ${line.slice(Math.max(0, at - 80), at + 100).trim()}`);
                }
            });
        }

        console.log(say("citesCount", { count, id: id(number) }));
    } else {
        console.log(say("decisionsUsage"));
        process.exitCode = 1;
    }
}
