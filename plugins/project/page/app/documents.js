// The documents: the key ones and the docs' others as a gallery, each with its page in small; the reader that opens them, and the
// markdown made readable.

// The kinds of document the page knows by their names, in English and Italian, and the icon and color of each.
const documentKinds = [
    ["design", /\bgdd\b|design|game design/],
    ["spec", /specific|spec\b|requisit|requirement/],
    ["architecture", /architet/],
    ["rules", /meccanic|mechanic|regol|\brules?\b/],
    ["glossary", /glossar|lessic|vocabolar|dictionar/],
    ["tests", /copertur|coverage|playtest|\btests?\b/],
    ["plan", /\bplan\b|\bpiano\b|roadmap/],
    ["decisions", /decision/],
    ["tasks", /\btasks?\b|backlog|compiti/],
    ["ideas", /\bide[ae]\b|\bideas\b|inbox/],
    ["wishes", /desiderat|wish/],
    ["index", /readme|indice|\bindex\b/],
];
const documentDrawings = {
    design: ["#8a63c9", '<path d="M10 2.5l5 7.5-5 7.5-5-7.5z"/><circle cx="10" cy="10.5" r="1.6"/><path d="M10 2.5v6.4"/>'],
    spec: ["#1baf7a", '<path d="M3.5 5.5l1.5 1.5 2.5-3M3.5 12.5l1.5 1.5 2.5-3"/><path d="M10.5 5.5h6M10.5 12.5h6"/>'],
    architecture: ["#2a78d6", '<path d="M10 3l7 3.5-7 3.5-7-3.5z"/><path d="M3 10l7 3.5 7-3.5M3 13.5l7 3.5 7-3.5"/>'],
    rules: ["#eb6834", '<circle cx="10" cy="10" r="2.6"/><circle cx="10" cy="10" r="5.4"/><path d="M10 2v2.6M10 15.4V18M2 10h2.6M15.4 10H18M4.3 4.3l1.9 1.9M13.8 13.8l1.9 1.9M4.3 15.7l1.9-1.9M13.8 6.2l1.9-1.9"/>'],
    glossary: ["#0fa3b1", '<path d="M3 4.5c2.5-1 5-1 7 .6 2-1.6 4.5-1.6 7-.6v11c-2.5-1-5-1-7 .6-2-1.6-4.5-1.6-7-.6z"/><path d="M10 5.1v11"/>'],
    tests: ["#e87ba4", '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.8"/><circle cx="10" cy="10" r="0.9" fill="currentColor"/>'],
    plan: ["#2a78d6", '<path d="M5 17.5V2.8"/><path d="M5 3.5h9.5l-2.2 3.2 2.2 3.2H5"/>'],
    decisions: ["#8a63c9", '<path d="M10 3v14M6.5 17h7M4 5.5h12"/><path d="M4 5.5L2 11h4zM16 5.5L14 11h4z"/>'],
    tasks: ["#4e9a6b", '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7.7 3.5v13M12.3 3.5v13"/>'],
    ideas: ["#c99400", '<path d="M7.2 13.5c0-1.6-2.7-3-2.7-5.6a5.5 5.5 0 0 1 11 0c0 2.6-2.7 4-2.7 5.6z"/><path d="M7.6 16h4.8M8.6 18h2.8"/>'],
    wishes: ["#c99400", '<path d="M10 2.8l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.6l-4.3 2.3.9-4.8-3.5-3.3 4.8-.6z"/>'],
    index: ["#898781", '<circle cx="10" cy="10" r="7"/><path d="M10 9v5"/><circle cx="10" cy="6.4" r="0.7" fill="currentColor"/>'],
    page: ["#898781", '<path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5"/>'],
};
// The documents' texts the page has read, for their previews: by address and the day they changed; those being read.
const documentTexts = new Map();
const documentsReading = new Set();

/** The documents' tab: the key documents, then the docs' others, the most recent first, with the inbox's entries; each card's page read
 * once for its preview. */
