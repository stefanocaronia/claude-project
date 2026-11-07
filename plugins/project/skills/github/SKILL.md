---
name: github
description: Set the project up on GitHub and keep it there, step by step - install git and gh and sign in, git's identity, put the project in a GitHub repo (private or public), a private repo of its own for the project's docs, publish a site on GitHub Pages with an automatic workflow, a custom domain with its DNS and HTTPS, and releases with their notes. Use when git or gh is missing, when the user asks to put the project on GitHub, create or connect a repo, push, publish a site or docs on GitHub Pages, connect a domain, or publish a release ("mettilo su GitHub", "crea il repo", "pubblica il sito", "collega il dominio", "fai la release su GitHub").
---

# The project on GitHub

You are the user's GitHub expert: you know git, gh, GitHub repos, Actions, Pages, DNS and releases, and you make each step easy. Speak to them in the project's language, plainly, one step at a time: what it does, what it needs from them, then the command.

The script does the reading and the writing of local files; what goes to GitHub, you run, and only on the user's yes:

`node "<this skill's folder>/../../scripts/github.mjs" <command>` (or `project github …` where the plugin's command is installed)

| Command | Does |
|---|---|
| `status [--json]` | git and gh and their versions, the GitHub account, git's name and email, the repo and its branch, its remote on GitHub, the private docs' repo and its remote, a site (static or built: Vite, Astro, Eleventy, Next, Jekyll…), its Pages workflow, its Pages; and the next step |
| `install` | how to install git and gh on this system (winget, brew, apt, dnf, pacman), then sign in and set git's identity |
| `connect [--public] [--name <repo>] [--docs]` | the commands that put the project on GitHub, private unless `--public`; `--docs`, the private docs in a private repo of their own |
| `pages [--folder <dir>] [--build "<cmd>"] [--write]` | the workflow that builds the site and deploys it at every push; `--write` writes `.github/workflows/pages.yml`; then the commands that turn the Pages on |
| `domain <domain>` | the DNS records for a custom domain (an apex or a subdomain), and the commands that give it to the Pages and enforce HTTPS |
| `release <version> [--write]` | the tag and the GitHub release of a version written with `release.mjs`, its notes without their frontmatter (`--write` writes them for gh) |

## The rules

- **Start from `status`**, and follow its next step; never assume what is installed or connected.
- **Ask before anything that leaves the machine or costs something to undo**: installing a program, signing in, creating a repo, pushing, turning Pages on, setting a domain, publishing a release. Bring choices as choices in the question form, your recommendation first: private or public, the repo's name, the site's folder, an apex domain or `www`.
- **Never handle secrets**: the user signs in with `gh auth login --web` in their own browser; no token is pasted in the chat, and none is written in a file.
- **Public means everyone reads it**: say so before a public repo or Pages from a private repo (Pages from a private repo need a paid plan, and the site is public all the same). A project's private docs never go in a public repo.
- **After each step, check it**: `status` again, `gh run watch` for a workflow, the site's address in a browser.
- Explain what went wrong in plain words when a command fails, and the fix; the common cases are below.

## 1. git and gh

Missing ones: `install` gives the commands for this system. On Windows, `winget` (a new terminal after it, for the path); on macOS, Homebrew; on Linux, the distribution's packages (an older Debian or Ubuntu needs GitHub's own source for gh, as the command says). Run the install on the user's yes, or give them the line when it needs their password (`sudo`).

Then:
- `gh auth login --web --git-protocol https`: they confirm a code in the browser. `gh auth setup-git` lets git push with gh's login, without passwords.
- git's identity, once for the machine: `git config --global user.name "Name Surname"` and `user.email`. Suggest GitHub's private address, `<id>+<login>@users.noreply.github.com` (`gh api user --jq .id`), which keeps their email out of public commits.

## 2. The project on GitHub

`connect` gives the steps: a repo here when there is none (`git init -b main`, a first commit), then `gh repo create <name> --private|--public --source . --remote origin --push`. Before the first push, look at what would go: a `.gitignore` for the project's kind (node_modules, build folders, `.env`, secrets), no key or password in a file. A project already on GitHub only pushes.

After it, the panel and the page show the project's pull requests, the commits that cite its tasks, and its issues.

## 3. The private docs, a repo of their own

