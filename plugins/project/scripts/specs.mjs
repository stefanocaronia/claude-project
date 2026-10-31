// The project's specifications, in <docs>/SPECS.md, only where the project keeps them: one a line with its number, `- S-12 · the text`.
//   node specs.mjs next
//   node specs.mjs add "text" [--section "<a section's heading>"]   (makes the file when there is none)
//   node specs.mjs show S-12 S-13
//   node specs.mjs list [--json]   (each with how far it is covered: by a task done, by code or a test; by an open task; by nothing)
//   node specs.mjs find <words>…
//   node specs.mjs cites S-12
//   node specs.mjs adopt <file> [--write]   (a specifications' document the project already has becomes SPECS.md: moved with git, each
//                                            list line given its number, its text as it was, the docs' links and the configuration following)
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { joinFrontmatter, splitFrontmatter } from "../lib/frontmatter.mjs";
import { coverage, nextSpec, numberSpecs } from "../lib/specs.mjs";
import { escapeRegex, plain } from "../lib/text.mjs";
import { configFile } from "../lib/config.mjs";
import { docFiles, git, isMain, loadProject, ProjectError, projectName, read, readBacklog, readDecisions, readSpecs, runCli, shown, specCitations, write, writeDoc } from "./project.mjs";

if (isMain(import.meta.url)) {
    runCli(() => run(process.argv.slice(2)));
}

/** Every spec with how far it is covered, its tasks, its decisions and the code that names it. */
export function specsState(config)
{
    const { specs } = readSpecs(config);
    return coverage(specs, { tasks: readBacklog(config).tasks, decisions: readDecisions(config).decided, files: specCitations(config), prefixes: config.prefixes });
}

function run(args)
{
    const [command, ...rest] = args;
    const { config, say } = loadProject();
    const { options, words } = optionsOf(rest);
    const prefix = config.prefixes.spec;
    const id = (number) => `${prefix}-${number}`;
    const numberOf = (word) => Number(String(word).replace(new RegExp(`^${escapeRegex(prefix)}-`, "i"), ""));
    const { specs } = readSpecs(config);
    const fail = (message) => {
        throw new ProjectError(message);
    };

    if (command === "adopt") {
        adopt(config, say, words[0], options.write === true);
        return;
    }

    if (command === "add") {
        const text = words.join(" ").replace(/\s+/g, " ").trim();

        if (!text || / · /.test(text)) {
            fail(say("specText"));
        }

        const number = nextSpec(specs, specCitations(config).map((cited) => cited.number));
        addSpec(config, say, `- ${id(number)} · ${text}`, typeof options.section === "string" ? options.section.trim() : "");
        console.log(say("specAdded", { id: id(number), file: shown(config, config.files.specs) }));
        return;
    }

    if (!existsSync(config.files.specs)) {
        fail(say("specsNone", { file: shown(config, config.files.specs) }));
    }

    if (command === "next") {
        console.log(id(nextSpec(specs, specCitations(config).map((cited) => cited.number))));
        return;
    }

    const state = specsState(config);

    if (command === "list") {
        if (options.json) {
            console.log(JSON.stringify(state, null, 2));
            return;
        }

        for (const spec of state) {
            console.log(`${spec.id} · ${say(`specState_${spec.state}`)} · ${spec.text}`);
        }

        const counted = (kind) => state.filter((spec) => spec.state === kind).length;
        console.log(say("specsCount", { count: state.filter((spec) => spec.state !== "dropped").length, done: counted("done"), doing: counted("doing"), open: counted("open") }));
        return;
    }

    if (command === "show" && words.length > 0) {
        for (const number of words.map(numberOf)) {
            const spec = state.find((one) => one.number === number);

            if (!spec) {
                console.log(say("specNotFound", { id: id(number) }));
                process.exitCode = 1;
                continue;
            }

            console.log(`${spec.id} (${say("line")} ${spec.line}${spec.section ? `, ${spec.section}` : ""}) · ${say(`specState_${spec.state}`)}\n${spec.text}`);
            spec.tasks.forEach((task) => console.log(`  ${task.id} · ${config.labels.states[task.state] ?? task.state} · ${task.text}`));
            spec.decisions.length > 0 && console.log(`  ${spec.decisions.join(", ")}`);
            spec.files.forEach((file) => console.log(`  ${file.file}:${file.line}`));
            console.log("");
        }

        return;
    }

    if (command === "find" && words.length > 0) {
        const wanted = words.map(plain);
        const found = state.filter((spec) => wanted.every((word) => plain(`${spec.text} ${spec.section}`).includes(word)));
        found.forEach((spec) => console.log(`${spec.id} · ${spec.text}`));

        if (found.length === 0) {
            console.log(say("noneFound", { words: words.join(" ") }));
            process.exitCode = 1;
        }

        return;
    }

    if (command === "cites" && words.length === 1) {
        const number = numberOf(words[0]);
        const found = specCitations(config).filter((cited) => cited.number === number);
        found.forEach((cited) => console.log(`${cited.file}:${cited.line}`));
        console.log(say("citesCount", { count: found.length, id: id(number) }));
        return;
    }

    fail(say("specsUsage"));
}

/** A spec added under its section's heading, after the section's last spec and the lines under it; a section that is not there is made
 * at the end; the file, when the project keeps none yet, with its heading. */