function documentsPanel()
{
    const { inbox } = data;
    const key = data.keyDocuments ?? [];
    const all = readerDocuments();
    readDocuments(all.filter((document) => document.exists).map((document) => ({ href: document.href, stamp: documentStamp(document) })));
    const gallery = key.length ? `<section class="card span-12">
            <h2>${t("keyTitle")}</h2>
            <p class="hint">${t("keyHint")}</p>
            <div class="doc-gallery">${key.map(documentCard).join("")}</div>
        </section>` : "";

    return `${gallery}<section class="card span-12">
            <h2>${t(key.length ? "otherDocumentsTitle" : "documentsTitle")}</h2>
            <p class="hint">${escape(t("documentsHint", data.docs))}${inbox ? ` ${escape(t("inboxEntries", inbox.name, inbox.count))}` : ""}</p>
            <div class="doc-gallery">${all.slice(key.length).map((document, index) => documentCard(document, key.length + index)).join("")}</div>
        </section>`;
}

/** The documents the reader opens, by their place: the key ones first, as the panel's links count them, then the docs' others, the most
 * recent first. */
function readerDocuments()
{
    const key = data.keyDocuments ?? [];
    const keyPaths = new Set(key.map((document) => document.path));
    const others = (data.documents ?? []).filter((document) => !keyPaths.has(documentPath(document)))
        .map((document) => ({ name: document.name.replace(/\.md$/i, ""), path: documentPath(document), href: document.href, exists: true, description: document.description }));
    return [...key, ...others];
}

/** A document: its page in small, an icon for its kind, its name, its description (its frontmatter's, else its first line), when it
 * changed and how long it is. The card opens it. */
function documentCard(document, index)
{
    const known = data.documents.find((one) => documentPath(one) === document.path);
    const text = documentTexts.get(`${document.href}@${documentStamp(document)}`);
    const facts = known ? [formatDay(known.modified.slice(0, 10)), t("docWords", known.words.toLocaleString(t("locale")))] : [];
    const icon = documentIcon(document.name, document.path);

    if (!document.exists) {
        return `<article class="doc-card missing">
                <div class="doc-paper empty" aria-hidden="true"></div>
                <div class="doc-info">${icon}<div><h3>${escape(document.name)}</h3><p class="doc-sub">${t("docMissing")}</p></div></div>
                <p class="doc-meta"><code title="${attribute(document.path)}">${escape(document.path)}</code></p>
            </article>`;
    }

    return `<article class="doc-card">
            <div class="doc-paper ${text === undefined ? "empty" : ""}" aria-hidden="true">${text === undefined ? "" : markdown(text.split(/\r?\n/).slice(0, 48).join("\n"))}</div>
            <div class="doc-info">${icon}<div>
                <h3><button type="button" class="doc-open" id="open-document-${index}" data-document="${index}" aria-describedby="document-sub-${index}">${escape(document.name)}</button></h3>
                <p class="doc-sub" id="document-sub-${index}">${escape(document.description || (text === undefined ? document.path : documentSubtitle(text, document.name)))}</p>
            </div></div>
            <p class="doc-meta" data-tip="${attribute(escape(document.path))}">${facts.map(escape).join(" · ")}</p>
        </article>`;
}

/** Reads the texts of the documents the gallery shows that the page has not read yet, then draws the page once. */
async function readDocuments(list)
{
    const missing = list.filter(({ href, stamp }) => !documentTexts.has(`${href}@${stamp}`) && !documentsReading.has(href));

    if (missing.length === 0) {
        return;
    }

    let read = 0;
    missing.forEach(({ href }) => documentsReading.add(href));
    await Promise.all(missing.map(async ({ href, stamp }) => {
        try {
            const response = await fetch(href);
            documentTexts.set(`${href}@${stamp}`, response.ok ? withoutFrontmatter(await response.text()) : "");
            read++;
        } catch {
            // the server is restarting: the next reading of the data tries again
        }

        documentsReading.delete(href);
    }));

    if (read > 0) {
        rerender();
    }
}

/** A document's path as the configuration writes it, from the docs' folder. */
function documentPath(document)
{
    return `${data.docs.replace(/\/$/, "")}/${document.name}`;
}

