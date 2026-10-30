/** A task of the backlog, as snapshot.mjs gives it. */
export type Task = {
    id: number;
    priority: "P1" | "P2" | "P3";
    effort: string;
    effortKey: string;
    to: string;
    /** The Crew colleague who holds it, by agent id; null for a person or Claude. */
    colleague: string | null;
    created: string;
    /** Who created it, `(by: Stefano)`: Claude, a person or a colleague; null when the backlog does not say. */
    by?: string | null;
    goal: string;
    text: string;
    state: "doing" | "todo" | "postponed";
    /** The tasks and todo ids it waits for, `(after: T-62, #giulia-1)`; those still open; the open ones to do first, the first first. */
    after: string[];
    blockedBy: string[];
    chain: string[];
    /** The tasks that wait for it. */
    waitedBy: string[];
    /** The tasks and decisions it points to, `(see: T-12, D-2)`, and the tasks that point to it. */
    see: string[];
    seenFrom: string[];
    /** Its note's path from the project's root, and its address on the page; null without one. */
    note: string | null;
    noteHref: string | null;
    /** The large task it is a part of, `(in: T-23)`; or, for a large task, its parts, how many are closed and the next to start. */
    parent: string | null;
    parts: string[];
    partsDone: number;
    nextPart: string | null;
    /** The code that cites it: its latest commits and how many, its pull requests, the latest merged one. */
    commits: { hash: string; day: string; subject: string; repo: string; url: string | null }[];
    commitCount: number;
    pulls: Pull[];
    mergedPull: Pull | null;
    /** Its type `(type: bug)`, its due day `(due: 2026-11-15)` and how far it is, the day it started, whether it is stuck: in progress for
     * days with nobody holding it; the decisions it is tied to, both ways. */
    type?: string | null;
    due?: string | null;
    dueInfo?: { day: string; days: number; isLate: boolean; isNear: boolean } | null;
    started?: string | null;
    stale?: boolean;
    decisions?: string[];
    /** Its GitHub issue, `(issue: #34)`, as GitHub has it; null without one, or without gh. */
    issue?: string | null;
    issueInfo?: { number: number; title: string; state: string; url: string | null; closed: string | null } | null;
};

export type Pull = { number: number; title: string; state: string; url: string | null; merged: string | null };

/** A goal of the plan with its tasks counted; `closed`, the day it closed, out of the open bars. */
export type Goal = { name: string; phase: number | null; done: number; total: number; isDoing: boolean; closed?: string | null };

/** A phase of the plan, closed once every goal of it is. */
export type Phase = { number: number; name: string; goals: number; closedGoals: number; isClosed: boolean };

export type Proposal = { priority: string | null; day: string | null; text: string; whole: string; line: number };

export type Member = { id: string; name: string; fullName: string; role: string; color: string; portrait?: string };

/** What the panel draws, read from the project's files by snapshot.mjs. */
/** A part already closed of a large task still open: done, or archived. */
export type DonePart = { id: number; parent: string; to: string; type?: string | null; text: string; done: string | null };

export type Snapshot = {
    project: string;
    language: string;
    words: { states: Record<string, string>; priorities: Record<string, string>; noGoal: string };
    prefixes: { task: string; decision: string };
    /** The task types by key, each with its name in the project's language. */
    types?: Record<string, string>;
    /** The closed parts of the large tasks still open. */
    doneParts?: DonePart[];
    today: string;
    page: string;
    /** The extensions' links: a page to open, or a path of the project's page to POST to. */
    links: { label: string; href?: string; post?: string }[];
    /** What did not load: an extension's error, say. */
    problems: string[];
    people: string[];
    /** The key documents, each opened through the project's page. */
    documents: { name: string; href: string; exists: boolean }[];
    /** The open GitHub issues no task does yet, to take into the backlog; none without gh. */
    issues?: { number: number; title: string; url: string | null }[];
    colleagues: Member[];
    /** The person this machine's gh is signed in as, with their GitHub picture: on their tasks and on every decision; null without gh. */
    owner?: { name: string; fullName: string; portrait?: string } | null;
    tasks: Task[];
    plan: { updated: string | null; goals: Goal[]; phases?: Phase[] };
    /** The points still to decide; the decisions taken are the page's. */
    decisions: { open: Proposal[] };
    watch: string[];
    health: { errors: number; warnings: number; notes: number } | null;
};

/** Who holds a task in progress now: a chat of the project (this one or another), or a colleague at work in one. */
export type Hold = { session: string; colleague: string | null; agentId: string | null };

/** The panel's data, or why it has none; the holds of every chat of the project, by task number. */
export type Board = { snapshot: Snapshot | null; problem: string | null; readAt: number; stamp: string; holds: Record<string, Hold>; session: string };

/** What the user opened and closed: the sections, the one row open, the lists shown whole, the starts asked. */
export type View = {
    sections: Record<string, boolean>;
    expanded: string | null;
    whole: Record<string, boolean>;
    starting: Record<string, number>;
    /** The lists' order kept for a moment after a priority turns, by task number, until a time; null when they sort freely. */
    frozen?: { until: number; rank: Record<string, number> } | null;
    /** The text being written: "new" for a new task, an open task's key for its text; null when none. */
    editing?: string | null;
    /** A new task's priority, type and large task, picked before its text is written. */
    draft?: { priority?: string; type?: string; parent?: string };
    /** A large task's parts shown (true) or folded (false), by task number, as the user left them. */
    folds?: Record<string, boolean>;
    /** The task whose «Archive» was pressed once and waits for the second press. */
    archiving?: number | null;
};

declare module "claude-code" {
    interface PluginState {
        "project": { board: Shaped<Board>; view: Shaped<View> };
    }
}
