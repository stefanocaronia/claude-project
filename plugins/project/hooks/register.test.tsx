// The panel's drawing and controls on the terminal and the desktop, over a snapshot of a small project: claude plugin test plugins/project
import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const plugin = "project";
const surfaces = ["terminal", "desktop"] as const;
const props = { title: "Progetto", isFocused: false, bodyColumns: 60, placement: "dock" } as never;
const snapshot = {
    project: "demo",
    language: "it",
    words: { states: { doing: "In corso", todo: "Da fare", postponed: "Rimandati", done: "Fatti" }, priorities: { P1: "alta", P2: "normale", P3: "bassa" }, noGoal: "—" },
    prefixes: { task: "T", decision: "D" },
    types: { bug: "bug", feature: "funzione", chore: "manutenzione", research: "ricerca" },
    today: "2026-10-30",
    page: "http://localhost:5790",
    links: [{ label: "↗ betasim 1280", href: "http://localhost:5790/extension/game/betasim/1280/latest/index.html" }, { label: "▶ Demo · 5e", post: "http://localhost:5790/extension/game/demo/5e/start" }],
    people: ["Claude", "Stefano"],
    documents: [{ name: "GDD", href: "http://localhost:5790/#documents/0", exists: true }],
    issues: [{ number: 40, title: "Il login fallisce", url: "https://github.com/a/b/issues/40" }],
    colleagues: [{ id: "matteo-conti", name: "Matteo", fullName: "Matteo Conti", role: "code review", color: "red" }],
    tasks: [
        { id: 62, priority: "P1", effort: "alto", effortKey: "high", to: "Matteo", colleague: "matteo-conti", created: "2026-10-28", goal: "Revisione", text: "I pacchetti nei loro repo", state: "doing", started: "2026-10-24", stale: true, after: [], blockedBy: [], chain: [], waitedBy: ["T-72"], see: [], seenFrom: [], note: null, noteHref: null },
        { id: 143, priority: "P2", effort: "alto", effortKey: "high", to: "Claude", colleague: null, created: "2026-10-29", goal: "—", text: "Il plugin claude-project", state: "doing", after: [], blockedBy: [], chain: [], waitedBy: [], see: ["D-541"], seenFrom: ["T-61"], note: "docs/compiti/T-143.md", noteHref: "http://localhost:5790/note/143", commits: [{ hash: "759cf6f", day: "2026-10-30", subject: "Project 0.3.0", repo: "progetto", url: "https://github.com/a/b/commit/759cf6f" }], commitCount: 3, pulls: [{ number: 12, title: "Il plugin", state: "merged", url: "https://github.com/a/b/pull/12", merged: "2026-10-30" }], mergedPull: { number: 12, title: "Il plugin", state: "merged", url: "https://github.com/a/b/pull/12", merged: "2026-10-30" } },
        { id: 61, priority: "P1", effort: "alto", effortKey: "high", to: "Matteo", colleague: "matteo-conti", created: "2026-10-28", goal: "Revisione", text: "La plancia, in tre parti", state: "todo", after: [], blockedBy: [], chain: [], waitedBy: [], see: ["T-143"], seenFrom: [], note: null, noteHref: null },
        // The oldest P1 to do, but it waits for T-62, still in progress: the next-task button skips it.
        { id: 72, priority: "P1", effort: "medio", effortKey: "medium", to: "Claude", colleague: null, created: "2026-10-20", goal: "Revisione", text: "Il rilascio", state: "todo", after: ["T-62", "#giulia-1"], blockedBy: ["T-62", "#giulia-1"], chain: ["#giulia-1", "T-62"], waitedBy: [], see: [], seenFrom: [], note: null, noteHref: null },
        // A large task, the oldest P1, is done through its parts: the next-task button skips it, its ▶ starts its next part.
        { id: 80, priority: "P1", effort: "alto", effortKey: "high", to: "Claude", colleague: null, created: "2026-10-01", goal: "Revisione", text: "I sotto-compiti", state: "todo", after: [], blockedBy: [], chain: [], waitedBy: [], see: [], seenFrom: [], note: null, noteHref: null, parent: null, parts: ["T-81", "T-82"], partsDone: 1, nextPart: "T-81" },
        { id: 81, priority: "P2", effort: "medio", effortKey: "medium", to: "Claude", colleague: null, created: "2026-10-02", goal: "Revisione", text: "Il formato", state: "todo", after: [], blockedBy: [], chain: [], waitedBy: [], see: [], seenFrom: [], note: null, noteHref: null, parent: "T-80", parts: [], partsDone: 0, nextPart: null },
        { id: 70, priority: "P1", effort: "medio", effortKey: "medium", to: "Stefano", colleague: null, created: "2026-10-28", goal: "—", text: "Il login di npm", state: "todo", type: "bug", due: "2026-10-28", dueInfo: { day: "2026-10-28", days: -2, isLate: true, isNear: false }, issue: "#33", issueInfo: { number: 33, title: "npm login", state: "open", url: "https://github.com/a/b/issues/33", closed: null }, after: [], blockedBy: [], chain: [], waitedBy: [], see: [], seenFrom: [], note: null, noteHref: null },
        { id: 71, priority: "P3", effort: "medio", effortKey: "medium", to: "Claude", colleague: null, created: "2026-10-28", goal: "Revisione", text: "Più avanti", state: "postponed", after: [], blockedBy: [], chain: [], waitedBy: [], see: [], seenFrom: [], note: null, noteHref: null },
    ],
    plan: { updated: "2026-10-29", phases: [{ number: 1, name: "Il nucleo", goals: 1, closedGoals: 1, isClosed: true }, { number: 4, name: "La 5e", goals: 1, closedGoals: 0, isClosed: false }], goals: [{ name: "Revisione", phase: null, done: 6, total: 9, isDoing: true }, { name: "La 5e", phase: 4, done: 0, total: 3, isDoing: false }, { name: "Il nucleo", phase: 1, done: 5, total: 5, isDoing: false, closed: "2026-10-20" }] },
    decisions: {
        open: [
            { priority: "P3", day: null, text: "Le cariche degli oggetti", whole: "P3 · Le cariche degli oggetti", line: 553 },
            { priority: null, day: "2026-10-27", text: "I temi da installare", whole: "I temi da installare (Stefano, 27 ottobre)", line: 560 },
        ],
    },
    watch: ["/p/docs/TASKS.md"],
    problems: [],
    health: { errors: 0, warnings: 6, notes: 24 },
};

