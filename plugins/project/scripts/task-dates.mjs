// Gives every checkbox task without a creation date the day its line first appeared in git: node task-dates.mjs [--write]
// The lines are the plan's and the colleagues' todos, as Crew writes them.
import { dirname } from "node:path";
import { formatTodo, parseTodo, todoKey } from "../lib/todos.mjs";
import { git, isMain, loadProject, read, realPath, runCli, shown, today, todoFiles, write } from "./project.mjs";

const keyLengths = [48, 24];

/** The files with tasks that have no date, and how many, as shown paths; with write, the dates written from git. */
export function dateTasks(config, shouldWrite)
{
    const dated = [];

    for (const path of [config.files.plan, ...todoFiles(config).map((one) => one.file)]) {
        const text = read(path);
        const newline = text.includes("\r\n") ? "\r\n" : "\n";
        const lines = text.split(/\r?\n/);
        const undated = lines.map((line, index) => [index, parseTodo(line)]).filter(([, task]) => task && !task.created);

        if (undated.length === 0) {
            continue;
        }

        dated.push({ file: shown(config, path), count: undated.length });

        if (!shouldWrite) {
            continue;
        }

        const firstSeen = firstSeenDays(path);
        const blame = blameDays(path);

        for (const [index, task] of undated) {
            task.created = keyLengths.map((length) => firstSeen.get(`${length}:${todoKey(task.text, length)}`)).find(Boolean) ?? blame[index] ?? today();
            lines[index] = formatTodo(task);
        }

        write(path, lines.join(newline));
    }

    return dated;
}

if (isMain(import.meta.url)) {
    runCli(() => {
        const { config, say } = loadProject();
        const shouldWrite = process.argv.includes("--write");
        const dated = dateTasks(config, shouldWrite);
        const total = dated.reduce((sum, entry) => sum + entry.count, 0);
        dated.forEach((entry) => console.log(`${entry.file}: ${entry.count}`));
        console.log(say(shouldWrite ? "dated" : "wouldDate", { count: total }));
    });
}

/** For each key of a task's text, the first day a line with it was added to the file, in the history of the repo that holds it. */
function firstSeenDays(path)
{
    const days = new Map();
    let day = null;

    for (const line of gitOn(path, ["log", "--reverse", "--format=@@%ad", "--date=short", "-U0", "--", path]).split("\n")) {
        if (/^@@\d{4}-/.test(line)) {
            day = line.slice(2, 12);
            continue;
        }

        const task = line.startsWith("+") ? parseTodo(line.slice(1)) : null;

        if (!task || !day) {
            continue;
        }

        for (const length of keyLengths) {
            const key = `${length}:${todoKey(task.text, length)}`;

            if (!days.has(key)) {
                days.set(key, day);
            }
        }
    }

    return days;
}

/** The day git blame gives each line of the file, by index; none for lines not committed yet. */
function blameDays(path)
{
    const days = [];
    let current = null;

    for (const line of gitOn(path, ["blame", "--line-porcelain", "--", path]).split("\n")) {
        if (line.startsWith("author-time ")) {
            current = today(new Date(Number(line.slice(12)) * 1000));
        } else if (line.startsWith("\t")) {
            days.push(current);
        }
    }

    return days;
}

/** git on a file, from the folder it really is in: a docs folder may be a repo of its own, nested and ignored, reached through a link. */
function gitOn(file, args)
{
    const path = realPath(file);
    return git(dirname(path), args.map((arg) => (arg === file ? path : arg)));
}
