// The health of the project docs: node check.mjs [--fix] [--json]. Read-only without --fix, which fixes whitespace and the docs' frontmatter.
import { check, fixFrontmatter, fixWhitespace } from "../services/check/index.mjs";
import { isMain, runCli } from "../services/cli.mjs";
import { loadProject } from "../services/config.mjs";
import { extensionChecks, loadExtensions } from "../services/extensions.mjs";

if (isMain(import.meta.url)) {
    runCli(async () => {
        const { config, say } = loadProject();

        if (process.argv.includes("--fix")) {
            const changed = fixWhitespace(config);
            console.log(changed.length > 0 ? say("fixed", { files: changed.join(", ") }) : say("fixedNone"));
            const stamped = fixFrontmatter(config);

            if (stamped.length > 0) {
                console.log(say("fixedFrontmatter", { files: stamped.join(", ") }));
            }
        }

        const findings = [...check(config, say), ...(await extensionChecks(config, say, await loadExtensions(config)))];

        if (process.argv.includes("--json")) {
            console.log(JSON.stringify(findings, null, 2));
        } else {
            printReport(findings, say);
        }

        process.exitCode = findings.some((finding) => finding.severity === "error") ? 1 : 0;
    });
}

function printReport(findings, say)
{
    for (const severity of ["error", "warning", "note"]) {
        const group = findings.filter((finding) => finding.severity === severity);

        if (group.length === 0) {
            continue;
        }

        console.log(`\n${say(`severity_${severity}`).toUpperCase()} (${group.length})`);

        for (const finding of group) {
            // An extension's findings go under its id.
            const kind = say(`kind_${finding.kind}`);
            console.log(`  [${kind === `kind_${finding.kind}` ? finding.kind : kind}] ${finding.file ?? ""}${finding.line ? `:${finding.line}` : ""}  ${finding.message}`);
        }
    }

    const errors = findings.filter((finding) => finding.severity === "error").length;
    console.log(`\n${say("summary", { errors, rest: findings.length - errors })}`);
}