// How snapshot.mjs answers, test by test: the snapshot, no project (exit 3), or a failure.
type Answer = { exitCode: number; stdout: string; stderr: string };
const good: Answer = { exitCode: 0, stdout: JSON.stringify(snapshot), stderr: "" };

function world(on: On, answers: Answer[] = [good]): { runs: string[][]; prompts: string[]; commands: string[]; stamp: { mtimeMs: number }; opens: { count: number } }
{
    const runs: string[][] = [];
    const prompts: string[] = [];
    const commands: string[] = [];
    const stamp = { mtimeMs: 1 };
    const opens = { count: 0 };
    let reads = 0;
    mock.env(on, { OS: "Linux", TMPDIR: "/tmp", LANG: "it_IT.UTF-8" });
    mock.clock(on, { now: Date.UTC(2026, 9, 30, 9, 0) });
    mock.store(on);
    on("session.start", () => ({ cwd: "/p" }) as never);
    on("session.root", () => ({ value: "/p" }));
    on("session.id", () => ({ value: "s1" }));
    // The chats' hold files, in memory; the engine resolves "/tmp" against the drive on Windows, so the paths are kept without it.
    const files: Record<string, string> = {};
    const posix = (path: string) => path.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
    on("fs.write", (_, e) => {
        files[posix(e.path)] = e.text;
        return { value: undefined } as never;
    });
    on("fs.read", (_, e) => (posix(e.path) in files ? { value: files[posix(e.path)] } : { deny: "missing" }) as never);
    on("fs.exists", (_, e) => ({ value: Object.keys(files).some((path) => path.startsWith(posix(e.path))) }));
    on("fs.list", (_, e) => ({ value: Object.keys(files).filter((path) => path.startsWith(`${posix(e.path)}/`)).map((path) => ({ name: path.slice(posix(e.path).length + 1), kind: "file", size: 1, mtimeMs: 1, isLink: false })) }) as never);
    on("command.register", () => ({ value: {} }) as never);
    on("fs.stat", () => ({ value: { kind: "file", size: 10, mtimeMs: stamp.mtimeMs, isLink: false } }) as never);
    on("process.run", (_, e) => {
        const args = e.argv.slice(1).map((arg) => arg.replace(/^.*\/scripts\//, ""));
        runs.push(args);
        const answer = args[0] === "snapshot.mjs" ? answers[Math.min(reads++, answers.length - 1)] ?? good : { exitCode: 0, stdout: "", stderr: "" };
        return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } } as never;
    });
    on("prompt.submit", (_, e) => {
        prompts.push(e.text);
        return { text: e.text } as never;
    });
    on("command.run", (_, e) => {
        commands.push(`/${e.command} ${e.args ?? ""}`.trim());
        return { text: "" } as never;
    });
    on("ui.open", () => {
        opens.count++;
        return { value: { isPlaced: true } } as never;
    });
    on("ui.toast", () => ({ value: {} }) as never);
    on("agent.spawn", () => ({ model: "claude-opus-5-5", agentId: "a1" }) as never);
    on("ui.render", ($, e) => {
        const { Text } = $.ui.resolve(e);
        return <Text key="engine">engine</Text>;
    });
    return { runs, prompts, commands, stamp, opens };
}

