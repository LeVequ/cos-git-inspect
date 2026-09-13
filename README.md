# COS Git Inspect

`cos_git_inspect` is a small, read-only MCP server for inspecting explicitly allowed Git repositories. It exposes exactly two tools over stdio:

- `cos_git_status` returns the branch plus staged, unstaged, untracked, and conflicted paths.
- `cos_git_diff` returns an unstaged unified patch by default, or a staged patch when `staged` is `true`. Its optional `paths` array accepts repository-relative paths.

The server invokes Git directly with fixed argument arrays. It never uses a shell, accepts arbitrary Git flags, invokes external diff helpers, or enables text conversion. Every allowed repository is canonicalized at startup and every tool call must resolve to that exact top-level repository. Git has a 10-second timeout; status output is limited to 2 MiB and diff output to 1 MiB. A truncated diff says so in both its text and structured result.

## Build and test

Node.js 20 or newer and Git are required.

```powershell
cd cos_git_inspect
npm install
npm run check
```

## Configure Chat On Steroids

First build the server. Then open **Settings → Plugins → + → Custom executable** and configure:

- Executable: the absolute path to your Node.js executable (for example, `C:\Program Files\nodejs\node.exe` on Windows).
- Arguments: the absolute path to `cos_git_inspect\dist\server.js`, followed by `--repo` and an absolute repository root. Repeat `--repo <path>` to allow more repositories.

For example:

```text
C:\absolute\path\to\cos_git_inspect\dist\server.js
--repo
C:\work\first-repo
--repo
D:\work\second-repo
```

Arguments are separate values in the CoS plugin form; do not combine them into a shell command. CoS launches custom plugins from a plugin data directory, so use absolute paths for the server and repositories.

After saving, wait for the plugin to become **Ready**, then refresh the **Chat On Steroids Plugins** connector in ChatGPT so it discovers `cos_git_status` and `cos_git_diff`. CoS currently blocks external plugin calls while its global Read-only setting is enabled, even though both tools advertise MCP read-only annotations.

## Tool inputs

`cos_git_status`:

```json
{
  "repo_path": "C:\\work\\first-repo"
}
```

`cos_git_diff`:

```json
{
  "repo_path": "C:\\work\\first-repo",
  "staged": false,
  "paths": ["src", "README.md"]
}
```

Untracked files appear in `cos_git_status`; Git does not include their contents in an ordinary diff.
