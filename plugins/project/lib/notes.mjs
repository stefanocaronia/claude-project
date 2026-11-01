// A task's note, <docs>/tasks/T-12.md: its own text, what Claude keeps of the work, and the comments people leave on the task, under
// «## Comments», each «### <day> · <who>» and its text, the oldest first. Claude reads them with the task, as the people's words on it.

export const commentsHeading = "## Comments";

/** The comments of a note, the oldest first: { day, by, text }. A line of a comment that opens with # is kept escaped in the file, so
 * that it never reads as a heading; here it is itself again. */
export function parseComments(note)
{
    const lines = String(note ?? "").replaceAll("\r\n", "\n").split("\n");
    const start = lines.findIndex((line) => line.trim() === commentsHeading);

    if (start === -1) {
        return [];
    }

    const comments = [];

    for (const line of lines.slice(start + 1)) {
        if (/^## /.test(line)) {
            break;
        }

        const head = /^### (\d{4}-\d{2}-\d{2}) · (.+?)\s*$/.exec(line);

        if (head) {
            comments.push({ day: head[1], by: head[2], lines: [] });
        } else if (comments.length > 0) {
            comments.at(-1).lines.push(line.replace(/^\\#/, "#"));
        }
    }

    return comments.map(({ day, by, lines: body }) => ({ day, by, text: body.join("\n").trim() }));
}

/** Whether a note says more than its title and its comments: a note made by a comment holds nothing the task does not show already. */
export function hasBody(note)
{
    const lines = String(note ?? "").replaceAll("\r\n", "\n").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
    const start = lines.findIndex((line) => line.trim() === commentsHeading);
    const next = lines.findIndex((line, index) => start !== -1 && index > start && /^## /.test(line));
    const kept = start === -1 ? lines : [...lines.slice(0, start), ...(next === -1 ? [] : lines.slice(next))];
    return kept.some((line) => line.trim() !== "" && !/^# /.test(line));
}

/** A note with a comment added at the end of its comments, the section made at the note's end when it has none; the rest of the note
 * as it was. */
export function withComment(note, { day, by, text })
{
    const lines = String(note ?? "").replaceAll("\r\n", "\n").replace(/\n+$/, "").split("\n");
    const block = [`### ${day} · ${by}`, "", ...String(text).replaceAll("\r\n", "\n").trim().split("\n").map((line) => line.replace(/^#/, "\\#"))];
    const start = lines.findIndex((line) => line.trim() === commentsHeading);

    if (start === -1) {
        return `${[...lines, "", commentsHeading, "", ...block].join("\n")}\n`;
    }

    const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
    const end = next === -1 ? lines.length : next;
    const before = lines.slice(0, end);

    while (before.length > start + 1 && before.at(-1).trim() === "") {
        before.pop();
    }

    return `${[...before, "", ...block, ...(next === -1 ? [] : ["", ...lines.slice(end)])].join("\n")}\n`;
}