test("the panel shows the project's numbers, the tasks in progress and the P1 to do, the goals, the points to decide", async ($, on) => {
    world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "demo" })).toBeDefined();
        expect((await ui.find({ key: "toggle-documents" }))?.props.label).toBe("▾ 📄 Documenti");
        expect((await ui.find({ key: "toggle-doing" }))?.props.label).toBe("▾ ⚒︎ In corso · 2");
        expect((await ui.find({ key: "toggle-goals" }))?.props.label).toBe("▾ ⚑︎ Piano · 2");
        expect((await ui.find({ key: "toggle-rest" }))?.props.label).toBe("▾ ☰ Da fare · 4");
        // Only what waits to be decided, open from the start; the decisions taken are the page's.
        expect((await ui.find({ key: "toggle-decisions" }))?.props.label).toBe("▾ ⚖︎ Da decidere · 2");
        expect(await ui.find({ type: "Text", text: /Decise di recente/ })).toBeUndefined();
        expect(await ui.find({ type: "Text", text: "▸ I pacchetti nei loro repo" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: "T-62" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^▸ Revisione/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /6\/9/ })).toBeDefined();
        // The goals by phase: an open phase's line above its goals, a closed phase one line.
        expect(await ui.find({ type: "Text", text: "fase 4 · La 5e" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: "✓ fase 1 · Il nucleo, chiusa" })).toBeDefined();
        // A closed goal has no bar: only the count of the closed ones, a link to the page.
        expect(await ui.find({ type: "Text", text: /^▸ Il nucleo/ })).toBeUndefined();
        expect((await ui.find({ type: "Link", text: "✓ 1 traguardi chiusi" }))?.props.href).toBe("http://localhost:5790/#overview");
        // Stefano's own task has no ▶: nobody starts it but him.
        expect(await ui.find({ key: "start-61" })).toBeDefined();
        expect(await ui.find({ key: "start-70" })).toBeUndefined();
        expect(await ui.find({ type: "Text", text: "▸ I temi da installare" })).toBeDefined();
        // The postponed in a section of their own after the tasks to do, closed at the start.
        expect((await ui.find({ key: "toggle-postponed" }))?.props.label).toBe("▸ ⏸ Rimandati · 1");
        await ui.unmount();
    }
});

