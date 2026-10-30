// The project's extensions: modules the configuration lists, which add the project's own parts to the page and links to the panel.
// An extension exports `id`, and any of `collect(context)` (its data for the page), `route(request, context)` (its paths under
// /extension/<id>/), `script` (its file for the page) and `panel(context)` (its links in the panel: { label, href } or { label, post }).
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { git, read, shown } from "./project.mjs";

/** The extensions of the configuration, each with its id and folder; one that does not load keeps its error, and the rest go on. */
export async function loadExtensions(config)
{
    const loaded = [];

    for (const path of config.extensions) {
        const fallback = path.split("/").at(-1).replace(/\.m?js$/, "").replace(/[^\w-]/g, "");

        try {
            const module = await import(pathToFileURL(path).href);
            const id = String(module.id ?? fallback).replace(/[^\w-]/g, "");
            loaded.push({ id, collect: module.collect, route: module.route, panel: module.panel, script: module.script ? resolve(dirname(path), module.script) : null, folder: dirname(path) });
        } catch (error) {
            loaded.push({ id: fallback, error: `${shown(config, path)}: ${String(error?.message ?? error).split("\n")[0]}`, folder: dirname(path) });
        }
    }

    return loaded;
}

/** What an extension is handed: the configuration, the words, and the helpers to read the project. */
export function context(config, say)
{
    return { config, say, read, shown: (path) => shown(config, path), git };
}

/** The links every extension gives the panel, the page's own paths made whole; an extension that fails gives none. */
export async function panelLinks(config, say, extensions, page)
{
    const links = [];

    for (const extension of extensions.filter((one) => one.panel)) {
        try {
            for (const link of (await extension.panel(context(config, say))) ?? []) {
                const local = (path) => `${page}/extension/${extension.id}${path.startsWith("/") ? path : `/${path}`}`;
                links.push({ label: String(link.label), ...(link.href ? { href: link.href.startsWith("/") ? local(link.href) : link.href } : {}), ...(link.post ? { post: local(link.post) } : {}) });
            }
        } catch {
            // the page shows the extension's error; the panel just goes without its links
        }
    }

    return links;
}

/** The errors of the extensions that did not load, for the panel to say. */
export function extensionErrors(extensions)
{
    return extensions.filter((extension) => extension.error).map((extension) => extension.error);
}
