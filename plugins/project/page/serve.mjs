// The project's page: node serve.mjs, from the project's folder or with CLAUDE_PROJECT_DIR; then http://localhost:<page.port>.
// It serves the page, its data, the cleanup, the colleagues' portraits, and each extension's script and routes.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, loadProject, notePath } from "../scripts/project.mjs";
import { context, loadExtensions } from "../scripts/extensions.mjs";
import { collect } from "./collect.mjs";
import { readOwner } from "../scripts/code.mjs";
import { apply, propose, runFix, tidyState } from "./tidy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8", ".yaml": "text/plain; charset=utf-8" };

/** The page's server for a project, with its extensions loaded; listen() starts it on the loopback addresses. */
export async function pageServer(from)
{
    const { config, say } = loadProject(from);
    const extensions = await loadExtensions(config);

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");

        if (!isOwnRequest(request)) {
            send(response, 403, "text/plain", "The project's page answers only its own pages, on localhost.");
            return;
        }

        try {
            if (url.pathname === "/data") {
                send(response, 200, "application/json", JSON.stringify(await collect(config, say, extensions)));
            } else if (url.pathname === "/whoami") {
                send(response, 200, "application/json", JSON.stringify({ root: config.root }));
            } else if (url.pathname === "/tidy") {
                send(response, 200, "application/json", JSON.stringify(tidyState(config)));
            } else if (request.method === "POST" && /^\/tidy\/fix\/(whitespace|dates)$/.test(url.pathname)) {
                const changed = runFix(config, url.pathname.split("/")[3]);
                send(response, 200, "application/json", JSON.stringify({ changed, state: tidyState(config) }));
            } else if (request.method === "POST" && url.pathname === "/tidy/propose") {
                send(response, propose(config, url.searchParams.get("scope") === "backlog" ? "backlog" : "docs") ? 200 : 409, "application/json", JSON.stringify(tidyState(config)));
            } else if (request.method === "POST" && url.pathname === "/tidy/apply") {
                const { ids } = JSON.parse((await body(request)) || "{}");
                send(response, Array.isArray(ids) && apply(config, ids.map(String)) ? 200 : 409, "application/json", JSON.stringify(tidyState(config)));
            } else if (request.method === "POST" && url.pathname === "/backlog") {
                const answer = changeBacklog(config, JSON.parse((await body(request)) || "{}"));
                send(response, answer.ok ? 200 : 400, "application/json", JSON.stringify(answer));
            } else if (/^\/document\/\d+$/.test(url.pathname)) {
                // A key document of the configuration, by its place in the list: never another file.
                const document = config.documents[Number(url.pathname.split("/")[2])];
                document && existsSync(document.path) ? send(response, 200, "text/plain; charset=utf-8", readFileSync(document.path)) : send(response, 404, "text/plain", "no such document");
            } else if (/^\/note\/\d+$/.test(url.pathname)) {
                // A task's note, by the task's number: never another file.
                const path = notePath(config, Number(url.pathname.split("/")[2]));
                existsSync(path) ? send(response, 200, "text/plain; charset=utf-8", readFileSync(path)) : send(response, 404, "text/plain", "no such note");
            } else if (url.pathname === "/avatar") {
                // The owner's GitHub picture, as the page's data names it.
                const owner = await readOwner(config);
                owner?.file ? send(response, 200, "image/jpeg", readFileSync(owner.file)) : send(response, 404, "text/plain", "no picture");
            } else if (url.pathname.startsWith("/portrait/")) {
                const id = url.pathname.slice("/portrait/".length).replace(/[^a-z0-9-]/g, "");
                const path = `${config.memory}/${id}/avatar-small.jpg`;
                existsSync(path) ? send(response, 200, "image/jpeg", readFileSync(path)) : send(response, 404, "text/plain", "no portrait");
            } else if (url.pathname.startsWith("/extension/")) {
                await extensionRoute(extensions, config, say, request, response, url);
            } else if (url.pathname === "/") {
                send(response, 200, "text/html; charset=utf-8", readFileSync(join(here, "index.html")));
            } else if (/^\/[\w-]+\.(js|css)$/.test(url.pathname)) {
                sendFile(response, here, url.pathname.slice(1));
            } else {
                send(response, 404, "text/plain", "not found");
            }
        } catch (error) {
            send(response, 500, "text/plain", String(error?.stack ?? error));
        }
    });

    return { config, server };
}

/** Starts the page on its port, on 127.0.0.1 and on ::1 where the system has it, so that localhost reaches it either way. */
export async function listen(server, port)
{
    await new Promise((done, fail) => server.once("error", fail).listen(port, "127.0.0.1", done));
    const second = createServer((request, response) => server.emit("request", request, response));
    second.on("error", () => undefined);
    second.listen(port, "::1");
}