/** When a document last changed, as far as the page knows: its text is read again after. */
function documentStamp(document)
{
    return data.documents.find((one) => documentPath(one) === document.path)?.modified ?? "";
}

/** A document's first line under its name: its heading, unless it only says the name again, else its first sentence. */
function documentSubtitle(text, name)
{
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const plain = (line) => line.replace(/^#+\s*/, "").replace(/^>\s*(\[!\w+\]\s*)?/, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    const heading = lines.find((line) => /^#\s/.test(line));
    const title = heading ? plain(heading) : "";
    const repeats = !title || folded(title).includes(folded(name)) || folded(name).includes(folded(title));
    const first = lines.find((line) => !/^(#|\||```|[-*_]{3,}$)/.test(line));

    return repeats ? plain(first ?? "") : title;
}

/** An icon for the kind of a document, read from its name: the design, a specification, the architecture, rules, a glossary, tests, a
 * plan, decisions, tasks, ideas, wishes, an index; a page for any other. */
function documentIcon(name, path)
{
    const text = folded(`${name} ${path.split("/").at(-1)}`);
    const kind = documentKinds.find(([, pattern]) => pattern.test(text))?.[0] ?? "page";
    const [color, drawing] = documentDrawings[kind];

    return `<span class="doc-icon" style="--kind:${color}" aria-hidden="true"><svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg></span>`;
}

/** The document the address asks for by its place, #documents/2 (the panel's links), opened in the reader once; the address keeps the
 * tab. */
function openAskedDocument()
{
    const asked = /^#documents\/(\d+)$/.exec(location.hash);

    if (asked && data && readerDocuments()[Number(asked[1])]) {
        history.replaceState(null, "", "#documents");
        openDocument(Number(asked[1]));
    }
}

/** Opens a document in the page's reader, its markdown made readable; the plain text stays a link away. */
async function openDocument(index, opener)
{
    const document = readerDocuments()[index];
    const reader = window.document.getElementById("reader");

    if (!document) {
        return;
    }

    reader.querySelector("h2").textContent = document.name;
    reader.querySelector(".reader-path").textContent = document.path;
    reader.querySelector(".reader-plain").href = document.href;
    reader.querySelector(".reader-plain").textContent = t("docPlain");
    reader.querySelector(".reader-close").textContent = t("docClose");
    const body = reader.querySelector(".reader-body");
    body.innerHTML = `<p class="hint">${t("docLoading")}</p>`;
    reader.returnFocus = opener;

    if (!reader.open) {
        reader.showModal();
    }

    try {
        const response = await fetch(document.href);

        if (!response.ok) {
            throw new Error(`${response.status} ${await response.text()}`);
        }

        body.innerHTML = markdown(withoutFrontmatter(await response.text()));
        body.scrollTop = 0;
    } catch (error) {
        body.innerHTML = `<p class="hint">${escape(t("failed", error.message))}</p>`;
    }
}

/** The reader's hands, put once: its button and its backdrop close it, and the focus goes back to what opened it. */
function setupReader()
{
    const reader = document.getElementById("reader");
    reader.querySelector(".reader-close").addEventListener("click", () => reader.close());
    reader.addEventListener("close", () => reader.returnFocus?.focus());
    // A click on the backdrop, outside the reader's box, closes it.
    reader.addEventListener("click", (event) => {
        if (event.target === reader) {
            reader.close();
        }
    });
    // A link to another of the page's documents opens it here; any other link to a page of the docs has nowhere to go.
    reader.addEventListener("click", (event) => {
        const link = event.target.closest?.("a[data-document]");

        if (link) {
            event.preventDefault();
            openDocument(Number(link.dataset.document), reader.returnFocus);
        }
    });
}

/** A document's text without its frontmatter, the `---` block at its top: the file's, not the reader's. */
function withoutFrontmatter(text)
{
    return String(text ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").replace(/^(\r?\n)+/, "");
}

/** Markdown made readable, enough for the project's docs: headings, paragraphs, lists, quotes and callouts, tables, code, links; a
 * frontmatter at its top is left out. */
function markdown(text)
{
    const lines = withoutFrontmatter(text).replace(/\r/g, "").split("\n");
    const html = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (/^```/.test(line)) {
            const code = [];

            for (index++; index < lines.length && !/^```/.test(lines[index]); index++) {
                code.push(lines[index]);
            }

            html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
            index++;
        } else if (/^#{1,6}\s/.test(line)) {
            const level = Math.min(6, line.match(/^#+/)[0].length + 1);
            html.push(`<h${level}>${inline(line.replace(/^#+\s*/, ""))}</h${level}>`);
            index++;
        } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            html.push("<hr>");
            index++;
        } else if (/^>/.test(line)) {
            const quote = [];

            for (; index < lines.length && /^>/.test(lines[index]); index++) {
                quote.push(lines[index].replace(/^>\s?/, ""));
            }

            const callout = /^\[!(\w+)\]\s*(.*)$/.exec(quote[0] ?? "");
            const inner = callout ? [callout[2] ? `**${callout[2]}**` : "", ...quote.slice(1)] : quote;
            html.push(`<blockquote${callout ? ` class="callout"` : ""}>${markdown(inner.join("\n"))}</blockquote>`);
        } else if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? "")) {
            const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
            const head = cells(line);
            const rows = [];

            for (index += 2; index < lines.length && /^\|/.test(lines[index]); index++) {
                rows.push(cells(lines[index]));
            }

            html.push(`<div class="reader-table"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        } else if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
            html.push(list(lines, index));
            index = list.end;
        } else if (line.trim() === "") {
            index++;
        } else {
            const paragraph = [];

            for (; index < lines.length && lines[index].trim() !== "" && !/^(#{1,6}\s|>|```|\|)/.test(lines[index]) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[index]); index++) {
                paragraph.push(lines[index]);
            }

            html.push(`<p>${inline(paragraph.join(" "))}</p>`);
        }
    }

    return html.join("\n");
}

