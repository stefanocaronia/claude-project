// The health tab: the cleanup, its mechanical fixes and the runs of Claude Code that propose and apply; then the check's findings by kind.

// The cleanup's state, as the server last gave it.
let tidyData = null;

/** The health tab: the cleanup's card, which renderTidy fills, and the check's errors, warnings and notes, counted and by kind. */
function healthPanel()
{
    const { health } = data;
    const count = (severity) => health.filter((finding) => finding.severity === severity).length;

    return `<section class="card span-12">
            <h2>${t("tidyTitle")}</h2>
            <p class="hint">${t("tidyHint")}</p>
            <div id="tidy"></div>
        </section>

        <section class="card span-12">
            <h2>${t("healthTitle")}</h2>
            <p class="hint">${t("healthHint")}</p>
            <div class="tiles" style="margin-bottom:18px">
                ${tile(t("healthErrors"), count("error"), t("healthErrorsSub"))}
                ${tile(t("healthWarnings"), count("warning"), t("healthWarningsSub"))}
                ${tile(t("healthNotes"), count("note"), t("healthNotesSub"))}
            </div>
            ${healthGroups(health)}
        </section>`;
}

/** The check's findings, a section for each kind, at most 60 shown in each. */
function healthGroups(health)
{
    const kinds = [...new Set(health.map((finding) => finding.kind))];
    const marks = { error: ["var(--critical)", "✕"], warning: ["var(--warning)", "!"], note: ["var(--muted)", "·"] };
    const names = t("healthKinds");

    return kinds.map((kind) => {
        const group = health.filter((finding) => finding.kind === kind);
        const items = group.slice(0, 60).map((finding) => `<li><span style="color:${marks[finding.severity][0]};font-weight:700;display:inline-block;width:16px">${marks[finding.severity][1]}</span>${finding.file ? `<code>${escape(finding.file)}${finding.line ? `:${finding.line}` : ""}</code> ` : ""}${escape(finding.message)}</li>`).join("");
        const more = group.length > 60 ? `<li>${escape(t("healthMore", group.length - 60))}</li>` : "";

        return `<details class="section"><summary><div class="title"><b>${escape(names[kind] ?? kind)}</b></div><div></div><div class="count"></div><div class="pct">${group.length}</div></summary><ul class="list" style="margin:0 6px 12px">${items}${more}</ul></details>`;
    }).join("");
}

/** The cleanup's state read again from the server, and its card drawn. */
async function loadTidy()
{
    try {
        tidyData = await fetchJson("/tidy");
        renderTidy();
    } catch {
        // the server is restarting: the next poll tries again
    }
}

/** The cleanup's card: its buttons, the last run and what it did, the proposals to tick, kept ticked across a drawing, and those that
 * wait. */
