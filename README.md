# herdr-sync-panes

A [Herdr](https://herdr.dev) mod: type once, into every terminal of a tab, like tmux's `synchronize-panes`. (It was called Broadcast before.)

![Sync panes](sync-panes/preview.png)

- `ctrl-t e` starts syncing in the shown tab; a small "Sync N · <tab>" pill sits in the tab bar. That's this mod's default: tmux has no default key for `synchronize-panes`, so pick your own (below).
- `ctrl-t shift-e` (or the pill's ✕) stops it. Showing another tab stops it too.
- Your other prefix keys keep working, as in tmux: with Herdr's `ctrl-t n` bound to `tab.next`, it goes to the next tab instead of typing `n`.
- `ctrl-t a` types a literal `ctrl-t` into every terminal, like tmux's `send-prefix` (from the `mod:sync-panes` section of `keys.json`).
- Cmd-V pastes the clipboard into every terminal.
- What the pill shows is what it sends: when it says Paused, failed or is gone, nothing still queued is typed anywhere.

## How it differs from tmux

- **The pill holds the keyboard.** Herdr gives mods no way to listen to a terminal's own input, so you type into the pill and it types into the panes. Click a terminal to type into just that one ("Paused"); click the pill to sync again.
- **Japanese and other IME input** doesn't reach the pill; paste it with Cmd-V.
- **It needs `python3`.** Keys are typed by a small helper, `send.py`, that attaches to each terminal through `hc connect` and writes what the key sends there, encoded for the program's keyboard mode. That's how `|`, `"` and non-ASCII go without the clipboard and without the ~3 s wait `hc keys` keeps after a person types.
- **Zoom:** like tmux, panes you can't see don't get keys.

See [`sync-panes/RECIPE.md`](sync-panes/RECIPE.md) for exactly what it does, how it's built and its limits.

## Install

Ask your agent to add it (it reads `~/.config/herdr-app/AGENTS.md` and the recipe; it renames the mod if the name is taken), or by hand:

```sh
dest=~/.config/herdr-app/mods/sync-panes
if [ -e "$dest" ]; then
  echo "$dest already exists: remove it or install under another name"
else
  cp -R sync-panes/mods/sync-panes "$dest" && herdr-app check "$dest"
fi
```

Then merge [`sync-panes/keys.json`](sync-panes/keys.json) into `~/.config/herdr-app/keys.json`. Check that nothing else already uses those keys; if your prefix isn't `ctrl-t`, change it in both lines. The mod takes its prefix from the `sync-panes.stop` binding, so nothing in `main.js` needs editing. Installing under another folder name means renaming `sync-panes` in `mod.json`'s `key`, in `main.js` (`mod:sync-panes`, `sync-panes.stop`, `mod.open:sync-panes`, `mods/sync-panes/send.py`) and in your keys.

## What it runs

`python3 send.py`, which runs `hc connect` to type into the terminals (and `hc keys` for the rare key it can't encode itself). It reads no files and makes no network requests.

## License

MIT