test("a task opens in place; Done and Postpone and the priority go through the backlog's command line", async ($, on) => {
    const { runs } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        runs.length = 0;
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        await ui.press({ key: "open-61" });
        // Opened: chips for its goal and the day it was born, a chip on the desktop, in brackets on the terminal; who holds it, its
        // priority and effort are only in the row.
        expect(await ui.find({ type: "Text", text: /^\[?Matteo Conti\]?$/ })).toBeUndefined();
        expect(await ui.find({ type: "Text", text: /^\[?⚑ Revisione\]?$/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^\[?nato il 2026-10-28\]?$/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /impegno/ })).toBeUndefined();
        await ui.press({ key: "done-61" });
        await ui.press({ key: "postpone-61" });
        await ui.press({ key: "priority-61" });
        expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "done", "T-61"], ["backlog.mjs", "postpone", "T-61"], ["backlog.mjs", "set", "T-61", "--p", "P2"]]);
        await ui.press({ key: "open-61" });
        await ui.unmount();
    }
});

test("▶ gives a colleague's task to Crew's next command and asks Claude for its own in the chat", async ($, on) => {
    const { prompts, commands } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    await ui.press({ key: "start-61" });
    await ui.press({ key: "start-143" });
    expect(commands).toEqual(["/crew:next Matteo -- T-61 · La plancia, in tre parti"]);
    // T-143 is in progress and nobody holds it: ▶ takes it up again.
    expect(prompts[0]).toMatch(/^Riprendi T-143: Il plugin claude-project. È già in corso/);
    // While it starts, the ▶ waits.
    expect(await ui.find({ key: "start-61" })).toBeUndefined();
    await ui.unmount();
});

test("the points to decide by priority, one brought to the chat as a choice", async ($, on) => {
    const { prompts } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        prompts.length = 0;
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "▸ I temi da installare" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: "3 g" })).toBeDefined();
        await ui.press({ key: "open-proposal-560" });
        await ui.press({ key: "choice-proposal-560" });
        expect(prompts).toEqual(["Portami come scelta, con la tua raccomandazione prima, questo punto da decidere (riga 560 delle decisioni): I temi da installare (Stefano, 27 ottobre)"]);
        await ui.press({ key: "open-proposal-560" });
        await ui.unmount();
    }
});

test("a colleague started on a task its brief cites moves it to in progress, and only theirs", async ($, on) => {
    const { runs } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    runs.length = 0;
    await $.agent.spawn({ prompt: "Fai T-61, e guarda T-70 e T-62.", description: "plancia", subagentType: "matteo-conti" } as never);
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "start", "T-61"]]);
    runs.length = 0;
    await $.agent.spawn({ prompt: "Fai T-61.", description: "x", subagentType: "Explore" } as never);
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([]);
});

test("an extension's links show under the heading: a page opens, an action posts to the project's page", async ($, on) => {
    world(on);
    const posts: string[] = [];
    on("http.fetch", (_, e) => {
        posts.push(`${e.init?.method ?? "GET"} ${e.url}`);
        return { value: { status: 200, ok: true, headers: {}, text: "{}" } } as never;
    });
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        posts.length = 0;
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ key: "link-1" })).toBeDefined();
        await ui.press({ key: "link-1" });
        expect(posts).toEqual(["POST http://localhost:5790/extension/game/demo/5e/start"]);
        await ui.unmount();
    }
});

test("a reading that fails after a good one keeps the panel and says why, under its heading", async ($, on) => {
    world(on, [good, { exitCode: 1, stdout: "", stderr: ".claude/project.yaml, line 6: Map keys must be unique" }]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    // A change through the panel reads the project again, and this time the reading fails.
    const first = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    await first.press({ key: "open-61" });
    await first.press({ key: "done-61" });
    await first.unmount();

    for (const surface of surfaces) {
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "demo" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /⚠ .*line 6: Map keys must be unique/ })).toBeDefined();
        await ui.unmount();
    }
});

test("in a folder with no project the panel opens on nothing and says how to set one up", async ($, on) => {
    const { opens } = world(on, [{ exitCode: 3, stdout: "", stderr: "" }]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    expect(opens.count).toBe(0);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    expect(await ui.find({ type: "Text", text: /\/project:init/ })).toBeDefined();
    await ui.unmount();
});

test("the buttons above the links start the first task by priority and age, and bring the first decision as a choice", async ($, on) => {
    const { prompts, commands } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "next-task" }))?.props.label).toBe("▶ Prossimo compito (T-61)");
    await ui.press({ key: "next-task" });
    await ui.press({ key: "next-decision" });
    await ui.press({ key: "tidy-docs" });
    expect(commands[0]).toBe("/crew:next Matteo -- T-61 · La plancia, in tre parti");
    expect(prompts[0]).toMatch(/\(riga 553 delle decisioni\): P3 · Le cariche degli oggetti$/);
    // The tidying runs the skill's own command, so that the skill is loaded whole.
    expect(commands[1]).toMatch(/^\/project:tidy i documenti del progetto: .*mai di deciderlo/);
    await ui.unmount();
});