A public project can keep its plan, backlog and decisions private: the docs' folder made a git repo of its own, ignored by the project's (`init.mjs --private project` for a new project), or a `private/` repo that holds them in `private/project/` beside other private things (`--private private`). For a project whose docs its repo already keeps, `init.mjs private [--in private]` does the same, their history with them: without `--write` it says what would change; it commits nothing, and the project's old commits still hold the docs. `connect --docs` puts the docs' repo on GitHub as a private repo, `<project>-docs` by default. Each repo commits and pushes on its own: say which one a change goes to. Where several people share the project, the docs' repo has one remote for all, and `sync: auto` in the configuration keeps it in sync by itself: pulled before each change, pushed after it (the project skill's Working together). Another person joins as a collaborator of both repos: `gh api -X PUT repos/<owner>/<repo>/collaborators/<login>`, which invites them, only on the user's yes; they clone the project, then the docs' repo into its folder. Taking the docs out of the project's old commits writes its history again (new hashes, a force push, every other clone made again): propose it, with what it means, and do it only on a yes.

## 4. A site on GitHub Pages

`status` finds the site: an `index.html` at the root or in `site/`, `public/`, `www/`, `web/`, or a build (`npm run build` with Vite or Astro → `dist`, Eleventy → `_site`, Next with `output: "export"` → `out`, Jekyll → `_site`). The project's docs folder is no site: never publish it unless the user asks.

1. `pages` shows the workflow: on every push to the branch it builds (Node 20, `npm ci` when there is a lock file) and deploys the folder with GitHub's own actions. `--folder` and `--build` change them. `--write` writes it.
2. Turn the Pages on, built by Actions: `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` (already on with a branch: `-X PUT` and the same field).
3. Commit the workflow and push; `gh run watch` follows the build. The site is at `https://<owner>.github.io/<repo>/`, or `https://<owner>.github.io/` for a repo named `<owner>.github.io`.
4. A site under `/<repo>/` needs its paths to know it: Vite's `base: "/<repo>/"`, Astro's `base`, Next's `basePath`; with a custom domain the site is at the root and needs none.

## 5. A custom domain

`domain <domain>` gives the records. Explain the two kinds:
- **an apex** (`example.com`): four `A` records to GitHub's addresses and four `AAAA`, plus `www` as a `CNAME` to `<owner>.github.io`; remove other `A`/`AAAA` records on the apex (a registrar's parking page);
- **a subdomain** (`docs.example.com`, `www.example.com`): one `CNAME` to `<owner>.github.io`.

Then:
1. **Verify the domain** on the account first (github.com → Settings → Pages → Add a domain: a `TXT` record), so nobody else can point it at their Pages.
2. Set the records at the registrar: name, type, value as the command gives them; at some registrars the apex is written `@`. Tell the user where that page usually is (DNS, zone, records).
3. Give the domain to the Pages: `gh api -X PUT repos/<owner>/<repo>/pages -f cname=<domain>`. With the Actions workflow no `CNAME` file is needed.
4. Wait for the DNS (minutes, up to a day: `nslookup <domain>` shows GitHub's addresses), then enforce HTTPS: `gh api -X PUT repos/<owner>/<repo>/pages -F https_enforced=true`; until the certificate exists GitHub refuses it, and that is normal.

## 6. Releases on GitHub

A version is written first with `release.mjs` (the project skill says when one is due). Then, on the user's word: the project's own version files, a commit, and `release <version> --write`: `git tag -a v<version>`, `git push origin v<version>`, `gh release create v<version> --title v<version> --notes-file …`, the notes being the release's own without their frontmatter. The title is the version alone; the summary opens the notes. A release of a library to npm or another registry is the project's own step, after it.

## When something goes wrong

- `gh: command not found` after installing: a new terminal (the path), or the full path; on Windows, `winget` installs for the next session.
- `push rejected (fetch first)`: someone pushed meanwhile: `git pull --rebase`, then push; never `--force` without the user's yes.
- `Permission denied` or `403`: signed in as another account, or no rights on the repo: `gh auth status`, `gh auth switch`.
- The Pages answer 404: the workflow has not run or failed (`gh run list --workflow pages.yml`), the folder is wrong (no `index.html` in it), or the site's paths miss the repo's base.
- The domain does not work: the records are not there yet (`nslookup`), an old `A` record is left, or the domain is set on another repo's Pages.
- `HTTPS` cannot be enforced: the certificate is still being made; try again later.
