// A preview of the project's panel as the desktop gets it: the mod draws the panel from a project's real snapshot, inside
// `claude plugin test`; the tree it hands over becomes an HTML page in the app's dark colors. Not the app's own paint, but its layout,
// drawings and wrapping. The page is Crew's preview (tools/preview.mjs of claude-crew). Usage:
//   node tools/preview.mjs <project> [--out page.html] [--open <key>,<key>]   (keys pressed in order: toggle-decisions, open-task-61…)
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const project = resolve(args.find((arg) => !arg.startsWith("--") && !args[args.indexOf(arg) - 1]?.startsWith("--")) ?? ".");
const out = resolve(option("out", join(project, "tmp", "project-preview.html")));
const presses = option("open", "").split(",").filter(Boolean);
const symbols = new Map();
let drawings = 0;
const sandbox = mkdtempSync(join(tmpdir(), "project-preview-"));

try {
    const snapshot = spawnSync(process.execPath, [join(repo, "plugins", "project", "scripts", "snapshot.mjs")], { cwd: project, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: project }, maxBuffer: 64 * 1024 * 1024 });

    if (snapshot.status !== 0) {
        throw new Error(`snapshot.mjs failed: ${snapshot.stderr}`);
    }

    const mod = join(sandbox, "project");
    cpSync(join(repo, "plugins", "project"), mod, { recursive: true, filter: (source) => !/\.test\.|[\/]\.claude-plugin[\/]types/.test(source) });
    writeFileSync(join(mod, "hooks", "preview.test.tsx"), previewTest(snapshot.stdout.trim()));
    const run = spawnSync(`"${process.env.CLAUDE_BIN ?? "claude"}" plugin test "${mod}"`, { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout}\n${run.stderr}`;
    const trees = Object.fromEntries([...output.matchAll(/^PREVIEW (\w+) (.+)$/gm)].map((match) => [match[1], JSON.parse(match[2])]));

    if (!trees.pane) {
        throw new Error(`The mod drew no panel:\n${output.slice(-3000)}`);
    }

    writeFileSync(out, page(trees));
    console.log(`written ${out}`);
} finally {
    rmSync(sandbox, { recursive: true, force: true });
}

function previewTest(snapshot)
{
    return `import { mock, test } from "claude-code/testing";

const snapshot = ${JSON.stringify(snapshot)};

test("preview", { timeoutMs: 20000 }, async ($, on) => {
    mock.clock(on, { now: Date.now() });
    mock.store(on);
    on("session.start", () => ({ cwd: "/p" }) as never);
    on("session.root", () => ({ value: "/p" }));
    on("command.register", () => ({ value: {} }) as never);
    on("fs.stat", () => ({ value: { kind: "file", size: 1, mtimeMs: 1, isLink: false } }) as never);
    on("process.run", () => ({ value: { exitCode: 0, stdout: snapshot, stderr: "", isStdoutTruncated: false, isStderrTruncated: false } }) as never);
    on("ui.open", () => ({ value: { isPlaced: true } }) as never);
    on("ui.render", ($, e) => {
        const { Text } = $.ui.resolve(e);
        return <Text key="engine">engine</Text>;
    });
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const pane = await $.ui.mount({ plugin: "project", surface: "desktop", component: "Pane", requestId: "project", props: { title: "Progetto", isFocused: false, bodyColumns: 60, placement: "dock" } as never });
    ${presses.map((key) => `await pane.press({ key: ${JSON.stringify(key)} });`).join("\n    ")}
    console.log("PREVIEW pane " + JSON.stringify(await pane.find({})));
});
`;
}

// The trees as HTML: Box a flex box, Text a span, Button a button, Svg an image, Markdown a little markdown.
function page(trees)
{
    const sections = [["pane", "Pannello"], ["band", "Sopra il prompt"], ["chat", "Chat"]].filter(([key]) => trees[key])
        .map(([key, title]) => `<section class="${key}"><h2>${title}</h2><div class="surface">${element(trees[key], false)}</div></section>`);
    return `<!doctype html><meta charset="utf-8"><title>Project panel preview</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:16px;background:#141413;color:#ececec;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
h2{font-size:11px;font-weight:600;color:#7d7d79;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}
.surface{background:#1f1f1e;border:1px solid #333331;border-radius:10px;padding:12px}
.pane .surface{width:var(--pane,380px);resize:horizontal;overflow:auto}
.band .surface,.chat .surface{width:520px;resize:horizontal;overflow:auto}
.box{display:flex;min-width:0;position:relative}
.text{min-width:0}.text.block{display:block}.dim{color:#9a9a96}.bold{font-weight:600}.italic{font-style:italic}
.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{font:inherit;color:#ececec;background:#2c2c2b;border:1px solid #3a3a38;border-radius:6px;padding:2px 8px;cursor:pointer}
button.plain{background:none;border:none;padding:0;color:#ececec;font-weight:600;text-align:left}
button.plain:hover{text-decoration:underline}
select{font:inherit;background:#2c2c2b;color:#ececec;border:1px solid #3a3a38;border-radius:6px}
.md p{margin:0 0 4px}.md ul{margin:0;padding-left:18px}.md code{background:#2c2c2b;border-radius:4px;padding:0 3px}
.svg{display:inline-block;flex-shrink:0;line-height:0}.svg>svg{width:100%;height:100%}
</style>${sections.join("")}${symbolDefinitions()}`;
}

function element(node, isInline)
{
    if (typeof node === "string") {
        return escape(node);
    }

    if (!node || typeof node !== "object") {
        return "";
    }

    const props = node.props ?? {};
    const children = (node.children ?? []).map(child => element(child, node.type === "Text"));

    switch (node.type) {
        case "Box":
            return `<div class="box" style="${boxStyle(props)}">${children.join("")}</div>`;
        case "Text": {
            const classes = ["text", isInline ? "" : "block", props.dimColor ? "dim" : "", props.bold ? "bold" : "", props.italic ? "italic" : "", String(props.wrap ?? "").startsWith("truncate") ? "truncate" : ""];
            const color = props.color && String(props.color).startsWith("#") ? `color:${props.color}` : "";
            return `<span class="${classes.filter(Boolean).join(" ")}" style="${color}">${children.join("")}</span>`;
        }
        case "Button":
            // Children of text are drawn in the label's place, as the app does; the label then only names the control.
            return `<button class="${props.plain ? "plain" : ""}">${node.children?.length ? node.children.map(child => (typeof child === "string" ? escape(child).replace(/\n/g, "<br>") : element(child, true))).join("") : escape(String(props.label ?? node.text ?? ""))}</button>`;
        case "Svg":
            // Without a width, the drawing takes the room it is given, as the app's image does.
            return `<span class="svg" style="${props.width ? `width:${props.width}px` : "display:block;flex:1 1 auto;min-width:0"};height:${props.height}px">${inlineSvg(String(props.source ?? ""))}</span>`;
        case "Markdown":
            return `<div class="md${props.dimColor ? " dim" : ""}">${markdown(String(props.text ?? ""))}</div>`;
        case "Select":
            return `<select><option>${escape(String(props.label ?? ""))}</option>${(props.options ?? []).map(choice => `<option>${escape(choice.label ?? choice.value)}</option>`).join("")}</select>`;
        default:
            return children.join("");
    }
}

// An Svg drawn inline: its ids made unique in the page, each portrait defined once as a symbol and used where it is drawn.
function inlineSvg(source)
{
    const number = ++drawings;
    return source
        .replace(/id="([\w-]+)"/g, `id="$1-${number}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1-${number})`)
        .replace(/<image href="(data:[^"]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"([^>]*)\/>/g, (_, uri, x, y, width, height, rest) => {
            if (!symbols.has(uri)) {
                symbols.set(uri, `portrait-${symbols.size + 1}`);
            }

            return `<use href="#${symbols.get(uri)}" x="${x}" y="${y}" width="${width}" height="${height}"${rest.replace(/ preserveAspectRatio="[^"]*"/, "")}/>`;
        });
}

function symbolDefinitions()
{
    return `<svg width="0" height="0" style="position:absolute"><defs>${[...symbols].map(([uri, id]) => `<symbol id="${id}" viewBox="0 0 128 128"><image href="${uri}" width="128" height="128" preserveAspectRatio="xMidYMid slice"/></symbol>`).join("")}</defs></svg>`;
}

// The desktop's cells as pixels: about 8 across.
function boxStyle(props)
{
    const cell = value => `${Number(value) * 8}px`;
    const rules = [
        `flex-direction:${props.flexDirection ?? "row"}`,
        props.flexWrap ? `flex-wrap:${props.flexWrap}` : "",
        props.alignItems ? `align-items:${props.alignItems}` : "",
        props.justifyContent ? `justify-content:${props.justifyContent}` : "",
        // A width in percent, as the bar's filled part has; the cells of a numeric one are left to the flex layout.
        typeof props.width === "string" ? `width:${props.width}` : "",
        props.flexGrow !== undefined ? `flex-grow:${props.flexGrow}` : "",
        props.flexShrink !== undefined ? `flex-shrink:${props.flexShrink}` : "",
        props.gap !== undefined ? `gap:${cell(props.gap)}` : "",
        props.columnGap !== undefined ? `column-gap:${cell(props.columnGap)}` : "",
        props.rowGap !== undefined ? `row-gap:${cell(props.rowGap)}` : "",
        props.paddingLeft !== undefined ? `padding-left:${cell(props.paddingLeft)}` : "",
        props.paddingX !== undefined ? `padding-left:${cell(props.paddingX)};padding-right:${cell(props.paddingX)}` : "",
        props.paddingY !== undefined ? `padding-top:${cell(props.paddingY)};padding-bottom:${cell(props.paddingY)}` : "",
        // The outlined cards: a thin line in their color, rounded as the desktop draws them.
        props.borderStyle ? `border:1px solid ${props.borderColor ?? "#8080803d"};border-radius:${props.borderStyle === "round" ? 8 : 0}px;padding-top:4px;padding-bottom:4px` : "",
        props.marginBottom !== undefined ? `margin-bottom:${cell(props.marginBottom)}` : "",
        props.backgroundColor ? `background:${props.backgroundColor}` : "",
        // Laid over its neighbours, as the app does: the clear buttons over a drawing take no room.
        props.position === "absolute" ? `position:absolute;${["top", "left", "right", "bottom"].filter(side => props[side] !== undefined).map(side => `${side}:${cell(props[side])}`).join(";")}` : "",
        props.marginTop !== undefined ? `margin-top:${cell(props.marginTop)}` : "",
        props.overflow === "hidden" ? "overflow:hidden" : "",
        // A box shown only under the pointer, as the hints are, stays hidden here.
        props.display === "none" ? "display:none" : "",
    ];
    return rules.filter(Boolean).join(";");
}

function markdown(text)
{
    const inline = line => escape(line).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const blocks = text.split(/\n\s*\n/);
    return blocks.map(block => {
        const lines = block.split("\n");
        return lines.every(line => /^\s*- /.test(line))
            ? `<ul>${lines.map(line => `<li>${inline(line.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`
            : `<p>${lines.map(inline).join("<br>")}</p>`;
    }).join("");
}

function escape(text)
{
    return String(text).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}
