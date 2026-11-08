// The decisions, the specifications and the versions: the points to decide and every decision, with its search; the specs with their
// coverage, filter and search; what waits for the next version, and each version with its notes.

// How many decisions the list shows before «Show more»; the words searched and how many it shows now.
const decisionsShown = 50;
let decisionQuery = "";
let decisionLimit = decisionsShown;
// The specifications' tab: which coverage it shows and the words it looks for.
let specFilter = "all";
let specQuery = "";

/** The decisions' tab: the points to decide, as the panel orders them; every decision, who took how many, the numbering's gaps, and a
 * search. */
function decisionsPanel()
{
    const { decisions, prefixes } = data;
    const people = Object.entries(decisions.byPerson ?? {}).sort(([, first], [, second]) => second - first);
    const byPerson = people.length ? t("byPerson", people.map(([name, count]) => `${name} ${count}`).join(", ")) : "";
    const proposals = sortedProposals();

    return `<section class="card span-12">
            <h2>${t("openTitle")}</h2>
            <p class="hint">${t("proposalsHint", proposals.length)}</p>
            <ul class="rows">${proposals.map(proposalRow).join("") || `<li class="row proposal"><span></span><span class="hint">${t("openNone")}</span></li>`}</ul>
        </section>

        <section class="card span-12">
            <h2>${t("allTitle")}</h2>
            <p class="hint">${escape(byPerson)}${numberingNote(decisions, prefixes.decision)}</p>
            <div class="search">
                <label for="decision-search" class="visually-hidden">${t("searchLabel")}</label>
                <input type="search" id="decision-search" value="${attribute(decisionQuery)}" placeholder="${attribute(t("searchPlaceholder"))}" autocomplete="off" spellcheck="false">
                <p class="found" id="decision-found">${escape(foundLine(matchingDecisions().length))}</p>
            </div>
            <div id="decision-list">${decisionListBody()}</div>
        </section>`;
}

/** The proposals waiting, as the panel orders them: by priority, those without one last, then the oldest, then by their place. */
function sortedProposals()
{
    const rank = (proposal) => priorityRank[proposal.priority] ?? 4;

    return (data.decisions.proposals ?? []).slice().sort((first, second) => rank(first) - rank(second) || (first.day ?? "9999").localeCompare(second.day ?? "9999") || first.line - second.line);
}

/** A point to decide: who decides and its priority, its text, which opens, its age and its line in the file. */
function proposalRow(proposal)
{
    const id = `proposal-${proposal.line}`;
    const meta = [proposal.day ? `<span data-tip="${attribute(escape(formatDay(proposal.day)))}">${escape(age(proposal.day))}</span>` : "", `<span>${escape(t("lineAt", proposal.line))}</span>`];

    return `<li class="row proposal">
            <span class="who">${deciderFace()}${proposal.priority ? `<span class="prio" role="img" aria-label="${attribute(priorityName(proposal.priority))}">${priorityMark(proposal.priority)}</span>` : ""}</span>
            <div>${expandButton(id, escape(proposal.text))}<div class="row-meta">${meta.join("")}</div></div>
        </li>`;
}

/** The decisions that hold every word of the search, accents and case aside; all of them without one. */
function matchingDecisions()
{
    const terms = searchTerms(decisionQuery);
    const prefix = data.prefixes.decision;

    return data.decisions.all.filter((row) => {
        const text = folded(`${prefix}-${row.number} ${row.text} ${row.why ?? ""}`);
        return terms.every((term) => text.includes(term));
    });
}

/** The decisions the search keeps, as many as shown so far, and a button for the next hundred. */
function decisionListBody()
{
    const found = matchingDecisions();
    const terms = searchTerms(decisionQuery);
    const rest = found.length - decisionLimit;
    const rows = found.slice(0, decisionLimit).map((row) => decisionRow(row, terms)).join("");

    return `<ul class="rows">${rows || `<li class="row decision"><span></span><span class="hint">${t("decisionsNone")}</span></li>`}</ul>
        ${rest > 0 ? `<button type="button" class="more" id="decisions-more">${escape(t("showMore", Math.min(rest, 100), rest))}</button>` : ""}`;
}

/** A decision: who decided and its number, its text with the search's words marked, which opens on its reasons; its day and its tasks. */
function decisionRow(row, terms)
{
    const id = `decision-${row.number}`;
    const open = expanded.has(id);
    const why = open && row.why ? `<p class="why"><b>${t("why")}</b> ${marked(row.why, terms)}</p>` : "";
    const tasks = row.tasks?.length ? `<span><b>${escape(t("decisionTasks"))}</b> ${escape(row.tasks.join(", "))}</span>` : "";
    const day = row.day || tasks ? `<div class="row-meta">${row.day ? `<span>${escape(formatDay(row.day))}</span>` : ""}${tasks}</div>` : "";

    return `<li class="row decision">
            <span class="tag">${deciderFace()}${escape(data.prefixes.decision)}-${row.number}</span>
            <div>${expandButton(id, marked(row.text, terms))}${why}${day}</div>
        </li>`;
}

