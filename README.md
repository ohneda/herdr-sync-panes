# herdr-broadcast

A [Herdr](https://herdr.dev) mod: type once, into every terminal of the shown tab, like tmux's `synchronize-panes`.

![Broadcast](broadcast/preview.png)

- `ctrl-t e` starts broadcasting; a small "Sync N" pill sits in the tab bar.
- `ctrl-t shift-e` (or the pill's ✕) stops it.
- Cmd-V pastes the clipboard into every terminal.

See [`broadcast/RECIPE.md`](broadcast/RECIPE.md) for exactly what it does, how it's built and its limits.

## Install

Ask your agent to add it (it reads `~/.config/herdr-app/AGENTS.md` and the recipe), or by hand:

```sh
cp -R broadcast/mods/broadcast ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/broadcast
```

Then merge [`broadcast/keys.json`](broadcast/keys.json) into `~/.config/herdr-app/keys.json`. If your prefix isn't `ctrl-t`, change the keys there and `PREFIX` / `PREFIX_HC` at the top of `main.js`.

## What it runs

The mod runs `hc keys` to type into terminals. Characters `hc keys` can't name (shifted symbols, non-ASCII) go through the clipboard (macOS: `pbpaste`, `osascript`): it's marked Transient/Concealed so clipboard managers skip it, and your previous clipboard text is restored. Avoid typing secrets while broadcasting. It reads no files and makes no network requests.

## License

MIT
