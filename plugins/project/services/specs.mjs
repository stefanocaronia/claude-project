// The specifications: read from SPECS.md, cited by the files, covered by the tasks, the decisions and the code.
import { existsSync } from "node:fs";
import { citedSpecs, coverage, parseSpecs } from "../lib/specs.mjs";
import { readBacklog } from "./backlog/index.mjs";
import { citingFiles, readDecisions } from "./docs.mjs";
import { normalized, read, realPath, shown } from "./files.mjs";

/** The specifications, when the project keeps them: { specs, unread }; none without the file. */
export function readSpecs(config)
{
    return existsSync(config.files.specs) ? parseSpecs(read(config.files.specs), config.words, config.prefixes.spec) : { specs: [], unread: [] };
}

/** Where the files name each spec: { number, file, line, isCode } for every S-n in the files the configuration's cites name, the
 * specifications' own file aside; `isCode` for the code and the tests, outside the docs and the colleagues' memory, which cover it. */
export function specCitations(config)
{
    const own = normalized(config.files.specs);
    const inside = (file, folder) => normalized(file).startsWith(`${normalized(folder)}/`);
    return citingFiles(config).filter((file) => normalized(file) !== own).flatMap((file) => {
        const isCode = !inside(file, config.docs) && !inside(file, config.memory) && !inside(realPath(file), realPath(config.docs));
        return read(file).split(/\r?\n/).flatMap((line, index) => citedSpecs(line, config.prefixes.spec).map((number) => ({ number, file: shown(config, file), line: index + 1, isCode })));
    });
}

/** Every spec with how far it is covered, its tasks, its decisions and the code that names it. */
export function specsState(config)
{
    const { specs } = readSpecs(config);
    return coverage(specs, { tasks: readBacklog(config).tasks, decisions: readDecisions(config).decided, files: specCitations(config), prefixes: config.prefixes });
}