function addSpec(config, say, line, section)
{
    const file = config.files.specs;
    const fresh = `# ${projectName(config)} — ${say("docTitle_specs")}\n\n> ${say("docDescription_specs")}\n`;
    const { data, body } = splitFrontmatter(existsSync(file) ? read(file) : fresh);
    const lines = body.replace(/\s+$/, "").split("\n");
    const heading = section ? lines.findIndex((one) => one.trim() === `## ${section}`) : -1;

    if (section && heading < 0) {
        lines.push("", `## ${section}`, "", line);
    } else {
        // Where the section ends: the next heading of its level, or the end.
        const start = heading < 0 ? 0 : heading + 1;
        const after = lines.findIndex((one, index) => index >= start && /^## /.test(one));
        const end = section && after >= 0 ? after : lines.length;
        let at = -1;

        for (let index = start; index < end; index++) {
            if (new RegExp(`^- ${escapeRegex(config.prefixes.spec)}-\\d+ · `).test(lines[index])) {
                at = index;

                while (at + 1 < end && /^\s+\S/.test(lines[at + 1])) {
                    at++;
                }
            }
        }

        if (at >= 0) {
            lines.splice(at + 1, 0, line);
        } else {
            lines.splice(end, 0, ...(lines[end - 1]?.trim() ? ["", line] : [line]));
        }
    }

    mkdirSync(dirname(file), { recursive: true });
    writeDoc(config, file, Object.keys(data).length > 0 ? joinFrontmatter(data, `${lines.join("\n")}\n`) : `${lines.join("\n")}\n`);
}

/** A specifications' document the project already has, made its SPECS.md: what would change, or, with write, changed. */
function adopt(config, say, given, isWritten)
{
    const target = config.files.specs;

    if (!given) {
        throw new ProjectError(say("specsUsage"));
    }

    const source = [given, `${config.root}/${given}`, `${config.docs}/${given}`].map((path) => resolve(path).replaceAll("\\", "/")).find((path) => existsSync(path));

    if (!source) {
        throw new ProjectError(say("specsAdoptMissing", { file: given }));
    }

    // A SPECS.md written by hand, without numbers yet, is numbered where it is; one that keeps specs already takes them one by one.
    if (existsSync(target) && (source.toLowerCase() !== target.toLowerCase() || readSpecs(config).specs.length > 0)) {
        throw new ProjectError(say("specsAdoptExists", { file: shown(config, target) }));
    }

    const { data, body } = splitFrontmatter(read(source));
    const { text, numbered } = numberSpecs(body, config.prefixes.spec, 1);
    const sections = [...new Set(text.split("\n").filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim()))];
    const before = specCitations(config).filter((cited) => cited.file !== shown(config, source));
    const name = basename(source);
    const others = git(config.root, ["grep", "-l", "-I", "-F", "-e", name, "--", "."]).split("\n").filter(Boolean)
        .filter((file) => !docFiles(config).some((doc) => doc.toLowerCase().endsWith(`/${file.toLowerCase()}`)) && !file.endsWith(configFile));

    console.log(say("specsAdoptPlan", { from: shown(config, source), to: shown(config, target), count: numbered.length, sections: sections.length }));
    numbered.slice(0, 3).forEach((spec) => console.log(`  ${config.prefixes.spec}-${spec.number} · ${spec.text.slice(0, 120)}`));

    if (before.length > 0) {
        console.log(say("specsAdoptCited", { list: [...new Set(before.map((cited) => `${cited.file}:${cited.line}`))].slice(0, 10).join(", ") }));
    }

    if (!isWritten) {
        console.log(say("specsAdoptDry"));
        return;
    }

    // Moved with git where it tracks the file, so that its history follows; then numbered, the docs' links and the configuration after it.
    if (source.toLowerCase() !== target.toLowerCase()) {
        const folder = dirname(source);
        const tracked = git(folder, ["ls-files", "--error-unmatch", "--", basename(source)]) !== "";
        mkdirSync(dirname(target), { recursive: true });

        if (!tracked || git(folder, ["mv", "--", basename(source), relative(folder, target).replaceAll("\\", "/")]) === "" && existsSync(source)) {
            renameSync(source, target);
        }
    }

    writeDoc(config, target, joinFrontmatter({ ...data, type: "specs" }, text));
    const changed = [shown(config, target)];
    const targetName = basename(target);

    for (const file of docFiles(config).filter((doc) => doc.toLowerCase() !== target.toLowerCase())) {
        const old = read(file);
        const next = old.replaceAll(`](${name}`, `](${targetName}`);

        if (next !== old) {
            writeDoc(config, file, next);
            changed.push(shown(config, file));
        }
    }

    const yaml = `${config.root}/${configFile}`;
    const settings = read(yaml);
    const moved = settings.replaceAll(shown(config, source), shown(config, target));

    if (moved !== settings) {
        write(yaml, moved);
        changed.push(configFile);
    }

    console.log(say("specsAdoptDone", { count: numbered.length, file: shown(config, target), files: changed.join(", ") }));

    if (others.length > 0) {
        console.log(say("specsAdoptOthers", { name, list: others.join(", ") }));
    }
}

function optionsOf(args)
{
    const options = {};
    const words = [];

    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--json" || args[index] === "--write") {
            options[args[index].slice(2)] = true;
        } else if (args[index].startsWith("--") && args[index + 1] !== undefined) {
            options[args[index].slice(2)] = args[index + 1];
            index++;
        } else {
            words.push(args[index]);
        }
    }

    return { options, words };
}
