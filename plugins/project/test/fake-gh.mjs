// The tests' stand-in for gh (PROJECT_FAKE_GH): the issues, the pull requests, the user and the collaborators of a repo kept in the JSON file FAKE_GH_STATE,
// each call written in its `calls`. Only what the plugin asks of gh.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.FAKE_GH_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const [noun, verb, target] = args;
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const issue = () => state.issues.find((one) => one.number === Number(target)) ?? fail(`no issue ${target}`);
state.calls = [...(state.calls ?? []), args.join(" ")];

function fail(message)
{
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

if (state.offline) {
    fail("error connecting to api.github.com");
}

if (noun === "api" && verb === "user") {
    console.log(option("--jq") === ".login" ? state.me : JSON.stringify({ name: state.name ?? state.me, login: state.me, avatar: null }));
} else if (noun === "api" && verb.endsWith("/collaborators")) {
    console.log(JSON.stringify(state.collaborators));
} else if (noun === "pr" && verb === "list") {
    console.log(JSON.stringify(state.pulls ?? []));
} else if (noun === "pr" && verb === "view") {
    console.log(JSON.stringify((state.pulls ?? []).find((one) => one.number === Number(target)) ?? fail(`no pull request ${target}`)));
} else if (noun === "pr" && verb === "close") {
    ((state.pulls ?? []).find((one) => one.number === Number(target)) ?? fail(`no pull request ${target}`)).state = "CLOSED";
} else if (noun === "issue" && verb === "list") {
    console.log(JSON.stringify(state.issues));
} else if (noun === "issue" && verb === "view") {
    console.log(JSON.stringify(issue()));
} else if (noun === "issue" && verb === "edit") {
    const one = issue();
    const all = (name) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []));
    const login = (value) => (value === "@me" ? state.me : value);
    one.title = option("--title") ?? one.title;
    one.labels = [...one.labels.filter((label) => !all("--remove-label").includes(label.name)), ...all("--add-label").map((name) => (state.labels.includes(name) ? { name } : fail(`label ${name} not found`)))];
    one.assignees = [...one.assignees.filter((assignee) => !all("--remove-assignee").map(login).includes(assignee.login)), ...all("--add-assignee").map((value) => ({ login: login(value) }))];
    one.milestone = args.includes("--remove-milestone") ? null : option("--milestone") ? (state.milestones.includes(option("--milestone")) ? { title: option("--milestone") } : fail("milestone not found")) : one.milestone;
} else if (noun === "label" && verb === "list") {
    console.log(JSON.stringify(state.labels.map((name) => ({ name }))));
} else if (noun === "label" && verb === "create") {
    state.labels.push(target);
} else if (noun === "api" && verb.includes("/milestones")) {
    args.includes("-f") ? state.milestones.push(option("-f").replace(/^title=/, "")) : console.log(JSON.stringify(state.milestones));
} else if (noun === "issue" && verb === "close") {
    Object.assign(issue(), { state: "CLOSED", stateReason: option("--reason") === "not planned" ? "NOT_PLANNED" : "COMPLETED", closedAt: "2026-11-02T10:00:00Z", comment: option("--comment") });
} else if (noun === "issue" && verb === "reopen") {
    Object.assign(issue(), { state: "OPEN", stateReason: "REOPENED", closedAt: null, comment: option("--comment") });
} else {
    fail(`fake gh does not know: ${args.join(" ")}`);
}

writeFileSync(file, JSON.stringify(state, null, 1));