/** Who decides, as their face beside a decision or a point to decide: the owner, else the first person of the project who is not Claude;
 * nothing without one. */
function deciderFace()
{
    const decider = data.owner?.name ?? (data.people ?? []).find((person) => person !== claudeOf());
    return decider ? face({ to: decider }) : "";
}

/** How many decisions the search found, of all; how many there are without a search. */
function foundLine(count)
{
    const total = data.decisions.all.length;

    return decisionQuery.trim() ? t("decisionsFound", count, total) : t("decisionsCount", total);
}

/** The numbers of the decisions used twice, a warning, and those skipped. */
function numberingNote(decisions, prefix)
{
    const list = (numbers) => numbers.map((number) => `${prefix}-${number}`).join(", ");
    const warning = decisions.duplicates.length ? ` <span style="color:var(--critical)">⚠ ${escape(t("duplicates", list(decisions.duplicates)))}.</span>` : "";
    const gaps = decisions.missing.length ? ` ${escape(t("missing", list(decisions.missing)))}` : "";

    return warning + gaps;
}

/** The specifications: how far they are covered, in a bar; a filter by coverage and a search; each spec under its section and group,
 * with the tasks that do it and their state, the decisions that changed it, the code that names it, and a ＋ for a task that does it. */
function specsPanel()
{
    const { counts } = data.specs;
    const share = (count) => (counts.total ? (count / counts.total) * 100 : 0);
    const segment = (kind, count) => (count ? `<i class="spec-${kind}" style="width:${share(count)}%" data-tip="${attribute(escape(`${t(`specState_${kind}`)}: ${count}`))}"></i>` : "");
    const chip = (kind, count) => `<button type="button" id="spec-filter-${kind}" data-spec-filter="${kind}" aria-pressed="${specFilter === kind}">${escape(kind === "all" ? t("filterEvery") : t(`specState_${kind}`))} <span class="count">${count}</span></button>`;

    return `<section class="card span-12">
            <h2>${t("specsTitle")}</h2>
            <p class="hint">${escape(t("specsHint", counts))}</p>
            <div class="spec-bar" role="img" aria-label="${attribute(t("specsHint", counts))}">${segment("done", counts.done)}${segment("doing", counts.doing)}${segment("open", counts.open)}</div>
            <div class="chips" role="group" aria-label="${attribute(t("specsFilter"))}">${chip("all", counts.total)}${chip("open", counts.open)}${chip("doing", counts.doing)}${chip("done", counts.done)}</div>
            <div class="search">
                <label for="spec-search" class="visually-hidden">${t("searchLabel")}</label>
                <input type="search" id="spec-search" value="${attribute(specQuery)}" placeholder="${attribute(t("specsSearch"))}" autocomplete="off" spellcheck="false">
            </div>
            <div id="spec-list">${specListBody()}</div>
        </section>`;
}

/** A spec's text by its id, for the tip on a task's link; "" for one the project does not keep. */
function specText(id)
{
    return data.specs?.list.find((spec) => spec.id === id)?.text ?? "";
}

/** The specs the filter and the search keep, under their sections and groups, in the file's order. */
function specListBody()
{
    const terms = searchTerms(specQuery);
    const kept = data.specs.list.filter((spec) => (specFilter === "all" ? spec.state !== "dropped" : spec.state === specFilter)
        && terms.every((term) => folded(`${spec.id} ${spec.text} ${spec.section} ${spec.group}`).includes(term)));
    let html = "";
    let section = null;
    let group = null;

    for (const spec of kept) {
        if (spec.section !== section) {
            html += `${section === null ? "" : "</ul>"}<h3 class="spec-section">${escape(spec.section || t("specsNoSection"))}</h3><ul class="rows">`;
            section = spec.section;
            group = null;
        }

        if (spec.group && spec.group !== group) {
            html += `<li class="spec-group">${escape(spec.group)}</li>`;
            group = spec.group;
        }

        html += specRow(spec);
    }

    return kept.length ? `${html}</ul>` : `<p class="hint">${escape(t("specsNone"))}</p>`;
}

/** A spec: its number and text; the tasks that do it, each a link to it in the list, the decisions that changed it, the code that names
 * it; its coverage, and a ＋ for a new task that does it. */
