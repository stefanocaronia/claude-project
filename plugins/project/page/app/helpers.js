// The page's helpers, which its other scripts and the extensions use: its words, escaping, days and numbers, the search's folding and
// marks, the calls to its server, the focus and what a screen reader hears, a text that opens; the charts and tiles the tabs draw with;
// the theme and the tooltip.

// The page's words, in its language once the data says it (words.js).
let words = pageWords.en;
// The colors a colleague's profile names, as the page draws them.
const colors = { blue: "#3987e5", red: "#e34948", green: "#1baf7a", yellow: "#eda100", purple: "#6250d6", cyan: "#0fa3b1", orange: "#eb6834", pink: "#e87ba4", gray: "#898781" };
// The texts opened by hand, by their button's id: a task's on the board or in the list, a decision, a proposal.
const expanded = new Set();
// What a screen reader is told after a quick run of changes, once it ends.
let announceTimer = 0;

/** A word of the page in its language, English when the language lacks it; a word that is a function is called with the values. */
function t(key, ...values)
{
    const word = words[key] ?? pageWords.en[key] ?? key;

    return typeof word === "function" ? word(...values) : word;
}

/** A text made safe in HTML, in an element or an attribute's quotes. */
function escape(text)
{
    return String(text ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

/** HTML for a data-tip attribute, whose text the tooltip shows as HTML. */
function attribute(html)
{
    return String(html ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Whether an address from the data is one a link may open: a page on the web, or one of this page's own; never javascript: or data:. */
function webUrl(href)
{
    return /^(https?:\/\/|\/(?!\/))/i.test(String(href ?? ""));
}

/** A day, YYYY-MM-DD, as «29 Oct» in the page's language; «—» without one. */
function formatDay(day)
{
    if (!day) {
        return "—";
    }

    const [, month, date] = day.split("-").map(Number);

    return `${date} ${t("monthsShort")[month - 1]}`;
}

/** A moment as its hour and minutes in the page's language; «—» without one. */
function time(iso)
{
    return iso ? new Date(iso).toLocaleTimeString(t("locale"), { hour: "2-digit", minute: "2-digit" }) : "—";
}

/** How long ago a moment was, in minutes, hours or days. */
function relative(iso)
{
    const minutes = Math.round((Date.now() - new Date(iso)) / 60000);

    if (minutes < 60) {
        return t("minutesAgo", Math.max(0, minutes));
    }

    if (minutes < 48 * 60) {
        return t("hoursAgo", Math.round(minutes / 60));
    }

    return t("daysAgo", Math.round(minutes / 1440));
}

/** Today, or so many days from it, as YYYY-MM-DD in the local calendar. */
function dayIso(offset)
{
    const day = new Date();
    day.setDate(day.getDate() + offset);

    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** How old a day is, «3 d», as the panel says it. */
function age(day)
{
    return day ? t("ageDays", Math.max(0, Math.round((Date.parse(dayIso(0)) - Date.parse(day)) / 86400000))) : "";
}

/** Every day from the first one any of the value maps has to today, the axis all the day charts share. */
function dayRange(...maps)
{
    const all = maps.flat().flatMap((values) => Object.keys(values ?? {})).sort();
    const range = [];
    const end = new Date();

    for (let day = new Date(`${all[0] ?? new Date().toISOString().slice(0, 10)}T12:00:00`); day <= end; day.setDate(day.getDate() + 1)) {
        range.push(day.toISOString().slice(0, 10));
    }

    return range;
}

/** The sum of a day map's values over the last so many days. */
function sumSince(values, count)
{
    const since = new Date(Date.now() - count * 86400000).toISOString().slice(0, 10);

    return Object.entries(values).filter(([day]) => day > since).reduce((sum, [, value]) => sum + value, 0);
}

/** A round top for a chart's axis, at or above its largest value. */
function niceMax(value)
{
    const step = 10 ** Math.floor(Math.log10(value));

    return [1, 1.5, 2, 2.5, 5, 10].map((factor) => factor * step).find((candidate) => candidate >= value) ?? value;
}

/** A share as a whole percent; 0 of nothing. */
function ratio(done, total)
{
    return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** The words of a search, folded. */
function searchTerms(query)
{
    return folded(query).split(/\s+/).filter(Boolean);
}

/** A text for searching: lower case, without accents. */
function folded(text)
{
    return String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A text, escaped, with the search's words marked where they appear, accents and case aside. */
function marked(text, terms)
{
    if (terms.length === 0) {
        return escape(text);
    }

    // Folding keeps one character a letter, so a place in the folded text is the same place in the text.
    const letters = [...String(text)];
    const plain = letters.map((letter) => folded(letter));
    const hits = new Array(letters.length).fill(false);

    for (const term of terms) {
        const whole = plain.join("");
        let from = whole.indexOf(term);

        while (from >= 0) {
            let at = 0;

            for (let index = 0; index < letters.length; index++) {
                if (at >= from && at < from + term.length) {
                    hits[index] = true;
                }

                at += plain[index].length;
            }

            from = whole.indexOf(term, from + term.length);
        }
    }

    return letters.map((letter, index) => {
        const open = hits[index] && !hits[index - 1] ? "<mark>" : "";
        const close = hits[index] && !hits[index + 1] ? "</mark>" : "";
        return `${open}${escape(letter)}${close}`;
    }).join("");
}

/** GET a JSON answer of the page's server; it throws when the server does not answer well. */
async function fetchJson(path)
{
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(`${path}: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

/** POST to the page's server; the JSON answer, or null. A refusal other than "busy" (409) is shown to the user. */
async function post(path, payload)
{
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
    const text = await response.text();

    if (!response.ok && response.status !== 409) {
        alert(t("failed", text));
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** Says a change to a screen reader; with a delay, only the last of a quick run is said. */
function announce(text, delay = 0)
{
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
        document.getElementById("announce").textContent = text;
    }, delay);
}

/** The element that has the focus, by its id, with the caret of a field; null when nothing of the page's has it. */
function focusedElement()
{
    const element = document.activeElement;

    if (!element?.id || !element.closest?.("#app, #tabs")) {
        return null;
    }

    return { id: element.id, start: element.selectionStart ?? null, end: element.selectionEnd ?? null };
}

/** The focus given back to an element drawn again, with its caret; scrolled to it when asked. */
function restoreFocus(focus)
{
    const element = focus && document.getElementById(focus.id);

    if (!element) {
        return;
    }

    element.focus({ preventScroll: !focus.scroll });

    if (focus.start !== null && focus.start !== undefined && element.setSelectionRange) {
        element.setSelectionRange(focus.start, focus.end);
    }

    if (focus.scroll) {
        element.scrollIntoView({ block: "nearest" });
    }
}

/** A text that opens and closes itself: clamped to a few lines, whole once pressed. */
function expandButton(id, html)
{
    return `<button type="button" class="task-text" id="${id}" data-expand="${id}" aria-expanded="${expanded.has(id)}">${html}</button>`;
}

/** The overview's ring: how much of the plan is done, its arc drawn in once the page is. */
function ring(percent, caption)
{
    const radius = 84;
    const length = 2 * Math.PI * radius;

    return `<div class="ring-wrap" role="img" aria-label="${attribute(t("ringLabel", percent))}">
        <svg viewBox="0 0 196 196" width="196" height="196">
            <circle cx="98" cy="98" r="${radius}" fill="none" stroke="var(--grid)" stroke-width="14"/>
            <circle class="ring-arc" cx="98" cy="98" r="${radius}" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round"
                transform="rotate(-90 98 98)" stroke-dasharray="${length}" stroke-dashoffset="${length}" data-offset="${length * (1 - percent / 100)}"/>
        </svg>
        <div class="value"><b>${percent}%</b><small>${escape(caption)}</small></div>
    </div>`;
}

/** A number with its label above and a line below, as the overview's tiles. */
function tile(label, number, sub)
{
    return `<div class="tile"><div class="label">${escape(label)}</div><div class="number">${escape(number)}</div><div class="sub">${escape(sub)}</div></div>`;
}

/** A plain progress bar, done or not: the extensions' (kit.progressBar). */
function progressBar(percent, complete)
{
    return `<div class="bar ${complete ? "done" : ""}"><i data-width="${percent}%"></i></div>`;
}

/** A progress bar that says its numbers to a screen reader; kind is "done", "doing" or nothing. */
function bar(percent, kind, label)
{
    return `<div class="bar ${kind}" role="img" aria-label="${attribute(label)}"><i data-width="${percent}%"></i></div>`;
}

/** Stacked day bars on one shared axis: series are { name, color, values: { "YYYY-MM-DD": n } }. */
function dayBars(days, series, height)
{
    const width = 520;
    const left = 28;
    const bottom = 20;
    const plotHeight = height - bottom - 6;
    const totals = days.map((day) => series.reduce((sum, one) => sum + (one.values[day] ?? 0), 0));
    const top = niceMax(Math.max(1, ...totals));
    const slot = (width - left) / Math.max(1, days.length);
    const barWidth = Math.max(3, slot - 3);
    const y = (value) => 6 + plotHeight - (value / top) * plotHeight;
    let marks = "";

    days.forEach((day, index) => {
        let base = 0;
        const x = left + index * slot + (slot - barWidth) / 2;
        const lines = series.map((one) => `${escape(one.name)}: ${one.values[day] ?? 0}`).join("<br>");

        for (const [position, one] of series.entries()) {
            const value = one.values[day] ?? 0;

            if (value === 0) {
                continue;
            }

            const y1 = y(base + value);
            const y0 = y(base);
            const gap = position > 0 ? 2 : 0;
            marks += `<rect x="${x}" y="${y1}" width="${barWidth}" height="${Math.max(1, y0 - y1 - gap)}" rx="${Math.min(3, barWidth / 2)}" fill="${one.color}"/>`;
            base += value;
        }

        marks += `<rect x="${left + index * slot}" y="0" width="${slot}" height="${height - bottom}" fill="transparent" data-tip="${attribute(`<b>${formatDay(day)}</b>${lines}`)}"/>`;
    });

    const ticks = [0, top / 2, top].map((value) => `<line x1="${left}" x2="${width}" y1="${y(value)}" y2="${y(value)}" stroke="var(--grid)"/><text x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join("");
    const labels = days.map((day, index) => (index % 7 === 0 ? `<text x="${left + index * slot + slot / 2}" y="${height - 4}" text-anchor="middle">${formatDay(day)}</text>` : "")).join("");
    const names = series.map((one) => one.name).join(` ${t("and")} `);

    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${attribute(t("perDay", names))}">${ticks}<line x1="${left}" x2="${width}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>${marks}${labels}</svg>`;
}

/** The light or dark theme the user last chose, else the system's; the header's button turns it. */
function setupTheme()
{
    const root = document.documentElement;
    let saved = null;

    try {
        saved = localStorage.getItem("theme");
    } catch {
        // no storage here: the system's theme
    }

    if (saved) {
        root.dataset.theme = saved;
    }

    document.getElementById("theme").addEventListener("click", () => {
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        const next = dark ? "light" : "dark";
        root.dataset.theme = next;

        try {
            localStorage.setItem("theme", next);
        } catch {
            // the choice lasts only this visit
        }
    });
}

/** The page's one tooltip: the data-tip of what the pointer is over, as HTML, beside it. */
function setupTooltip()
{
    const tip = document.getElementById("tip");

    document.addEventListener("mousemove", (event) => {
        const target = event.target.closest?.("[data-tip]");

        if (!target) {
            tip.style.opacity = 0;
            return;
        }

        tip.innerHTML = target.dataset.tip;
        tip.style.opacity = 1;
        const x = Math.min(event.clientX + 14, innerWidth - tip.offsetWidth - 8);
        const y = event.clientY + 16 + tip.offsetHeight > innerHeight ? event.clientY - tip.offsetHeight - 10 : event.clientY + 16;
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
    });
}
