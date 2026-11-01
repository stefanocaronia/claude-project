// The project's contracts: numbers others read of it, apart from its version (an API for plugins, a file or save format, a protocol).
// Each is read from a file, by a JSON pointer into JSON or YAML, or by a regex whose one group is the number. Pure.
import { parse } from "./vendor/yaml/index.js";

/** A contract's number in a file's text, as a string ("7", "2.1"); null when the file does not hold it or it is no number. */
export function contractValue(text, contract)
{
    if (!text) {
        return null;
    }

    let value;

    if (contract.pattern) {
        value = new RegExp(contract.pattern, "m").exec(text)?.[1];
    } else {
        let data;

        try {
            data = /\.json$/i.test(contract.file) ? JSON.parse(text) : parse(text);
        } catch {
            return null;
        }

        value = pointerValue(data, contract.pointer);
    }

    return value !== undefined && value !== null && /^\d+(\.\d+)*$/.test(String(value).trim()) ? String(value).trim() : null;
}

/** What a JSON pointer names in a value: `/engine/api`, `~1` for a slash and `~0` for a tilde in a key; undefined when nothing. */
export function pointerValue(data, pointer)
{
    const keys = String(pointer).replace(/^\//, "").split("/").map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
    return keys.reduce((value, key) => (value !== null && typeof value === "object" && key in value ? value[key] : undefined), data);
}

/** Two contract numbers compared part by part, 2.10 after 2.9: negative, zero or positive. */
export function compareContract(first, second)
{
    const one = String(first).split(".").map(Number);
    const other = String(second).split(".").map(Number);

    for (let index = 0; index < Math.max(one.length, other.length); index++) {
        const difference = (one[index] ?? 0) - (other[index] ?? 0);

        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
}

/** A contract now and at the last release: { name, file, current, before, state }, state "raised", "lowered", "same", "new" (no number
 * at the last release, or no release) or "unread" (the file does not hold it now). */
export function contractState(contract, current, before)
{
    const state = current === null ? "unread" : before === null || before === undefined ? "new" : Math.sign(compareContract(current, before));
    return { name: contract.name, file: contract.file, current, before: before ?? null, state: { 1: "raised", "-1": "lowered", 0: "same" }[state] ?? state };
}
