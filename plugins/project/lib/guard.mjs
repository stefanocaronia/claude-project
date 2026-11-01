// The core docs the plugin's scripts own, kept from a direct read or write: through backlog.mjs, decisions.mjs and specs.mjs a lookup
// reads the same every time and costs a few lines in place of a file. The backlog and its archive are the backlog's alone; the
// decisions and the specs are searched through their scripts and read whole only to be edited. And the user's yes the panel and the
// page give the backlog's command, --approved, is never Claude's to give (D-16). Pure: the panel's hook asks it of each tool call, with
// the files from snapshot.mjs.

// The programs that read, search or write a file's text from a shell.
const textPrograms = /^(grep|egrep|fgrep|rg|ag|ack|cat|bat|head|tail|less|more|sed|awk|gawk|perl|nl|cut|sort|uniq|tac|type|findstr|select-string|sls|get-content|gc|set-content|add-content|out-file|tee|tee-object|python|python3|py)$/i;

/** What a tool call does to a guarded doc: { key, file, script } for the message that sends Claude to the script, or null when it may go;
 * the backlog's command given the user's --approved, { key: "guardApproved" }. `files` are the docs the scripts own, each { path,
 * script, owned }, the path relative to the project's root. */
export function guardCall(call, files)
{
    const refuse = (file) => ({ key: file.owned ? "guardOwned" : `guardSearch_${file.script}`, file: file.path, script: file.script });
    const hit = (path) => files.find((file) => names(path, file.path)) ?? null;
    const tool = call?.tool;

    if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
        const file = hit(call.file_path);
        // The decisions and the specs are read and edited by hand once their script has found the line.
        return file?.owned ? refuse(file) : null;
    }

    if (tool === "Grep") {
        const file = hit(call.path) ?? files.find((one) => typeof call.glob === "string" && call.glob.toLowerCase().includes(baseName(one.path))) ?? null;
        return file ? refuse(file) : null;
    }

    if (tool === "Bash" || tool === "PowerShell") {
        for (const segment of segments(String(call.command ?? ""))) {
            // The yes to another's issue the user gives with → Backlog: Claude asks the user to take it there.
            if (/backlog\.mjs\b/i.test(segment) && /(^|[\s'"])--approved\b/i.test(segment)) {
                return { key: "guardApproved", file: "", script: "backlog" };
            }

            const file = files.find((one) => mentions(segment, baseName(one.path)));

            if (file && (textPrograms.test(program(segment)) || isScript(segment) || isRedirect(segment, baseName(file.path)))) {
                return refuse(file);
            }
        }
    }

    return null;
}

/** Whether a path names a guarded file: the same path, one ending with it, or its bare name, relative to where the shell is. */
function names(path, file)
{
    if (typeof path !== "string" || path === "") {
        return false;
    }

    const given = path.replaceAll("\\", "/").toLowerCase().replace(/^\.\//, "");
    const target = file.toLowerCase();
    return given === target || given.endsWith(`/${target}`) || given === baseName(target);
}

/** A shell command's parts, each run on its own: cut at |, ||, &&, ; and a new line outside quotes. */
function segments(command)
{
    const parts = [""];
    let quote = null;

    for (let index = 0; index < command.length; index++) {
        const char = command[index];

        if (quote) {
            quote = char === quote ? null : quote;
        } else if (char === "'" || char === "\"") {
            quote = char;
        } else if ("|;\n".includes(char) || (char === "&" && command[index + 1] === "&")) {
            index += command[index + 1] === char ? 1 : 0;
            parts.push("");
            continue;
        }

        parts[parts.length - 1] += char;
    }

    return parts;
}

function baseName(path)
{
    return path.toLowerCase().split("/").at(-1);
}

function mentions(segment, name)
{
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s'"/\\\\=:<>])${escaped}(?=$|[\\s'"),;])`, "i").test(segment);
}

/** The program a shell segment runs: its first word past variables set before it, without folder or extension. */
function program(segment)
{
    const words = segment.trim().replace(/^[&.]\s+/, "").split(/\s+/).filter((word) => !/^\w+=/.test(word) && !/^(sudo|command|exec|time|xargs)$/.test(word));
    return (words[0] ?? "").replace(/^["']|["']$/g, "").replaceAll("\\", "/").split("/").at(-1).replace(/\.exe$/i, "");
}

/** A script given on the command line that reads the file itself: node -e, -p. */
function isScript(segment)
{
    return /^node$/i.test(program(segment)) && /\s(-e|-p|--eval|--print)\b/.test(segment);
}

function isRedirect(segment, name)
{
    return new RegExp(`>>?\\s*["']?[^\\s"']*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(segment);
}
