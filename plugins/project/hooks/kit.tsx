// What every part of the panel draws with, made at each drawing: the surface's elements, the project as last read, the view the user
// left, and the pieces the parts share (a card, a section that opens and closes, a hint under the pointer, a chip, a face).
import type { Elements, EngineInterface, RenderInput } from "claude-code";

import { linksIn } from "../lib/text.mjs";
import type { Board, Snapshot, Task, View } from "../types";

import { cardTint, claudeSvg, faceSvg, idleButtonSvg, idleColor, markOf, outline, prioritySvg, stateLayer, tooltipBackground, tooltipText } from "./draw.ts";
import { startingFor } from "./start.ts";
import { changeView, say } from "./state.ts";

// The sections open at the start: all but the postponed tasks.
const openAtStart: Record<string, boolean> = { links: true, documents: true, doing: true, rest: true, postponed: false, issues: true, goals: true, decisions: true, specs: true, releases: true };
// How many rows a list shows before "show all".
const rows: Record<string, number> = { doing: 5, rest: 10, postponed: 5, issues: 5, goals: 5, open: 3 };
/** A picker's choice of none. */
export const noChoice = { value: "", label: "—" };

export type Panel = ReturnType<typeof panelOf>;

/** A text typed in a field, as a task's line holds it: on one line, trimmed. */
export function oneLine(value: string): string
{
    return value.replace(/\s+/g, " ").trim();
}

