// The project's releases: its tags and the notes in <docs>/releases, a plugin's or a package's version; and its contracts, now and at
// the last release.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { relativeTo } from "../lib/config.mjs";
import { contractState, contractValue } from "../lib/contracts.mjs";
import { splitFrontmatter } from "../lib/frontmatter.mjs";
import { compareVersions, messageSummary, parseRelease } from "../lib/release.mjs";
import { read, shown } from "./files.mjs";
import { git } from "./git.mjs";

/** The project's releases, the oldest version first: { version, day, summary, tasks, text, tagged, tagOnly, source }. The repo's tags
 * make them (v1.2.3 or 1.2.3), each on its tag's day; the notes in <docs>/releases go with their version's tag. Notes not tagged yet
 * (written, the tag still to make) are releases too, `tagged` false; a tag without notes has `tagOnly`, its summary and text from the
 * tag's own message when it says more than the version, else from the commit it marks (`source` "tag" or "commit"). With neither, the
 * version of the project's package.json, without a day: a project that released before the plugin starts from where it is. A Claude
 * Code plugin's version, in its manifest, counts past every tag and notes (`source` "plugin"), on the day the manifest took it. */
export function readReleases(config)
{
    const notes = new Map((!existsSync(config.files.releases) ? [] : readdirSync(config.files.releases))
        .filter((name) => /^v\d+\.\d+\.\d+\.md$/.test(name))
        .map((name) => {
            const text = read(join(config.files.releases, name));
            const release = parseRelease(text, config.prefixes.task);
            // The contracts' numbers the release recorded, by name.
            const contracts = splitFrontmatter(text).data.contracts;
            return release ? [release.version, { ...release, text, contracts: contracts && typeof contracts === "object" ? contracts : null }] : null;
        })
        .filter(Boolean));
    // Each tag with its day, its own message (an annotated tag's) and its commit's, fields and tags apart by the ASCII separators.
    const tags = new Map(git(config.root, ["for-each-ref", "--format=%(refname:short)%1f%(creatordate:short)%1f%(objecttype)%1f%(contents)%1f%(*contents)%1e", "refs/tags"])
        .split("\x1e").map((record) => record.replace(/^\s+/, "").split("\x1f"))
        .filter(([name, day]) => /^v?\d+\.\d+\.\d+$/.test(name ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(day ?? ""))
        .map(([name, day, type, own = "", marked = ""]) => {
            const version = name.replace(/^v/, "");
            const message = (type === "tag" ? own : "").replace(/-----BEGIN PGP SIGNATURE-----[\s\S]*$/, "").trim();
            const [text, source] = messageSummary(message, version) ? [message, "tag"] : [(type === "tag" ? marked : own).trim(), "commit"];
            return [version, { day, text, source }];
        }));
    const releases = [...new Set([...tags.keys(), ...notes.keys()])].map((version) => {
        const written = notes.get(version);
        const tag = tags.get(version);
        return written ? { ...written, day: tag?.day ?? written.day, tagged: tag !== undefined, tagOnly: false, source: "notes" }
            : { version, day: tag.day, summary: messageSummary(tag.text, version), tasks: [], text: tag.text, tagged: true, tagOnly: true, source: tag.source };
    });
    const packaged = releases.length === 0 ? packageVersion(config) : null;
    // A plugin's version is the one Claude Code installs, written in its manifest, whose tags may stop being made: it counts once it is
    // past every tag and notes.
    const plugin = packaged ? null : pluginVersion(config);
    const declared = plugin && releases.every((release) => compareVersions(plugin.version, release.version) > 0)
        ? { version: plugin.version, day: plugin.day, summary: "", tasks: [], text: "", tagged: false, tagOnly: true, source: "plugin" } : null;
    return [...releases, ...(packaged ? [{ version: packaged, day: "", summary: "", tasks: [], text: "", tagged: false, tagOnly: true, source: "package" }] : []), ...(declared ? [declared] : [])]
        .sort((first, second) => compareVersions(first.version, second.version));
}

/** Whether the project shows its versions: where it has a release already (a tag, notes or a package's version), or declares contracts
 * or the checks before one, unless its configuration says (`release: true | false`, or `show:`). A book that never releases is not
 * asked to. */
export function showsReleases(config, releases = readReleases(config))
{
    const declared = (config.contracts ?? []).length > 0 || (config.release?.run ?? []).length > 0 || (config.release?.remember ?? []).length > 0;
    return config.release?.show ?? (releases.length > 0 || declared);
}

/** The project's contracts now and at its last release, each { name, file, current, before, state }: the number the last release's
 * notes recorded, else the one its tag holds. */
export function readContracts(config, releases = readReleases(config))
{
    const last = releases.at(-1);
    const atTag = (contract) => {
        const path = relativeTo(config.root, contract.file);
        const text = last?.tagged ? [`v${last.version}`, last.version].map((tag) => git(config.root, ["show", `${tag}:${path}`])).find(Boolean) : "";
        return text ? contractValue(text, contract) : null;
    };

    return (config.contracts ?? []).map((contract) => {
        const recorded = last?.contracts?.[contract.name];
        const before = recorded !== undefined && recorded !== null ? String(recorded) : last && last.source !== "package" ? atTag(contract) : null;
        return { ...contractState(contract, contractValue(read(contract.file), contract), before), file: shown(config, contract.file) };
    });
}

/** The version of the project's package.json, when it has one as MAJOR.MINOR.PATCH; else null. */
function packageVersion(config)
{
    try {
        const version = JSON.parse(read(join(config.root, "package.json"))).version;
        return /^\d+\.\d+\.\d+$/.test(String(version)) ? version : null;
    } catch {
        return null;
    }
}

/** The version of a Claude Code plugin the project is: its .claude-plugin/plugin.json's, else that of the one plugin its
 * .claude-plugin/marketplace.json lists (its folder's plugin.json's, which Claude Code reads first, else the entry's), as
 * MAJOR.MINOR.PATCH; { version, day }, day that of the last commit that changed the version in that file, while the committed file says
 * the same; else null. */
function pluginVersion(config)
{
    const json = (path) => {
        try {
            return JSON.parse(read(path));
        } catch {
            return null;
        }
    };
    const own = join(config.root, ".claude-plugin", "plugin.json");
    const plugins = json(join(config.root, ".claude-plugin", "marketplace.json"))?.plugins;
    const only = Array.isArray(plugins) && plugins.length === 1 ? plugins[0] : null;
    const folder = typeof only?.source === "string" && only.source.startsWith("./") ? join(config.root, only.source, ".claude-plugin", "plugin.json") : null;
    const [version, file] = [[json(own)?.version, own], [folder && json(folder)?.version, folder], [only?.version, join(config.root, ".claude-plugin", "marketplace.json")]]
        .find(([one]) => /^\d+\.\d+\.\d+$/.test(String(one ?? ""))) ?? [];

    if (!version) {
        return null;
    }

    const path = relativeTo(config.root, file);
    const committed = git(config.root, ["show", `HEAD:./${path}`]).includes(`"${version}"`);
    return { version, day: committed ? git(config.root, ["log", "-1", "--format=%cs", "-G", "\"version\"", "--", path]).trim() : "" };
}
