// The panel's sections besides the tasks and the goals: the extensions' links and the key documents, the GitHub issues, the points to
// decide, the specifications and the versions.
import type { EngineInterface } from "claude-code";

import type { Proposal, Snapshot } from "../types";

import { lineTitle } from "../lib/issues.mjs";
import { chipHover, decisionColor, errorColor, scales, stateLayer, versionMark, warningColor } from "./draw.ts";
import type { Panel } from "./kit.tsx";
import { backlog, postLink } from "./project.ts";
import { submit } from "./start.ts";

// How much of a point to decide its card shows; the page has the rest.
const proposalLength = 400;

/** The extensions' links, a page to open or an action to post, and the key documents, each opened through the project's page: chips
 * one line high, with no border, a stronger gray under the pointer. */
export function linkSections($: EngineInterface, p: Panel)
{
    const { Box, Text, Button, Link, isDesktop, snapshot, words, section } = p;
    const chips = (key: string, name: string, icon: string, title: string, items: JSX.Element[]) => (items.length > 0
        ? section(key, icon, title, [
            <Box key={`${key}-row`} flexDirection="row" flexWrap="wrap" gap={1}>
                {items.map((item, index) => <Box key={`${name}-box-${index}`} paddingX={1} {...(isDesktop ? { backgroundColor: stateLayer, hover: { backgroundColor: chipHover } } : {})}>{item}</Box>)}
            </Box>,
        ])
        : null);
    return [
        chips("links", "link", "↗", words("sectionLinks"), (snapshot.links ?? []).map((link, index) => (link.href
            ? <Link key={`link-${index}`} href={link.href}>{link.label}</Link>
            : <Button key={`link-${index}`} plain label={link.label} onPress={() => postLink($, link.post ?? "")} />))),
        chips("documents", "document", "📄", words("sectionDocuments"), (snapshot.documents ?? []).map((document, index) => (document.exists
            ? <Link key={`document-${index}`} href={document.href}>{document.name}</Link>
            : <Text key={`document-${index}`} dimColor>{document.name}</Text>))),
    ];
}

/** The open GitHub issues no task does yet, each taken into the backlog with a press, and where they are in sync with the backlog: the
 * last sync, or its error in red; the tasks whose issue is gone; the titles others gave their issues on GitHub, which the task takes, or
 * refuses, only on the user's yes here (D-16). None where there are no issues and no sync. */
