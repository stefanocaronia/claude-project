# Contributing

Issues and pull requests are welcome. Keep each change small and say what it is for.

## Try it locally

Install from your clone, then start a new chat:

```
claude plugin marketplace add <your clone>
claude plugin install project@claude-project
```

Installed from a local folder, the plugin is read from there: after a change, `/reload-plugins`.

## Test

```
node --test "plugins/project/test/*.test.mjs"
claude plugin test plugins/project
claude plugin validate .
```

The page's test opens it in a headless Chrome or Edge (or the one `CHROME_PATH` names), and is skipped without one.

## Preview

```
node tools/screenshots.mjs    the README's pictures, from a small demo project
node tools/preview.mjs        the panel as the desktop app draws it, as an HTML page
```

## Rules

- **Words** the panel, the page and the messages show go in English and Italian, in `plugins/project/lib/messages.mjs`.
- **Behavior** Claude follows goes in the skills, under `plugins/project/skills/`.
- **Your own project** stays out: `/project/` and `/.claude/` are ignored.

## Release

1. Add the changes on top of [CHANGELOG.md](CHANGELOG.md).
2. Raise the version in `.claude-plugin/marketplace.json` and `plugins/project/.claude-plugin/plugin.json`.
3. Commit, tag and push: `git tag -a vX.Y.Z -m vX.Y.Z`, `git push --follow-tags`.