test("a task in progress: a colleague at work shows instead of ▶, the chat that holds it needs none, another chat goes on through a message", async ($, on) => {
    const { prompts } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    await $.agent.spawn({ prompt: "Fai T-62.", description: "pacchetti", subagentType: "matteo-conti" } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    expect(await ui.find({ key: "start-62" })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: "⚒︎ Matteo" })).toBeDefined();
    await ui.press({ key: "start-143" });
    expect(prompts[0]).toMatch(/^Riprendi T-143/);
    await ui.unmount();
    const again = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    // This chat holds T-143 now: no ▶, once the start shown on the button is over.
    expect(await again.find({ key: "start-143" })).toBeUndefined();
    // A chat at work on a task starts no other: no next task, no ▶, a line that says where another one starts.
    expect(await again.find({ key: "next-task" })).toBeUndefined();
    // The button stays in its place, gray, with why it cannot be pressed.
    expect((await again.find({ key: "next-task-idle" }))?.props.label).toBe("▶ Prossimo compito");
    expect(await again.find({ key: "start-61" })).toBeUndefined();
    expect(await again.find({ type: "Text", text: "Questa chat lavora a T-143: un altro compito si avvia in una nuova sessione del progetto." })).toBeDefined();
    await again.unmount();
});

test("a blocked task shows what it waits for in place of its age, its ▶ asks for the chain, and its links show both ways", async ($, on) => {
    const { prompts, commands } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "⛓ T-62 +1" })).toBeDefined();
        // On the desktop a hint says it in words.
        expect(await ui.find({ type: "Text", text: "Aspetta T-62, #giulia-1, ancora aperti: si può avviare quando sono fatti" })).toEqual(surface === "desktop" ? expect.anything() : undefined);
        await ui.press({ key: "open-72" });
        expect(await ui.find({ type: "Text", text: "aspetta" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^\[?#giulia-1\]?$/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^\[?⛓ #giulia-1 → T-62 → T-72\]?$/ })).toBeDefined();
        await ui.press({ key: "open-72" });
        await ui.press({ key: "open-143" });
        expect(await ui.find({ type: "Text", text: "vedi" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^\[?D-541\]?$/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: "citato da" })).toBeDefined();
        expect((await ui.find({ type: "Link", text: "📄 Nota ↗" }))?.props.href).toBe("http://localhost:5790/note/143");
        // The code that cites it: the commits, the latest a link; the pull request, merged, and that the task can close.
        expect((await ui.find({ type: "Link", text: "⎇ 3 commit, l'ultimo il 2026-10-30" }))?.props.href).toBe("https://github.com/a/b/commit/759cf6f");
        expect((await ui.find({ type: "Link", text: "#12 unita il 2026-10-30" }))?.props.href).toBe("https://github.com/a/b/pull/12");
        expect(await ui.find({ type: "Text", text: "✓ pull request #12 unita: si può chiudere" })).toBeDefined();
        await ui.press({ key: "open-143" });
        await ui.unmount();
    }

    // The start shows on its ▶ for a while: pressed once, on the desktop.
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    await ui.press({ key: "start-72" });
    expect(prompts[0]).toMatch(/^Avvia la catena di T-72: Il rilascio\. .*la catena, in ordine: #giulia-1 → T-62 → T-72\. .*chiedimi una volta sola/);
    await ui.unmount();
    expect(commands).toEqual([]);
});

test("the next-task button skips a blocked task, and taking up a task with a note sends Claude to it", async ($, on) => {
    const { prompts } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "next-task" }))?.props.label).toBe("▶ Prossimo compito (T-61)");
    await ui.press({ key: "start-143" });
    expect(prompts[0]).toMatch(/^Riprendi T-143: .* La sua nota, col contesto e dove è arrivato il lavoro: docs\/compiti\/T-143\.md; leggila prima\.$/);
    await ui.unmount();
});