function renderTidy()
{
    const box = document.getElementById("tidy");

    if (!box || !tidyData) {
        return;
    }

    const checked = new Set([...box.querySelectorAll("input[data-proposal]:checked")].map((input) => input.dataset.proposal));
    const { whitespace, undated, run, proposals = [], applied, running, lastTokens } = tidyData;
    const undatedCount = undated.reduce((sum, entry) => sum + entry.count, 0);
    const interrupted = run?.state === "running" && !running;
    const usage = run ? `${run.tokens ? ` · ${t("tidyTokens", Math.round(run.tokens / 1000))}` : ""}${run.cost ? `, ${t("tidyCost", run.cost.toFixed(2))}` : ""}` : "";
    const runLine = !run ? "" : running ? `<p class="hint"><span class="state starting" style="display:inline-block;margin-right:8px"></span>${escape(t("tidyRunning", run.kind, time(run.started)))}</p>`
        : interrupted ? `<p class="hint" style="color:var(--critical)">${escape(t("tidyInterrupted", time(run.started)))}</p>`
        : run.state === "failed" ? `<p class="hint" style="color:var(--critical)">${escape(t("tidyFailed", time(run.started), run.message))}</p>`
        : `<p class="hint">${escape(t("tidyLast", run.kind, time(run.finished)))}${run.kind === "apply" && applied ? "" : `: ${escape(run.message)}`}${escape(usage)}.</p>`;
    const harmless = run?.state === "done" && (run.kind === "propose" || applied?.applied.length > 0);
    const denials = run?.denials?.length
        ? `<p class="hint" ${harmless ? "" : 'style="color:var(--critical)"'}>${t(harmless ? "tidyHarmless" : "tidyDenied")}: ${run.denials.map((denial) => `<code>${escape(denial)}</code>`).join(", ")}.</p>`
        : "";
    const skipped = applied?.skipped.length ? t("tidySkipped", applied.skipped.length, applied.skipped.map((skip) => `${skip.id}: ${skip.why}`).join("; ")) : "";
    const appliedLine = denials + (applied ? `<p class="hint"><b>${t("tidyApplied")}</b> ${applied.applied.length}${escape(skipped)}. ${escape(applied.summary)}</p>` : "");
    const waiting = proposals.filter((proposal) => proposal.waits);
    const ready = proposals.filter((proposal) => !proposal.waits);
    const where = (proposal) => `<code>${escape(proposal.file)}${proposal.line ? `:${escape(proposal.line)}` : ""}</code>`;
    const waitingList = waiting.map((proposal) => `<li><b>${escape(proposal.title)}</b> <span class="badge">${escape(t("tidyWaits", proposal.waits))}</span><br>
            ${where(proposal)} · ${escape(proposal.why)}</li>`).join("");
    const list = ready.map((proposal) => `<li class="proposal">
            <label><input type="checkbox" data-proposal="${attribute(proposal.id)}" ${checked.has(proposal.id) ? "checked" : ""} ${running ? "disabled" : ""}>
            <span><b>${escape(proposal.title)}</b> <span class="badge">${escape(t("proposalKinds")[proposal.kind] ?? proposal.kind)}</span><br>
            ${where(proposal)} · ${escape(proposal.why)}<br>
            <span style="color:var(--ink)">${t("tidyChange")} ${escape(proposal.change)}</span></span></label>
        </li>`).join("");
    const cost = lastTokens ? t("tidyCostLast", Math.round(lastTokens / 1000)) : t("tidyCostUsual");

    box.innerHTML = `<div class="actions" style="flex-wrap:wrap;margin-bottom:14px">
            <button type="button" class="action" data-tidy="check">${t("tidyCheck")}</button>
            <button type="button" class="action" data-tidy="whitespace" ${whitespace.length ? "" : "disabled"}>${escape(t("tidyWhitespace", whitespace.length))}</button>
            <button type="button" class="action" data-tidy="dates" ${undatedCount ? "" : "disabled"}>${escape(t("tidyDates", undatedCount))}</button>
            <button type="button" class="action primary" data-tidy="propose" ${running ? "disabled" : ""}>${t("tidyPropose")}</button>
            <button type="button" class="action" data-tidy="backlog" ${running ? "disabled" : ""}>${t("tidyBacklog")}</button>
        </div>
        ${runLine}${appliedLine}
        ${ready.length ? `<ul class="list proposals">${list}</ul>
            <div class="actions" style="margin-top:12px"><button type="button" class="action primary" data-tidy="apply" ${running ? "disabled" : ""}>${t("tidyApply")}</button><button type="button" class="action" data-tidy="all" ${running ? "disabled" : ""}>${t("tidyAll")}</button></div>` : proposals.length ? `<p class="hint">${t("tidyNothingReady")}</p>` : ""}
        ${waiting.length ? `<h3 class="waiting-title">${t("tidyWaitingTitle")}</h3><p class="hint">${t("tidyWaitingHint")}</p><ul class="list">${waitingList}</ul>` : ""}`;

    box.querySelectorAll("[data-tidy]").forEach((button) => button.addEventListener("click", () => tidyAction(button.dataset.tidy, { whitespace, undated, cost })));
}

/** A button of the cleanup: the check read again, every proposal ticked, or, once confirmed, a fix, a run that proposes or one that
 * applies the proposals ticked; then the cleanup and the project read again. */
async function tidyAction(action, preview)
{
    if (action === "check") {
        await reload();
        return;
    }

    if (action === "all") {
        document.querySelectorAll("input[data-proposal]").forEach((input) => (input.checked = true));
        return;
    }

    if (action === "whitespace" && confirm(t("tidyConfirmWhitespace", preview.whitespace.join("\n")))) {
        await post("/tidy/fix/whitespace");
    } else if (action === "dates" && confirm(t("tidyConfirmDates", preview.undated.map((entry) => `${entry.file}: ${entry.count}`).join("\n")))) {
        await post("/tidy/fix/dates");
    } else if (action === "propose" && confirm(t("tidyConfirmPropose", preview.cost))) {
        await post("/tidy/propose");
    } else if (action === "backlog" && confirm(t("tidyConfirmBacklog", preview.cost))) {
        await post("/tidy/propose?scope=backlog");
    } else if (action === "apply") {
        const ids = [...document.querySelectorAll("input[data-proposal]:checked")].map((input) => input.dataset.proposal);

        if (ids.length === 0) {
            alert(t("tidyTickFirst"));
        } else if (confirm(t("tidyConfirmApply", ids.length, ids.join(", ")))) {
            await post("/tidy/apply", { ids });
        }
    }

    await loadTidy();
    await reload();
}
