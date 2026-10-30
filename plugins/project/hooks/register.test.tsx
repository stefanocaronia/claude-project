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
    today: "2026-10-30",
    page: "http://localhost:5790",
    links: [{ label: "↗ betasim 1280", href: "http://localhost:5790/extension/game/betasim/1280/latest/index.html" }, { label: "▶ Demo · 5e", post: "http://localhost:5790/extension/game/demo/5e/start" }],
    people: ["Claude", "Stefano"],
    colleagues: [{ id: "matteo-conti", name: "Matteo", fullName: "Matteo Conti", role: "code review", color: "red" }],
    tasks: [
        { id: 62, priority: "P1", effort: "alto", effortKey: "high", to: "Matteo", colleague: "matteo-conti", created: "2026-10-28", goal: "Revisione", text: "I pacchetti nei loro repo", state: "doing" },
        { id: 143, priority: "P2", effort: "alto", effortKey: "high", to: "Claude", colleague: null, created: "2026-10-29", goal: "—", text: "Il plugin claude-project", state: "doing" },
        { id: 61, priority: "P1", effort: "alto", effortKey: "high", to: "Matteo", colleague: "matteo-conti", created: "2026-10-28", goal: "Revisione", text: "La plancia, in tre parti", state: "todo" },
        { id: 70, priority: "P1", effort: "medio", effortKey: "medium", to: "Stefano", colleague: null, created: "2026-10-28", goal: "—", text: "Il login di npm", state: "todo" },
        { id: 71, priority: "P3", effort: "medio", effortKey: "medium", to: "Claude", colleague: null, created: "2026-10-28", goal: "Revisione", text: "Più avanti", state: "postponed" },
    ],
    plan: { updated: "2026-10-29", goals: [{ name: "Revisione", phase: null, done: 6, total: 9, isDoing: true }, { name: "La 5e", phase: 4, done: 0, total: 3, isDoing: false }] },
    decisions: {
        open: [
            { priority: "P3", day: null, text: "Le cariche degli oggetti", whole: "P3 · Le cariche degli oggetti", line: 553 },
            { priority: null, day: "2026-10-27", text: "I temi da installare", whole: "I temi da installare (Stefano, 27 ottobre)", line: 560 },
        ],
        recent: [{ number: 541, text: "Il PLAN tiene le fasi.", why: "Stefano, 29 ottobre." }],
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

test("the panel shows the project's numbers, the tasks in progress and the P1 to do, the goals; the decisions closed", async ($, on) => {
    world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        expect(await ui.find({ type: "Text", text: "demo" })).toBeDefined();
        expect((await ui.find({ key: "toggle-doing" }))?.props.label).toBe("▾ ⚒︎ In corso · 2");
        expect((await ui.find({ key: "toggle-goals" }))?.props.label).toBe("▾ ⚑︎ Piano · 2");
        expect((await ui.find({ key: "toggle-rest" }))?.props.label).toBe("▾ ☰ Da fare · 3");
        expect((await ui.find({ key: "toggle-decisions" }))?.props.label).toBe("▸ ⚖︎ Decisioni · 2 da decidere");
        expect(await ui.find({ type: "Text", text: "▸ I pacchetti nei loro repo" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /^▸ Revisione/ })).toBeDefined();
        expect(await ui.find({ type: "Text", text: /6\/9/ })).toBeDefined();
        // Stefano's own task has no ▶: nobody starts it but him.
        expect(await ui.find({ key: "start-61" })).toBeDefined();
        expect(await ui.find({ key: "start-70" })).toBeUndefined();
        expect(await ui.find({ type: "Text", text: "I temi da installare" })).toBeUndefined();
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
        expect(await ui.find({ type: "Text", text: /T-61 · P1 priorità alta · impegno alto · Matteo Conti · Revisione · nato il 2026-10-28/ })).toBeDefined();
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

test("the decisions open: the proposals by priority, one brought to the chat as a choice; the latest decision with its why", async ($, on) => {
    const { prompts } = world(on);
    await $.session.start({ cwd: "/p", surface: null, isInteractive: true } as never);

    for (const surface of surfaces) {
        prompts.length = 0;
        const ui = await $.ui.mount({ plugin, surface, component: "Pane", requestId: "project", props });
        await ui.press({ key: "toggle-decisions" });
        expect(await ui.find({ type: "Text", text: "▸ I temi da installare" })).toBeDefined();
        expect(await ui.find({ type: "Text", text: "3 g" })).toBeDefined();
        await ui.press({ key: "open-proposal-560" });
        await ui.press({ key: "choice-proposal-560" });
        expect(prompts).toEqual(["Portami come scelta, con la tua raccomandazione prima, questo punto da decidere (riga 560 delle decisioni): I temi da installare (Stefano, 27 ottobre)"]);
        await ui.press({ key: "open-decision-541" });
        expect(await ui.find({ type: "Text", text: "Stefano, 29 ottobre." })).toBeDefined();
        await ui.press({ key: "toggle-decisions" });
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
    expect(commands).toEqual(["/crew:next Matteo -- T-61 · La plancia, in tre parti"]);
    expect(prompts[0]).toMatch(/\(riga 553 delle decisioni\): P3 · Le cariche degli oggetti$/);
    expect(prompts[1]).toMatch(/^Riordina i documenti del progetto/);
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
    await again.unmount();
});
