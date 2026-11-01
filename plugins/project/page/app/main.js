// The page's state and its drawing, the last of its scripts: it reads the project's data every few seconds and draws the tabs when it
// changed, lets the extensions in, and starts the page.

// The project's data as the server last gave it, and its text, to draw again only when it changed; the days the charts share.
let data = null;
let lastData = "";
let days = [];
// The task being written in the list: "new", a task's number, or null; while it is, the page does not draw itself again.
let editing = null;
// A card being dragged, and a drawing that waits for its drop; where the focus goes after a change, and the card just moved.
let dragging = null;
let renderWaits = false;
let focusAfter = null;
let landed = null;
// The extensions registered, and the scripts loaded for them.
const extensions = [];
const loadedScripts = new Set();

/** What an extension draws with: the page's helpers, words and data calls. */
const kit = {
    escape, attribute, tile, ring, progressBar, dayBars, formatDay, time, relative, colors, fetchJson, post, t,
    dayRange: () => days,
    get language() {
        return data?.language ?? "en";
    },
    rerender,
};

/** The extensions' entry point: each one's script calls projectPage.register({ id, tabs, tiles, rhythm, mounted, style }). */
window.projectPage = {
    register(extension) {
        if (!extension?.id || extensions.some((one) => one.id === extension.id)) {
            return;
        }

        extensions.push(extension);

        if (extension.style) {
            const style = document.createElement("style");
            style.textContent = extension.style;
            document.head.append(style);
        }

        rerender();
    },
};

setupTheme();
setupTooltip();
setupActions();
setupReader();
addEventListener("resize", measureTabs);
addEventListener("hashchange", () => {
    const button = document.getElementById(`tab-${location.hash.slice(1).split("/")[0]}`);

    if (button) {
        selectTab(button);
    }

    openAskedDocument();
    openAskedRelease();
});
load();
loadTidy();
setInterval(load, 15000);
setInterval(loadTidy, 4000);

/** The project's data read from the server, the live dot pulsing; the page drawn again when the data changed, unless a task is being
 * written. */
async function load()
{
    let fresh;

    try {
        fresh = await fetchJson("/data");
    } catch {
        return; // the server is restarting: the next poll tries again
    }

    const signature = JSON.stringify({ ...fresh, generated: null });
    const live = document.getElementById("live");
    live.classList.add("pulse");
    setTimeout(() => live.classList.remove("pulse"), 300);

    if (signature === lastData || editing !== null) {
        return;
    }

    lastData = signature;
    data = fresh;
    words = pageWords[data.language] ?? pageWords.en;
    loadExtensions(data.extensions ?? []);
    render();
    openAskedDocument();
    openAskedRelease();
}

/** The project read again and drawn, even when its data did not change: after a change from the page, or a check asked. */
function reload()
{
    lastData = "";
    return load();
}

/** Each extension's script for the page, loaded once. */
function loadExtensions(list)
{
    for (const { script } of list) {
        if (script && !loadedScripts.has(script)) {
            loadedScripts.add(script);
            const element = document.createElement("script");
            element.src = script;
            document.body.append(element);
        }
    }
}

/** The page drawn again with the data it has, once it has some: kit.rerender, for an extension. */
function rerender()
{
    if (data) {
        render();
    }
}

/** The page drawn from its data: the header, a tab for each part and for each extension's, the one the address asks for shown; the focus
 * kept where it was. */