export function issueSection($: EngineInterface, p: Panel)
{
    const { Box, Text, Button, Link, snapshot, words, section, card, limited, more } = p;
    const issues = snapshot.issues ?? [];
    const sync = snapshot.issuesSync;

    if (issues.length === 0 && !sync) {
        return null;
    }

    return section("issues", "◉", `${words("sectionIssues")} · ${issues.length}`, [
        ...(sync
            ? [
                sync.error
                    ? <Text key="issues-sync" color={errorColor} wrap="truncate-end">{`⚠ ${words("issuesSyncBroken", { at: sync.at ?? "", error: sync.error })}`}</Text>
                    : <Text key="issues-sync" dimColor>{`⇅ ${sync.at ? words("issuesSynced", { at: sync.at }) : words("issuesSyncNever")}`}</Text>,
                sync.missing.length > 0
                    ? <Text key="issues-missing" color={warningColor}>{`⚠ ${words("issuesSyncMissing", { list: sync.missing.map((one) => `${one.id} (${one.issue})`).join(", ") })}`}</Text>
                    : null,
                ...(sync.held ?? []).map((one) => card(`issues-held-${one.issue}`, [
                    <Text key={`issues-held-text-${one.issue}`} color={warningColor}>{`⚠ ${words("issueTitleHeld", one)}`}</Text>,
                    <Box key={`issues-held-buttons-${one.issue}`} flexDirection="row" gap={2}>
                        <Button key={`issues-held-take-${one.issue}`} plain dimColor label={words("titleTake")} onPress={() => backlog($, ["set", one.id, `--text=${one.title}`])} />
                        <Button key={`issues-held-keep-${one.issue}`} plain dimColor label={words("titleKeep")} onPress={() => backlog($, ["keep-title", one.issue.replace(/^#/, "")], "issues")} />
                    </Box>,
                ])),
            ]
            : []),
        issues.length > 0 ? <Text key="issues-hint" dimColor>{words("issuesHint")}</Text> : null,
        issues.some((issue) => issue.instruction) ? <Text key="issues-instruction" color={warningColor}>{words("issuesInstruction")}</Text> : null,
        // → Backlog is the user's yes to an issue, another's too (--approved, which Claude never gives); its title one line of text, after
        // a lone --.
        ...limited("issues", issues).map((issue) => card(`issue-${issue.number}`, [
            <Box key={`issue-row-${issue.number}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                {issue.instruction ? <Text key={`issue-instruction-${issue.number}`} color={warningColor}>⚠</Text> : null}
                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    {issue.url ? <Link href={issue.url}>{`#${issue.number} ${issue.title}`}</Link> : <Text wrap="truncate-end">{`#${issue.number} ${issue.title}`}</Text>}
                </Box>
                <Button key={`issue-take-${issue.number}`} plain dimColor label={words("issueToBacklog")} onPress={() => backlog($, ["add", `--issue=${issue.number}`, "--approved", "--", lineTitle(issue.title)])} />
            </Box>,
        ])),
        more("issues", issues.length, "showAllTasks"),
    ]);
}

/** The points to decide, ordered as the tasks are: by priority, those without one last, then the oldest (a point without a day by its
 * place in the file, the earlier first). */
export function proposalsOf(snapshot: Snapshot): Proposal[]
{
    const rank = (proposal: Proposal) => (proposal.priority ? Number(proposal.priority.slice(1)) : 4);
    return snapshot.decisions.open.slice().sort((first, second) => rank(first) - rank(second) || (first.day ?? "9999").localeCompare(second.day ?? "9999") || first.line - second.line);
}

/** A point to decide brought to the chat as a choice. */
export function askChoice($: EngineInterface, p: Panel, proposal: Proposal): Promise<void>
{
    return submit($, p.words("promptChoice", { line: proposal.line, text: proposal.whole }));
}

/** The points to decide, each with who decides, opened in place and brought to the chat as a choice; the decisions taken are the page's. */
export function decisionSection($: EngineInterface, p: Panel, proposals: Proposal[])
{
    const { Box, Text, Button, Link, Svg, view, snapshot, words, decider, opener, card, section, limited, more, age, face, priorityIcon } = p;
    const proposalRow = (proposal: Proposal) => {
        const key = `proposal-${proposal.line}`;
        const cut = proposal.text.length > proposalLength ? `${proposal.text.slice(0, proposalLength)}…` : proposal.text;
        return card(key, [
            <Box key={`proposal-row-${proposal.line}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                {decider ? face(decider, 24) : null}
                <Box flexShrink={0}><Text color={decisionColor}>{scales}</Text></Box>
                {proposal.priority && Svg ? priorityIcon(proposal.priority) : null}
                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    {opener(`open-${key}`, key, proposal.text)}
                </Box>
                <Box flexShrink={0}><Text dimColor wrap="truncate">{age(proposal.day)}</Text></Box>
            </Box>,
            view.expanded === key
                ? (
                    <Box key={`proposal-details-${proposal.line}`} flexDirection="column" gap={1} paddingLeft={2}>
                        <Text>{cut}</Text>
                        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
                            <Button key={`choice-${key}`} plain label={words("asChoice")} onPress={() => askChoice($, p, proposal)} />
                            {cut !== proposal.text ? <Link key={`page-${key}`} href={`${snapshot.page}/#decisions`}>{words("continueInPage")}</Link> : null}
                        </Box>
                    </Box>
                )
                : null,
        ]);
    };

    return section("decisions", scales, `${words("toDecide")} · ${proposals.length}`, [
        ...(proposals.length === 0 ? [<Text key="none-open" dimColor>{words("noneOpen")}</Text>] : limited("open", proposals).map(proposalRow)),
        more("open", proposals.length, "showAllDecisions"),
    ]);
}

/** The specifications, where the project keeps them: how far they are covered, those open tasks are doing, each a link to its row in the
 * page, and all of them there. */
export function specSection(p: Panel)
{
    const { Box, Text, Link, snapshot, words, section } = p;
    const specs = snapshot.specs;

    if (!specs) {
        return null;
    }

    return section("specs", "▤", `${words("sectionSpecs")} · ${specs.done}/${specs.total}`, [
        <Text key="specs-counts" dimColor>{words("specsCounts", specs)}</Text>,
        ...specs.inProgress.slice(0, 5).map((spec) => (
            <Box key={`spec-${spec.id}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                <Box flexShrink={0}><Link key={`spec-link-${spec.id}`} href={`${snapshot.page}/#specs`}>{spec.id}</Link></Box>
                <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden"><Text wrap="truncate-end">{spec.text}</Text></Box>
                <Box flexShrink={0}><Text dimColor>{spec.tasks.join(", ")}</Text></Box>
            </Box>
        )),
        <Link key="specs-all" href={`${snapshot.page}/#specs`}>{words("specsAll", { count: specs.total })}</Link>,
    ]);
}

/** The versions, the repo's tags, the newest first, each opening its notes in the page; what waits for the next, and the contracts that
 * moved since the last; the whole history in the page when there are more. */
export function releaseSection(p: Panel)
{
    const { Box, Text, Link, snapshot, words, section } = p;
    const releases = snapshot.releases;

    if (!releases) {
        return null;
    }

    return section("releases", versionMark, `${words("sectionReleases")} · ${releases.total ?? releases.list.length}`, [
        <Text key="releases-pending" dimColor>
            {releases.pending > 0 ? words("releasesPending", { count: releases.pending, next: releases.next })
                : (releases.raised ?? []).length > 0 ? words("releasesRaised", { list: (releases.raised ?? []).join(", "), next: releases.next }) : words("releasesNothing")}
        </Text>,
        ...(releases.contracts ?? []).map((contract) => <Text key={`contract-${contract.name}`} dimColor>{`${contract.name}: ${contract.before} → ${contract.current}`}</Text>),
        ...releases.list.map((release) => (
            <Box key={`release-${release.version}`} flexDirection="row" flexWrap="nowrap" gap={1} alignItems="center">
                <Box flexShrink={0}><Link key={`release-link-${release.version}`} href={`${snapshot.page}/#releases/${release.version}`}>{`v${release.version}`}</Link></Box>
                <Box flexShrink={0}><Text dimColor>{[release.day, release.count === null ? words(release.declared ? "releaseDeclared" : "releaseTagOnly") : words("releaseTasks", { count: release.count })].filter(Boolean).join(" · ")}</Text></Box>
                {release.summary ? <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden"><Text wrap="truncate-end">{release.summary}</Text></Box> : null}
            </Box>
        )),
        ...((releases.total ?? 0) > releases.list.length ? [<Link key="releases-all" href={`${snapshot.page}/#releases`}>{words("releasesAll", { count: releases.total })}</Link>] : []),
    ]);
}