test("▶ on Claude's own task moves it to in progress before asking, and a change Claude makes through the commands shows at once", async ($, on) => {
    const { runs, prompts, stamp } = world(on);
    on("tool.call", () => ({ result: "ran" }) as never);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    runs.length = 0;
    await ui.press({ key: "toggle-postponed" });
    await ui.press({ key: "start-71" });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "start", "T-71"]]);
    expect(prompts[0]).toBe("Lavora a T-71: Più avanti");
    await ui.unmount();

    // A command of the backlog run in the chat reads the project again, without waiting for the turn to end.
    const reads = () => runs.filter((args) => args[0] === "snapshot.mjs").length;
    const before = reads();
    stamp.mtimeMs = 2;
    await $.tool.call({ tool: "Bash", command: "node scripts/backlog.mjs start T-61" } as never);
    expect(reads()).toBe(before + 1);
});

test("the button for where the project stands asks Claude for a short report, and tidying the backlog runs the tidy skill", async ($, on) => {
    const { prompts, commands } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "where-we-stand" }))?.props.label).toBe("◎ Il punto della situazione");
    await ui.press({ key: "where-we-stand" });
    expect(prompts[0]).toMatch(/^Fammi il punto della situazione del progetto, in al massimo 30 righe/);
    await ui.press({ key: "tidy-backlog" });
    expect(commands[0]).toMatch(/^\/project:tidy sezione 4, il backlog e le decisioni da prendere: prima da solo il minimo.*mai farmi decidere un punto aperto/);
    await ui.unmount();
});

test("a large task shows its parts closed in place of its age, its ▶ starts the next part, and a part names its large task", async ($, on) => {
    const withDone = { ...good, stdout: JSON.stringify({ ...snapshot, doneParts: [{ id: 82, parent: "T-80", to: "Claude", type: null, text: "La parte fatta", done: "2026-10-29" }] }) };
    const { runs, prompts } = world(on, [withDone]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    // Its parts closed as a chip with an arrow; folded while none is in progress, shown with a press, folded again with another.
    expect(await ui.find({ type: "Text", text: "[▸ 1/2]" })).toBeDefined();
    expect(await ui.find({ key: "part-81" })).toBeUndefined();
    await ui.press({ key: "parts-80" });
    expect(await ui.find({ type: "Text", text: "[▾ 1/2]" })).toBeDefined();
    // The part is drawn under its large task, not on its own: To do counts the large task only.
    expect((await ui.find({ key: "toggle-rest" }))?.props.label).toBe("▾ ☰ Da fare · 4");
    expect(await ui.find({ key: "part-81" })).toBeDefined();
    // A part closed while its large task is open: under it, checked, without ▶.
    expect(await ui.find({ key: "done-part-82" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "La parte fatta" })).toBeDefined();
    expect(await ui.find({ key: "start-82" })).toBeUndefined();
    await ui.press({ key: "open-81" });
    // Drawn under its large task, a part does not name it again.
    expect(await ui.find({ type: "Text", text: "parte di" })).toBeUndefined();
    await ui.press({ key: "open-80" });
    expect(await ui.find({ type: "Text", text: "parti · 1/2" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "[T-82]" })).toBeDefined();
    runs.length = 0;
    await ui.press({ key: "start-80" });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "start", "T-81"]]);
    expect(prompts[0]).toBe("Lavora a T-81: Il formato");
    await ui.unmount();
});

test("the open GitHub issues no task does yet show apart and go into the backlog; done on a task whose issue is open asks Claude to ask about closing it", async ($, on) => {
    const { runs, prompts } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "toggle-issues" }))?.props.label).toBe("▾ ◉ Issue di GitHub · 1");
    runs.length = 0;
    await ui.press({ key: "issue-take-40" });
    await ui.press({ key: "open-70" });
    expect((await ui.find({ type: "Link", text: "◉ #33 aperta" }))?.props.href).toBe("https://github.com/a/b/issues/33");
    await ui.press({ key: "done-70" });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "add", "Il login fallisce", "--issue", "40"], ["backlog.mjs", "done", "T-70"]]);
    expect(prompts[0]).toMatch(/^T-70 è fatto e la sua issue #33 su GitHub è ancora aperta: chiedimi se chiuderla/);
    await ui.unmount();
});

