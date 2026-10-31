# herdr-sync-panes

A [Herdr](https://herdr.dev) mod: type once, into every terminal of a tab, like tmux's `synchronize-panes`.

![Sync panes](sync-panes/preview.png)

- `ctrl-t e` starts syncing in the shown tab; a small "Sync N · <tab>" pill sits in the tab bar.
- `ctrl-t shift-e` (or the pill's ✕) stops it. Showing another tab stops it too.
- Your other prefix keys keep working, as in tmux: `ctrl-t n` goes to the next tab instead of typing `n`.
- Cmd-V pastes the clipboard into every terminal.
- If sending to any terminal fails, nothing more is typed until you click the pill.

See [`sync-panes/RECIPE.md`](sync-panes/RECIPE.md) for exactly what it does, how it's built and its limits.

## Install

Ask your agent to add it (it reads `~/.config/herdr-app/AGENTS.md` and the recipe), or by hand:

```sh
cp -R sync-panes/mods/sync-panes ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/sync-panes
```

Then merge [`sync-panes/keys.json`](sync-panes/keys.json) into `~/.config/herdr-app/keys.json`. If your prefix isn't `ctrl-t`, change it in those two lines; the mod takes its prefix from the `sync-panes.stop` binding, so nothing in `main.js` needs editing.

## What it runs

The mod runs `hc keys` to type into terminals. Characters `hc keys` can't name (shifted symbols, non-ASCII) go through the clipboard (macOS: `pbpaste`, `osascript`): it's marked Transient/Concealed so clipboard managers skip it, and your previous clipboard text is restored. Avoid typing secrets while syncing. It reads no files and makes no network requests.

## License

MIT
