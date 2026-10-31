// Comma-separated values, as spreadsheets write them: a header row of names, a field quoted when it holds a comma, a quote or a line
// break, a quote inside doubled. Pure.

/** Rows of objects as CSV, the columns in the order given, a missing value empty. */
export function toCsv(rows, columns)
{
    const field = (value) => {
        const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return `${[columns.map(field).join(","), ...rows.map((row) => columns.map((column) => field(row[column])).join(","))].join("\n")}\n`;
}

/** CSV as objects, one a row, by the names of its header; an empty row left out. */
export function parseCsv(text)
{
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const source = String(text).replace(/^﻿/, "");

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (quoted) {
            if (char === '"' && source[index + 1] === '"') {
                field += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            row.push(field);
            field = "";
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && source[index + 1] === "\n") {
                index++;
            }

            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += char;
        }
    }

    if (field !== "" || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    const [header = [], ...body] = rows.filter((one) => one.some((value) => value.trim() !== ""));
    const names = header.map((name) => name.trim());
    return body.map((values) => Object.fromEntries(names.map((name, index) => [name, (values[index] ?? "").trim()])));
}