function specRow(spec)
{
    const tasks = spec.tasks.map((task) => `<button type="button" class="link-button" data-go-task="${attribute(task.id)}" data-tip="${attribute(escape(task.text))}">${escape(task.id)} · ${escape(stateName(task.state))}</button>`);
    const code = spec.files.slice(0, 3).map((file) => `<code>${escape(file.file)}:${file.line}</code>`);
    const more = spec.files.length > 3 ? `<span class="hint" data-tip="${attribute(spec.files.slice(3).map((file) => `${escape(file.file)}:${file.line}`).join("<br>"))}">+${spec.files.length - 3}</span>` : "";
    const links = [
        tasks.length ? `<span><b>${escape(t("specTasks"))}</b> ${tasks.join(" ")}</span>` : "",
        spec.decisions.length ? `<span><b>${escape(t("linkDecisions"))}</b> ${escape(spec.decisions.join(", "))}</span>` : "",
        code.length ? `<span><b>${escape(t("specCode"))}</b> ${code.join(" ")}${more}</span>` : "",
    ].filter(Boolean);

    return `<li class="row spec" id="spec-${spec.number}">
            <span class="spec-id">${escape(spec.id)}</span>
            <div><div class="spec-text">${inline(spec.text)}</div>${links.length ? `<div class="task-links">${links.join("")}</div>` : ""}</div>
            <span class="spec-state ${spec.state}">${escape(t(`specState_${spec.state}`))}</span>
            ${spec.state === "dropped" ? "<span></span>" : `<button type="button" class="action small" data-new-spec-task="${attribute(spec.id)}" aria-label="${attribute(t("specNewTask", spec.id))}" data-tip="${attribute(escape(t("specNewTask", spec.id)))}">＋</button>`}
        </li>`;
}

/** The specs' list drawn again for a filter or a search, the focus where it was. */
function refreshSpecs(focusId)
{
    document.getElementById("spec-list").innerHTML = specListBody();
    document.querySelectorAll("[data-spec-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.specFilter === specFilter)));

    if (focusId) {
        document.getElementById(focusId)?.focus();
    }
}

/** The releases: what waits for the next one and why one is due, then each version, the newest first, with its notes. */
function releasesPanel()
{
    const { list = [], pending = [], counts = {}, suggested = {}, closedGoals = [], urgent = [], raised = [], contracts = [] } = data.releases ?? {};
    const due = closedGoals.length ? t("releaseDueGoals", closedGoals.join(", ")) : urgent.length ? t("releaseDueFix", urgent.join(", ")) : raised.length ? t("releaseDueContract", raised.join(", ")) : t("releaseJudge");
    // The contracts that moved since the last release, or that do not read.
    const moved = contracts.length ? `<ul class="list">${contracts.map((contract) => `<li>${escape(contract.name)}: ${escape(contract.state === "unread" ? t("contractUnreadShort") : contract.before ? `${contract.before} → ${contract.current}` : contract.current)}</li>`).join("")}</ul>` : "";
    const waiting = pending.length || raised.length
        ? `<p>${escape(t("releasePending", pending.length, counts))} ${escape(t("releaseSuggested", suggested.version))}</p>
            <p class="hint">${escape(due)}</p>${moved}
            <ul class="list">${pending.map((task) => `<li><span class="id">${escape(taskName(task))}</span> ${escape(task.text)}</li>`).join("")}</ul>`
        : `<p class="hint">${escape(t("releaseNothing"))}</p>`;
    const notes = (release) => markdown(withoutFrontmatter(release.text).replace(/^#[^\n]*\n/, ""));

    return `<section class="card span-12">
            <h2>${t("releaseNextTitle")}</h2>
            ${waiting}
        </section>

        <section class="card span-12">
            <h2>${t("releasesTitle")}</h2>
            <p class="hint">${escape(t("releasesHint"))}</p>
            ${list.map((release, index) => `<details class="section release" id="release-${attribute(release.version)}" ${index === 0 ? "open" : ""}>
                <summary><div class="title"><b>v${escape(release.version)}</b> <span class="hint">${escape(release.day ? formatDay(release.day) : "")}</span>${release.summary ? ` · ${escape(release.summary)}` : ""}</div><div></div><div class="count"></div><div class="pct">${escape(release.tagOnly ? t("releaseTagOnlyShort") : t("releaseTasks", release.count))}</div></summary>
                <div class="release-notes">${release.tagOnly ? `<p class="hint">${escape(t("releaseTagOnly", release.source))}</p>${release.text ? `<pre class="release-message">${escape(release.text)}</pre>` : ""}` : notes(release)}</div>
            </details>`).join("") || `<p class="hint">${escape(t("releasesNone"))}</p>`}
        </section>`;
}

/** The release the address asks for, #releases/0.8.0 (the panel's links), opened and brought into view once. */
function openAskedRelease()
{
    const asked = /^#releases\/v?([\d.]+)$/.exec(location.hash);
    const release = asked ? document.getElementById(`release-${asked[1]}`) : null;

    if (release) {
        history.replaceState(null, "", "#releases");
        release.open = true;
        release.scrollIntoView({ block: "start" });
    }
}
