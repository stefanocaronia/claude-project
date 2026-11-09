// The people of the project: Crew's colleagues and coordinator from their profiles, who may hold a task, the colleagues' todos; and,
// where several work on it, each with their own Claude (D-18), who works on this machine and the repo's collaborators.
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isShared, localConfigFile } from "../lib/config.mjs";
import { nameKey, profileFrom } from "../lib/crew.mjs";
import { todoLinks } from "../lib/links.mjs";
import { parseTodo } from "../lib/todos.mjs";
import { read } from "./files.mjs";
import { git } from "./git.mjs";
import { personOfUser, readCollaborators, readLogin } from "./github/index.mjs";

/** The colleagues of Crew: each agent of the agents folder, by id and first name, their profile's; the coordinator apart (coordinatorOf). */
export function colleagues(config)
{
    return agentIds(config).filter((id) => !isCoordinator(config, id)).map((id) => ({ id, name: profileOf(config, id).name }));
}

/** The coordinator Crew hired for the project, `coordinator: true` in their profile's frontmatter: Claude in the backlog, drawn with
 * their name, color and portrait, never a colleague a task is handed to (D-18). { id, name, fullName, role, color }; null without one. */
export function coordinatorOf(config)
{
    const id = agentIds(config).find((one) => isCoordinator(config, one));
    return id ? { id, ...profileOf(config, id) } : null;
}

/** A name as the backlog writes it: the coordinator's, by their first or full name or id, is Claude's, the first of the people; one of
 * who may hold a task, whatever its case and accents, as the project writes it (Nicolo is Nicolò). */
export function backlogName(config, name)
{
    const coordinator = coordinatorOf(config);
    const given = nameKey(name);

    if (coordinator && [coordinator.name, coordinator.fullName, coordinator.id].some((one) => nameKey(one) === given)) {
        return config.people[0];
    }

    return assignees(config).find((one) => nameKey(one) === given) ?? name;
}

/** The ids of the agents folder's profiles. */
function agentIds(config)
{
    return existsSync(config.agents) ? readdirSync(config.agents).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3)) : [];
}

/** Whether a profile is the coordinator's: `coordinator: true` in its frontmatter. */
function isCoordinator(config, id)
{
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(`${config.agents}/${id}.md`))?.[1] ?? "";
    return /^coordinator:\s*true\s*$/m.test(frontmatter);
}

/** A colleague's or the coordinator's name, full name, role and color, from their profile as Crew reads it too (lib/crew.mjs). */
export function profileOf(config, id)
{
    return profileFrom(id, read(`${config.agents}/${id}.md`));
}

/** A colleague's portrait, as Crew keeps it: the small picture, else the one Claude drew; { path, type }, null without one. */
export function portraitFile(config, id)
{
    return [["avatar-small.jpg", "image/jpeg"], ["avatar.svg", "image/svg+xml"]].map(([name, type]) => ({ path: `${config.memory}/${id}/${name}`, type })).find((one) => existsSync(one.path)) ?? null;
}

/** Who may hold a task: the people of the configuration and the colleagues, by their first names. */
export function assignees(config)
{
    return [...new Set([...config.people, ...colleagues(config).map((colleague) => colleague.name)])];
}

/** The colleagues' todo files that exist, by the id of their memory folder, each with whose it is: the coordinator's is Claude's, the
 * first of the people (D-18). */
export function todoFiles(config)
{
    const ids = existsSync(config.memory) ? readdirSync(config.memory) : [];
    const coordinator = coordinatorOf(config)?.id;
    return ids.map((id) => ({ id, name: id === coordinator ? config.people[0] : profileOf(config, id).name, file: `${config.memory}/${id}/todo.md` })).filter((one) => existsSync(one.file));
}

/** Every task line of the colleagues' todos with its id and what it waits for: { colleague, file, line, done, text, id, after }. */
export function readTodos(config)
{
    return todoFiles(config).flatMap(({ id: colleague, file }) => read(file).split(/\r?\n/).flatMap((text, index) => {
        const task = parseTodo(text);
        return task ? [{ colleague, file, line: index + 1, done: task.done, text: task.text, ...todoLinks(task.text, config.prefixes.task) }] : [];
    }));
}

/** The ids a colleague's todo ever gave, open, ticked or moved to their done and archived notes, as Crew keeps them. */
export function todoIdsEver(config)
{
    const ids = new Set(readTodos(config).map((todo) => todo.id).filter(Boolean));

    for (const { id } of todoFiles(config)) {
        for (const name of ["todo-done.md", "todo-archive.md"]) {
            for (const match of read(`${config.memory}/${id}/notes/${name}`).matchAll(/ · (#[\w-]+-\d+) · /g)) {
                ids.add(match[1]);
            }
        }
    }

    return ids;
}

/** Who works on this machine, written in their own settings where the project has more than one person and they do not say it yet: the
 * person whose login the configuration gives the user of gh, or named as their login or first name. { me, written }; me null where
 * nobody matches, or without gh. */
export function settleMe(config)
{
    if (!isShared(config) || config.me) {
        return { me: config.me, written: false };
    }

    const me = personOfUser(config);

    if (!me) {
        return { me: null, written: false };
    }

    const file = join(config.root, localConfigFile);
    const text = read(file);
    const line = `me: ${/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(me) ? me : JSON.stringify(me)}`;
    // An empty `me:` already there is filled in, not written twice.
    const written = /^me:.*$/m.test(text) ? text.replace(/^me:.*$/m, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, written);
    return { me, written: true };
}

/** The person's own settings kept out of the code's repo: named in its git folder's info/exclude, a file never committed, where the repo
 * does not ignore them already. Whether it named them now; false outside git, and where they are committed already. */
export function excludeLocal(config)
{
    const file = join(config.root, localConfigFile);

    if (!existsSync(file)) {
        return false;
    }

    const top = git(config.root, ["rev-parse", "--show-toplevel"]).trim();

    if (!top ||git(config.root, ["check-ignore", "--", localConfigFile]).trim() || git(config.root, ["ls-files", "--", localConfigFile]).trim()) {
        return false;
    }

    const folder = git(config.root, ["rev-parse", "--git-common-dir"]).trim();
    const exclude = join(isAbsolute(folder) ? folder : join(config.root, folder), "info", "exclude");
    const text = read(exclude);
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `${text && !text.endsWith("\n") ? "\n" : ""}# project: each person's own settings (D-18)\n/${relative(top, file).replaceAll("\\", "/")}\n`);
    return true;
}

/** The repo's collaborators on GitHub who are none of the project's people, by login: none where the project is not shared (several
 * people, or its docs kept in sync), without gh, or without the right to list them. */
export function missingCollaborators(config)
{
    if (!isShared(config) && config.sync !== "auto") {
        return [];
    }

    const known = new Set([readLogin(config), ...Object.values(config.github?.logins ?? {}), ...config.people].filter(Boolean).map((one) => String(one).toLowerCase()));
    return readCollaborators(config).filter((login) => !known.has(login.toLowerCase()) && !/\[bot\]$/i.test(login));
}
