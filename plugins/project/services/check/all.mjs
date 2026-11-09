// Every finding about the docs, from the errors to fix to the notes for the cleanup, each check's in its turn.
import { readDecisions } from "../docs.mjs";
import { shown } from "../files.mjs";
import { checkFrontmatter, checkIndex, checkMarkdown, checkNames, checkWeight } from "./markdown.mjs";
import { checkContracts, checkNumbering, checkReferences, checkRevisions, checkSpecs } from "./numbers.mjs";
import { checkBacklog, checkCode, checkIssues, checkLinks, checkOpen, checkPlan, checkTime, checkTodos } from "./work.mjs";

/** Every finding about the docs, from errors that must be fixed to notes for the cleanup: { severity, kind, file, line, message }. `code`,
 * the commits and pull requests by task when the caller has read them already. */
export function check(config, say, { code } = {})
{
    const findings = [];
    const add = (severity, kind, file, line, message) => findings.push({ severity, kind, file: file === null ? null : shown(config, file), line, message });
    const decisions = readDecisions(config).decided;

    checkNumbering(config, say, decisions, add);
    checkReferences(config, say, decisions, add);
    checkSpecs(config, say, add);
    checkContracts(config, say, add);
    checkRevisions(config, say, decisions, add);
    checkTodos(config, say, add);
    checkBacklog(config, say, add);
    checkLinks(config, say, add);
    checkCode(config, say, add, code);
    checkIssues(config, say, add);
    checkTime(config, say, add);
    checkPlan(config, say, add);
    checkOpen(config, say, add);
    checkMarkdown(config, say, add);
    checkIndex(config, say, add);
    checkNames(config, say, add);
    checkFrontmatter(config, say, add);
    checkWeight(config, say, add);

    return findings;
}