export function panelOf($: EngineInterface, e: RenderInput<"Pane">, board: Board, view: View, snapshot: Snapshot, now: number)
{
    const ui = $.ui.resolve(e);
    const { Box, Text, Button, Link } = ui;
    // The forms' fields, which the mobile app does not draw yet (its table lacks them, though resolve hands them out): there, no button
    // opens a form.
    const { Input, Select } = ui as Elements["desktop"];
    const hasForms = e.surface !== "mobile";
    // The drawings are the desktop's: the terminal draws text.
    const Svg = e.surface !== "terminal" && "Svg" in ui ? ui.Svg : null;
    const isDesktop = Svg !== null;
    const words = say(board);
    const prefix = snapshot.prefixes.task;
    const idOf = (task: { id: number }) => `${prefix}-${task.id}`;
    const byName = new Map(snapshot.colleagues.map((colleague) => [colleague.name, colleague]));
    const parts = new Map<string, Task[]>();

    for (const task of snapshot.tasks) {
        if (task.parent) {
            parts.set(task.parent, [...(parts.get(task.parent) ?? []), task]);
        }
    }

    // The open parts of a large task, in the backlog's order: looked up, not searched for in every task each time.
    const partsOf = (task: Task) => parts.get(idOf(task)) ?? [];
    // Who decides: the owner, else the first person who is not Claude.
    const owner = snapshot.owner;
    const decider = owner?.name ?? snapshot.people.find((person) => person !== "Claude") ?? null;
    const change = (fn: (old: View) => View) => changeView($, fn);
    const openIn = (state: View, section: string) => state.sections[section] ?? openAtStart[section] ?? false;
    const isOpen = (section: string) => openIn(view, section);
    const limited = <T,>(list: string, items: T[]) => (view.whole[list] ? items : items.slice(0, rows[list] ?? 3));
    const isStarting = (id: number) => now - (view.starting[`task-${id}`] ?? 0) < startingFor;
    // A space that never breaks: "2 g" stays on one line.
    const age = (day: string | null) => (day ? words("days", { days: Math.max(0, Math.round((Date.parse(snapshot.today) - Date.parse(day)) / 86_400_000)) }).replace(" ", " ") : "");
    const dueWords = (due: NonNullable<Task["dueInfo"]>) => (due.isLate ? words("dueLate", { days: -due.days }) : due.days === 0 ? words("dueToday") : words("dueIn", { days: due.days }));
    // A task's text on its row: its links' words in place of their addresses' markup.
    const rowText = (text: string) => linksIn(text).map((part) => (typeof part === "string" ? part : part.label)).join("");
    // A task's text once it is open: each link a link a click opens, whole, underscores and all.
    const linkedText = (key: string, text: string) => (
        <Text key={key}>{linksIn(text).map((part, at) => (typeof part === "string" ? part : <Link key={`${key}-link-${at}`} href={part.href} label={part.label} />))}</Text>
    );
    // A row's title, which opens it in place and closes it again.
    const opener = (buttonKey: string, key: string, text: string, color?: string) => (
        <Button key={buttonKey} plain onPress={() => change((old) => ({ ...old, expanded: old.expanded === key ? null : key }))}>
            <Text wrap="truncate-end" color={color}>{`${view.expanded === key ? "▾" : "▸"} ${text}`}</Text>
        </Button>
    );
    // Material's outlined card, faintly gray, with the state layer under the pointer, as Crew's.
    const card = (key: string, children: (JSX.Element | null)[]) => (
        <Box key={key} flexDirection="column" borderStyle="round" {...(isDesktop ? { borderColor: outline } : { borderDimColor: true })} paddingX={1} {...(isDesktop ? { backgroundColor: cardTint, hover: { backgroundColor: stateLayer } } : {})}>
            {children}
        </Box>
    );
    // A section: its heading, which opens and closes it, and what it holds, one row of room between them.
    const section = (key: string, icon: string, title: string, items: (JSX.Element | null)[], after: JSX.Element | null = null) => (
        <Box key={key} flexDirection="column" gap={1}>
            <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center">
                <Button key={`toggle-${key}`} plain label={`${isOpen(key) ? "▾" : "▸"} ${icon} ${title}`} onPress={() => change((old) => ({ ...old, sections: { ...old.sections, [key]: !openIn(old, key) } }))} />
                {after}
            </Box>
            {isOpen(key) ? items : null}
        </Box>
    );
    const more = (list: string, count: number, label: "showAllTasks" | "showAllDecisions") => (count > (rows[list] ?? 3) && !view.whole[list]
        ? <Button key={`more-${list}`} plain dimColor label={words(label, { count })} onPress={() => change((old) => ({ ...old, whole: { ...old.whole, [list]: !old.whole[list] } }))} />
        : null);
    // A hint under the pointer, above the control so that the card does not cut it; the terminal draws none.
    const tip = (key: string, hint: string, control: JSX.Element) => (isDesktop
        ? (
            <Box key={`tip-${key}`} flexShrink={0}>
                {control}
                <Box position="absolute" bottom={1} right={0} display="none" hover={{ display: "flex" }} backgroundColor={tooltipBackground} borderStyle="round" borderColor={outline} paddingX={1}>
                    <Text color={tooltipText}>{hint}</Text>
                </Box>
            </Box>
        )
        : control);
    // A chip is one line high: a tinted background, no border; in brackets on the terminal. A link, or a text with a hint.
    const chip = (key: string, text: string, color?: string, href?: string | null, hint?: string) => {
        const label = href ? <Link key={`${key}-link`} href={href}>{text}</Link> : <Text key={`${key}-text`} color={color} dimColor={!color}>{text}</Text>;
        const drawn = isDesktop
            ? <Box key={key} flexShrink={0} paddingX={1} backgroundColor={color ? `${color}26` : stateLayer}>{label}</Box>
            : <Box key={key} flexShrink={0}>{href ? label : <Text color={color} dimColor={!color}>{`[${text}]`}</Text>}</Box>;
        return hint ? tip(key, hint, drawn) : drawn;
    };
    // A button that cannot be pressed now keeps its place, dim, but no Button at all: no pointer, no focus, no press; its reason, when it
    // has one, under the pointer. On the desktop a drawing of its buttons, as high and as round, on a gray ground (a Box with a border
    // would be three lines high, one without has square corners); `[ label ]` on the terminal; a plain one its label alone.
    const idleButton = (key: string, label: string, reason?: string, isPlain = false) => {
        const pill = Svg && !isPlain ? idleButtonSvg(label) : null;
        const drawn = isPlain
            ? <Box key={key} flexShrink={0}><Text color={idleColor}>{label}</Text></Box>
            : Svg && pill
                ? <Box key={key} flexShrink={0}><Svg source={pill.source} alt={label} width={pill.width} height={pill.height} /></Box>
                : <Box key={key} flexShrink={0}><Text color={idleColor}>{`[ ${label} ]`}</Text></Box>;
        return reason ? tip(key, reason, drawn) : drawn;
    };
    // Whether this chat's own turn runs: the buttons that write to it wait until it ends.
    const isWorking = Boolean(board.working);
    // A button that writes to this chat, a prompt or a command: while its turn runs, idle in its place, «-idle» after its key.
    const chatButton = (key: string, label: string, onPress: () => unknown, look: { variant?: "primary"; plain?: true; dimColor?: boolean } = {}) => (isWorking
        ? idleButton(`${key}-idle`, label, words("busyTurn"), Boolean(look.plain))
        : <Button key={key} label={label} onPress={() => void onPress()} {...look} />);
    // Who holds a task: Claude's critter, a colleague's portrait or initials, the owner's GitHub picture, a person's initials in gray.
    const face = (name: string, size: number) => {
        const member = byName.get(name) ?? (owner && name === owner.name ? { id: name, name, fullName: owner.fullName, role: "", color: "gray", portrait: owner.portrait } : undefined);

        if (!Svg) {
            return <Text key={`face-${name}`} color={member?.color} dimColor={!member}>●</Text>;
        }

        const source = name === "Claude" ? claudeSvg(size) : faceSvg(member ?? { id: name, name, fullName: name, role: "", color: "gray" }, member?.portrait, size);
        return <Svg key={`face-${name}`} source={source} alt={member?.fullName ?? name} width={size} height={size} />;
    };
    // A priority's mark, drawn on the desktop, its glyph on the terminal.
    const priorityIcon = (priority: string) => {
        const drawn = Svg ? prioritySvg(priority) : undefined;
        return Svg && drawn ? <Svg source={drawn} alt={priority} width={14} height={14} /> : <Text color={markOf(priority).color}>{markOf(priority).glyph}</Text>;
    };

    return { Box, Text, Button, Link, Input, Select, hasForms, Svg, isDesktop, board, view, snapshot, now, words, prefix, idOf, byName, partsOf, decider, change, isOpen, limited, isStarting, age, dueWords, rowText, linkedText, opener, card, section, more, tip, chip, idleButton, isWorking, chatButton, face, priorityIcon };
}