function render()
{
    // A card being dragged would be lost under a page drawn again: the drawing waits for the drop.
    if (dragging) {
        renderWaits = true;
        return;
    }

    const { plan, decisions, documents, health } = data;
    const percent = ratio(plan.done, plan.total);
    const errors = health.filter((finding) => finding.severity === "error").length;
    const focus = focusAfter ?? focusedElement();
    const doing = (data.board ?? []).filter((task) => task.state === "doing").length;
    days = dayRange(data.activity.map((repo) => repo.days), decisions.byDay, plan.finishedByDay);
    // A tooltip of a mark drawn again would stay with what it said before.
    document.getElementById("tip").style.opacity = 0;
    renderChrome();

    const tabs = [
        { id: "overview", label: t("tabOverview"), badge: `${percent}%`, panel: overviewPanel },
        { id: "board", label: t("tabBoard"), badge: doing ? `${doing}` : "", panel: boardPanel },
        { id: "rhythm", label: t("tabRhythm"), badge: "", panel: rhythmPanel },
        { id: "decisions", label: t("tabDecisions"), badge: `${decisions.open.length}`, panel: decisionsPanel },
        // The specifications, where the project keeps them: how many are covered of all.
        ...(data.specs ? [{ id: "specs", label: t("tabSpecs"), badge: `${data.specs.counts.done}/${data.specs.counts.total}`, panel: specsPanel }] : []),
        { id: "tasks", label: t("tabTasks"), badge: `${(data.board ?? []).filter((task) => columnOf(task) !== "done").length}`, panel: tasksPanel },
        { id: "health", label: t("tabHealth"), badge: errors ? t("errorsBadge", errors) : "✓", panel: healthPanel },
        { id: "documents", label: t("tabDocuments"), badge: `${documents.length}`, panel: documentsPanel },
        // The versions, where the project releases.
        ...(data.releases ? [{ id: "releases", label: t("tabReleases"), badge: data.releases.list.length ? `v${data.releases.list[0].version}` : "", panel: releasesPanel }] : []),
    ];

    for (const extension of extensions) {
        for (const tab of extension.tabs ?? []) {
            const extra = data.extra?.[extension.id];
            const entry = {
                id: String(tab.id).replace(/[^\w-]/g, ""),
                label: guarded(extension, () => (typeof tab.label === "function" ? tab.label(extra, kit) : tab.label), tab.id),
                badge: extra?.error ? "!" : guarded(extension, () => (typeof tab.badge === "function" ? tab.badge(extra, kit) : tab.badge ?? ""), ""),
                panel: () => (extra?.error ? failure(extension, extra.error) : guarded(extension, () => tab.render(extra, kit, data), null, true)),
            };
            const after = tabs.findIndex((one) => one.id === tab.after);
            tabs.splice(after < 0 ? tabs.length : after + 1, 0, entry);
        }
    }

    // A tab by its id after the #; #documents/2 is the documents' tab with the third document open in the reader.
    const asked = location.hash.slice(1).split("/")[0];
    const active = tabs.some((tab) => tab.id === asked) ? asked : "overview";

    document.getElementById("tabs").innerHTML = tabs.map(({ id, label, badge }) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${id === active}" tabindex="${id === active ? 0 : -1}">${escape(label)}${badge ? `<span class="badge">${escape(badge)}</span>` : ""}</button>`).join("");
    document.getElementById("app").innerHTML = tabs.map(({ id, panel }) => `<div class="grid panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" ${id === active ? "" : "hidden"}>${panel()}</div>`).join("");

    requestAnimationFrame(() => {
        document.querySelectorAll("[data-width]").forEach((bar) => (bar.style.width = bar.dataset.width));
        document.querySelectorAll(".ring-arc").forEach((arc) => (arc.style.strokeDashoffset = arc.dataset.offset));
    });
    bindTabs();
    renderTidy();
    measureTabs();
    restoreFocus(focus);
    focusAfter = null;
    landed = null;

    for (const extension of extensions) {
        const extra = data.extra?.[extension.id];

        if (extension.mounted && !extra?.error) {
            guarded(extension, () => extension.mounted(extra, kit, data));
        }
    }
}

/** The header, the title and the labels that do not change with the data, in the page's language. */
function renderChrome()
{
    document.documentElement.lang = data.language ?? "en";
    document.title = t("title", data.project);
    document.getElementById("heading").innerHTML = `${escape(data.project)} <span>· ${escape(t("subtitle"))}</span>`;
    document.getElementById("meta").textContent = t("meta", formatDay(data.plan.updated), time(data.generated));
    document.getElementById("live-label").textContent = t("live");
    document.getElementById("theme").textContent = t("theme");
    document.getElementById("tabs").setAttribute("aria-label", t("tabsLabel"));
}

/** What an extension gives, or a card that says it failed: one extension never breaks the page. */
function guarded(extension, draw, fallback = "", asCard = false)
{
    try {
        return draw();
    } catch (error) {
        console.error(`Extension ${extension.id}:`, error);
        return asCard ? failure(extension, error?.message ?? error) : fallback;
    }
}

/** A card that says an extension could not draw, and why. */
function failure(extension, message)
{
    return `<section class="card span-12"><p class="hint" style="margin:0;color:var(--critical)">${escape(t("extensionFailed", extension.id, String(message)))}</p></section>`;
}

/** What the extensions add to a part of a tab, "tiles" or "rhythm", one after the other. */
function extensionParts(part)
{
    return extensions.map((extension) => {
        const extra = data.extra?.[extension.id];

        if (!extension[part] || extra?.error) {
            return "";
        }

        const drawn = guarded(extension, () => extension[part](extra, kit, data));

        return Array.isArray(drawn) ? drawn.join("") : drawn ?? "";
    }).join("");
}

/** The tabs' clicks and keys, as a tab list's: the arrows to the next or the one before, Home and End to the first and the last. */
function bindTabs()
{
    const buttons = [...document.querySelectorAll("#tabs [role=tab]")];

    buttons.forEach((button, index) => {
        button.addEventListener("click", () => selectTab(button));
        button.addEventListener("keydown", (event) => {
            const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];

            if (target !== undefined) {
                event.preventDefault();
                const next = buttons[(target + buttons.length) % buttons.length];
                selectTab(next);
                next.focus();
            }
        });
    });
}

/** Shows a tab's panel and hides the others; the address keeps the tab. */
function selectTab(button)
{
    for (const other of document.querySelectorAll("#tabs [role=tab]")) {
        const selected = other === button;
        other.setAttribute("aria-selected", selected);
        other.tabIndex = selected ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    }

    history.replaceState(null, "", `#${button.id.slice("tab-".length)}`);
    scrollTo({ top: 0 });
}

/** The tabs' height, under which the board's column names stay. */
function measureTabs()
{
    document.documentElement.style.setProperty("--tabs-height", `${document.getElementById("tabs").offsetHeight}px`);
}
