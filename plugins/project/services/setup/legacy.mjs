// A project made before the core went English: its plan and decisions written again in the format's English words, its own text as it is.
import { existsSync } from "node:fs";
import { readBacklog, writeBacklog } from "../backlog/index.mjs";
import { writeDoc } from "../docs.mjs";
import { read } from "../files.mjs";

/** The plan and the decisions written again in the format's English words, the project's own text left as it is; the backlog is written
 * again by writeBacklog, which reads both. */
export function englishFormat(config)
{
    const old = config.words.legacy;
    const words = config.words;
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plan = read(config.files.plan)
        .replace(new RegExp(`^## ${escape(old.goals)}[ \t]*$`, "m"), `## ${words.goals}`)
        .replace(/^### .+$/gm, (heading) => heading
            .replace(new RegExp(`\\(${escape(old.phase)} (\\d+)\\)`, "i"), `(${words.phase} $1)`)
            .replace(new RegExp(` · ${escape(old.doneMarker)} (\\d{4}-\\d{2}-\\d{2})\\s*$`), ` · ${words.doneMarker} $1`))
        .replace(new RegExp(`${escape(old.updated)} (\\d{4}-\\d{2}-\\d{2})`), `${words.updated} $1`);
    const decisions = read(config.files.decisions)
        .replace(new RegExp(`^## ${escape(old.open)}[ \t]*$`, "m"), `## ${words.open}`)
        .replace(new RegExp(`^\\| # \\| ${escape(old.decision)} \\| ${escape(old.why)} \\|`, "m"), `| # | ${words.decision} | ${words.why} |`)
        .replace(new RegExp(`^(\\| *\\d+ *\\| *)${escape(old.superseded)} `, "gm"), `$1${words.superseded} `);
    const changed = [];

    for (const [file, text] of [[config.files.plan, plan], [config.files.decisions, decisions]]) {
        if (existsSync(file) && text !== read(file)) {
            writeDoc(config, file, text);
            changed.push(file);
        }
    }

    writeBacklog(config, readBacklog(config).tasks);
    return changed;
}