test("a task's type as Jira draws it, its due day near or late, a task stuck in progress, and the tasks a decision is tied to", async ($, on) => {
    world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "⏰ in ritardo di 2 g" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^⏸ 6.g$/ })).toBeDefined();
        await ui.press({ key: "open-70" });
        expect(await ui.find({ type: "Text", text: /^\[?⏰ in ritardo di 2 g\]?$/ })).toBeDefined();
        await ui.press({ key: "open-70" });
        await ui.unmount();
    }
});

test("a postponed task goes back to do from its row, and a large task takes its postponed parts along", async ($, on) => {
    const { runs } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    await ui.press({ key: "toggle-postponed" });
    await ui.press({ key: "open-71" });
    expect(await ui.find({ key: "postpone-71" })).toBeUndefined();
    runs.length = 0;
    await ui.press({ key: "resume-71" });
    await ui.press({ key: "open-80" });
    await ui.press({ key: "postpone-80" });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "todo", "T-71"], ["backlog.mjs", "postpone", "T-80", "T-81"]]);
    await ui.unmount();
});

test("a task added from the list to do, with its priority, type and large task, is its person's; an open task's text written again; «Archive» archives on its second press", async ($, on) => {
    const { runs } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    runs.length = 0;
    await ui.press({ key: "new-task" });
    // The text typed so far stays while the pickers draw the panel again.
    await ui.input({ key: "new-task", text: "un · compito", kind: "change" });
    await ui.select({ key: "new-priority", value: "P1" });
    await ui.select({ key: "new-type", value: "bug" });
    await ui.select({ key: "new-parent", value: "T-80" });
    expect((await ui.find({ key: "new-task" }))?.props.value).toBe("un · compito");
    await ui.input({ key: "new-task", text: "un · compito\n nuovo" });
    await ui.press({ key: "open-80" });
    await ui.press({ key: "edit-text-80" });
    await ui.input({ key: "edit-80", text: "I sotto-compiti, scritti di nuovo" });
    await ui.press({ key: "archive-80" });
    expect(await ui.find({ type: "Button", label: "🗄 Archiviare T-80? Premi ancora" })).toBeDefined();
    await ui.press({ key: "archive-80" });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([
        ["backlog.mjs", "add", "un - compito nuovo", "--p", "P1", "--type", "bug", "--in", "T-80", "--by", "Stefano"],
        ["backlog.mjs", "set", "T-80", "--text", "I sotto-compiti, scritti di nuovo"],
        ["backlog.mjs", "archive", "T-80"],
    ]);
    await ui.unmount();
});

test("the owner's GitHub picture on their tasks and beside every decision; without it, the initials of the person who decides", async ($, on) => {
    const owned = { ...good, stdout: JSON.stringify({ ...snapshot, owner: { name: "Stefano", fullName: "Stefano Caronia", portrait: "data:image/jpeg;base64,AAAA" } }) };
    world(on, [owned]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    const pictures = async () => (await ui.findAll({ type: "Svg" })).filter((one) => (one.props as { alt?: string }).alt === "Stefano Caronia");
    // T-70, Stefano's, in its row, and the two points to decide, each with who decides.
    expect((await pictures()).length).toBe(3);
    await ui.unmount();
});

test("an open task being edited changes its goal, who does it and the project's own fields through the backlog's command", async ($, on) => {
    const withFields = { ...snapshot, fields: { system: { name: "Sistema", values: ["5e", "ironsworn"] }, area: { name: "Area", values: null } } };
    const { runs } = world(on, [{ ...good, stdout: JSON.stringify(withFields) }]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    await ui.press({ key: "open-80" });
    await ui.press({ key: "edit-text-80" });
    runs.length = 0;
    await ui.select({ key: "edit-to-80", value: "Stefano" });
    await ui.select({ key: "edit-field-system-80", value: "5e" });
    await ui.input({ key: "edit-field-area-80", text: " il diario " });
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([
        ["backlog.mjs", "set", "T-80", "--to", "Stefano"],
        ["backlog.mjs", "set", "T-80", "--system", "5e"],
        ["backlog.mjs", "set", "T-80", "--area", "il diario"],
    ]);
    expect(await ui.find({ key: "edit-goal-80" })).toBeDefined();
    await ui.unmount();
});

test("a project not on GitHub, or without git and gh, has a button that runs the github skill; one on GitHub has none", async ($, on) => {
    const answers = [{ ...good, stdout: JSON.stringify({ ...snapshot, github: { tools: true, repo: null } }) }];
    const { commands } = world(on, answers);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "github" }))?.props.label).toBe("🐙 Mettilo su GitHub");
    await ui.press({ key: "github" });
    expect(commands).toContain("/project:github");
    await ui.unmount();
});