/** A list from a line on, with the lists nested under it by their indent; list.end is the first line after it. */
function list(lines, start)
{
    const indentOf = (line) => line.match(/^\s*/)[0].length;
    const indent = indentOf(lines[start]);
    const ordered = /^\s*\d+[.)]\s/.test(lines[start]);
    const items = [];
    let index = start;

    while (index < lines.length) {
        const line = lines[index];

        if (/^\s*([-*+]|\d+[.)])\s/.test(line) && indentOf(line) === indent) {
            items.push({ text: line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""), nested: "" });
            index++;
        } else if (/^\s*([-*+]|\d+[.)])\s/.test(line) && indentOf(line) > indent && items.length) {
            items.at(-1).nested += list(lines, index);
            index = list.end;
        } else if (line.trim() !== "" && indentOf(line) > indent && items.length) {
            items.at(-1).text += ` ${line.trim()}`;
            index++;
        } else {
            break;
        }
    }

    list.end = index;
    const tag = ordered ? "ol" : "ul";

    return `<${tag}>${items.map((item) => `<li>${inline(item.text.replace(/^\[([ xX])\]\s/, (_, mark) => (mark === " " ? "☐ " : "☑ ")))}${item.nested}</li>`).join("")}</${tag}>`;
}

/** A line's inline markdown: code, bold, italics, links; a link to another document opens it in the reader. */
function inline(text)
{
    const codes = [];
    let html = escape(text).replace(/`([^`]+)`/g, (_, code) => {
        codes.push(`<code>${code}</code>`);
        return `\u0000${codes.length - 1}\u0000`;
    });
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>");
    const documents = readerDocuments();
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) => {
        const file = target.split("#")[0].split("/").at(-1);
        const found = documents.findIndex((document) => document.exists && file && document.path.split("/").at(-1) === file);

        if (found >= 0) {
            return `<a href="${attribute(documents[found].href)}" data-document="${found}">${label}</a>`;
        }

        return /^https?:\/\//.test(target) ? `<a href="${target}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span class="reader-link" title="${target}">${label}</span>`;
    });

    return html.replace(/\u0000(\d+)\u0000/g, (_, number) => codes[Number(number)]);
}
