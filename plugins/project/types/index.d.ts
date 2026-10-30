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
    /** Its GitHub issue, `(issue: #34)`, as GitHub has it; null without one, or without gh. */
    issue?: string | null;
    issueInfo?: { number: number; title: string; state: string; url: string | null; closed: string | null } | null;
};

export type Pull = { number: number; title: string; state: string; url: string | null; merged: string | null };

/** A goal of the plan with its tasks counted; `closed`, the day it closed, out of the open bars. */
export type Goal = { name: string; phase: number | null; done: number; total: number; isDoing: boolean; closed?: string | null };

export type Proposal = { priority: string | null; day: string | null; text: string; whole: string; line: number };

export type Decision = { number: number; text: string; why: string };

export type Member = { id: string; name: string; fullName: string; role: string; color: string; portrait?: string };

/** What the panel draws, read from the project's files by snapshot.mjs. */
export type Snapshot = {
    project: string;
    language: string;
    words: { states: Record<string, string>; priorities: Record<string, string>; noGoal: string };
    prefixes: { task: string; decision: string };
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
    tasks: Task[];
    plan: { updated: string | null; goals: Goal[] };
    decisions: { open: Proposal[]; recent: Decision[] };
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
};

declare module "claude-code" {
    interface PluginState {
        "project": { board: Shaped<Board>; view: Shaped<View> };
    }
}