test("the versions at the bottom, the newest first, each opening its notes in the page, and what waits for the next", async ($, on) => {
    const released = { ...snapshot, releases: { list: [{ version: "0.8.0", day: "2026-11-02", summary: "Extensions grow.", count: 12 }, { version: "0.7.1", day: "2026-10-31", summary: "", count: 3 }], pending: 2, next: "0.8.1" } };
    world(on, [{ ...good, stdout: JSON.stringify(released) }]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    expect((await ui.find({ key: "toggle-releases" }))?.props.label).toBe("▾ 🏷︎ Versioni · 2");
    expect(await ui.find({ type: "Text", text: "2 compiti fatti dall'ultima versione · prossima v0.8.1" })).toBeDefined();
    expect((await ui.find({ type: "Link", text: "v0.8.0" }))?.props.href).toBe("http://localhost:5790/#releases/0.8.0");
    expect(await ui.find({ type: "Text", text: "Extensions grow." })).toBeDefined();
    await ui.unmount();
});

test("a project without Crew: no colleague, every task Claude's or a person's, and nothing goes to Crew's commands", async ($, on) => {
    const solo = { ...snapshot, colleagues: [], tasks: snapshot.tasks.filter((task) => !["Matteo"].includes(task.to)) };
    const { runs, prompts, commands } = world(on, [{ ...good, stdout: JSON.stringify(solo) }]);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    runs.length = 0;
    expect(await ui.find({ key: "next-task-idle" })).toBeDefined();
    await ui.press({ key: "toggle-postponed" });
    await ui.press({ key: "start-71" });
    expect(commands.filter((command) => command.startsWith("/crew:"))).toEqual([]);
    expect(prompts[0]).toBe("Lavora a T-71: Più avanti");
    expect(runs.filter((args) => args[0] === "backlog.mjs")).toEqual([["backlog.mjs", "start", "T-71"]]);
    await ui.unmount();
});

test("a ▶ that cannot be pressed stays in its place, gray, with its reason", async ($, on) => {
    world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "desktop", component: "Pane", requestId: "project", props });
    // Stefano's own task: no button, a gray ▶ that says who starts it.
    expect(await ui.find({ key: "start-70" })).toBeUndefined();
    expect(await ui.find({ key: "idle-70" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "Lo avvia Stefano" })).toBeDefined();
    await ui.unmount();
});

test("a task whose priority turns stays under the pointer while the list keeps its order", async ($, on) => {
    const lowered = { ...good, stdout: JSON.stringify({ ...snapshot, tasks: snapshot.tasks.map((task) => (task.id === 61 ? { ...task, priority: "P2" } : task)) }) };
    const answers = [good];
    world(on, answers);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);
    const ui = await $.ui.mount({ plugin, surface: "terminal", component: "Pane", requestId: "project", props });
    const rows = async () => (await ui.findAll({ type: "Button" })).map((one) => one.key).filter((key): key is string => Boolean(key) && /^open-\d+$/.test(key ?? ""));
    const before = await rows();
    expect(before.indexOf("open-61")).toBeLessThan(before.indexOf("open-70"));
    // The reading after the press has T-61 lowered.
    answers.push(lowered);
    await ui.press({ key: "priority-61" });
    // Now P2, T-61 would sort after the P1 tasks; for a moment every row stays where it was.
    expect(await rows()).toEqual(before);
    await ui.unmount();
});
