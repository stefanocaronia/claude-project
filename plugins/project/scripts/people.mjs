// The people of a project that several work on, each with their own Claude (D-18): who works on this machine, `me:` in their own
// settings, .claude/project.local.yaml, which the code's repo never commits; and the repo's collaborators on GitHub who are none of the
// project's people yet, for the user to add on a yes.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isShared, localConfigFile } from "../lib/config.mjs";
import { personOfUser, readCollaborators, readLogin } from "./code.mjs";
import { git, read } from "./project.mjs";

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