/** A change of the backlog the page asks, through the backlog's own command line as the panel's buttons do: a task moved to a state
 * (start, done, postpone, todo) or its priority set. Anything else is refused. */
function changeBacklog(config, { command, id, priority, issue, title })
{
    const task = /^[\w-]+-\d+$/.test(String(id)) ? String(id) : null;
    const args = ["start", "done", "postpone", "todo"].includes(command) && task ? [command, task]
        : command === "set" && task && /^P[1-3]$/.test(String(priority)) ? ["set", task, "--p", String(priority)]
        : command === "issue" && /^\d+$/.test(String(issue)) ? ["add", ...(typeof title === "string" && title.trim() ? [title.replace(/\s+/g, " ").replaceAll(" · ", " - ").trim().slice(0, 300)] : []), "--issue", String(issue)]
        : null;

    if (!args) {
        return { ok: false, message: "The page changes a task's state (start, done, postpone, todo) or its priority (set with P1, P2 or P3), by its id, or makes a task of a GitHub issue (issue with its number)." };
    }

    const { CLAUDE_PROJECT_DIR, PROJECT_CONFIG, ...env } = process.env;
    const run = spawnSync(process.execPath, [join(here, "..", "scripts", "backlog.mjs"), ...args], { cwd: config.root, encoding: "utf8", env: { ...env, CLAUDE_PROJECT_DIR: config.root }, windowsHide: true });
    return { ok: run.status === 0, message: (run.status === 0 ? run.stdout : run.stderr).trim() };
}

/** A request this page may answer: addressed to a loopback name (a rebound DNS name is refused), and a change only from the page
 * itself, never from another site or another local page the browser has open. The panel's own requests carry no Origin. */
function isOwnRequest(request)
{
    const host = (request.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();

    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
        return false;
    }

    if (request.method === "GET" || request.method === "HEAD") {
        return true;
    }

    const origin = request.headers.origin;
    const port = (request.headers.host ?? "").split(":").at(-1);
    const own = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
    return request.headers["sec-fetch-site"] !== "cross-site" && (origin === undefined || own.includes(origin));
}

if (isMain(import.meta.url)) {
    const { config, server } = await pageServer();
    const portIndex = process.argv.indexOf("--port");
    const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : config.page.port;
    await listen(server, port);
    console.log(`Project page on http://localhost:${port}`);
}

/** /extension/<id>/page.js is the extension's script for the page; any other path under it is the extension's own route. */
async function extensionRoute(extensions, config, say, request, response, url)
{
    const [, , id, ...rest] = url.pathname.split("/");
    const extension = extensions.find((one) => one.id === id);

    if (!extension) {
        send(response, 404, "text/plain", "no such extension");
        return;
    }

    if (rest.join("/") === "page.js" && extension.script && existsSync(extension.script)) {
        send(response, 200, types[".js"], readFileSync(extension.script));
        return;
    }

    const answer = extension.route ? await extension.route({ method: request.method, path: `/${rest.join("/")}`, url, body: request.method === "POST" ? await body(request) : "" }, { ...context(config, say), file: (folder, path) => fileAnswer(folder, path) }) : undefined;

    if (!answer) {
        send(response, 404, "text/plain", "not found");
        return;
    }

    send(response, answer.status ?? 200, answer.type ?? "application/json", typeof answer.body === "string" || Buffer.isBuffer(answer.body) ? answer.body : JSON.stringify(answer.body));
}

/** A file under a folder as a route's answer, never outside it; undefined when there is none. */
function fileAnswer(folder, relativePath)
{
    const path = normalize(join(folder, relativePath));

    if (!path.startsWith(normalize(folder) + sep) || !existsSync(path) || !statSync(path).isFile()) {
        return undefined;
    }

    return { status: 200, type: types[extname(path)] ?? "application/octet-stream", body: readFileSync(path) };
}

function sendFile(response, folder, relativePath)
{
    const answer = fileAnswer(folder, relativePath);
    answer ? send(response, answer.status, answer.type, answer.body) : send(response, 404, "text/plain", "not found");
}

/** A request's body as text, at most 64 kB. */
function body(request)
{
    return new Promise((done, fail) => {
        let text = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            text += chunk;

            if (text.length > 65536) {
                request.destroy();
                fail(new Error("Body too large."));
            }
        });
        request.on("end", () => done(text));
        request.on("error", fail);
    });
}

function send(response, status, type, content)
{
    response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    response.end(content);
}
