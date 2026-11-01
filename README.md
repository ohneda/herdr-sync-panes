# herdr-sync-panes

A [Herdr](https://herdr.dev) mod: type once, into every terminal of a tab, like tmux's `synchronize-panes`.

![Sync panes](sync-panes/preview.png)

- `ctrl-t e` starts syncing in the shown tab; a small "Sync N · <tab>" pill sits in the tab bar. That's this mod's default: tmux has no default key for `synchronize-panes`, so pick your own (below).
- `ctrl-t shift-e` (or the pill's ✕) stops it. Showing another tab stops it too.
- Your multi-key bindings keep working, as tmux's prefix keys do: with `ctrl-t n` bound to `tab.next` in your `keys.json`, it goes to the next tab instead of typing `n`.
- `ctrl-t a` types a literal `ctrl-t` into every terminal, like tmux's `send-prefix` (from the `mod:sync-panes` section of `keys.json`).
- Cmd-V pastes the clipboard into every terminal.
- What the pill shows is what it sends: when it says Paused, failed or is gone, nothing still queued is typed anywhere.

## How it differs from tmux

- **The pill holds the keyboard.** Herdr gives mods no way to listen to a terminal's own input, so you type into the pill and it types into the panes. Click a terminal to type into just that one ("Paused"); click the pill to sync again.
- **It needs Python 3.** Keys are typed by a small helper, `send.py`, that attaches to each terminal through `hc connect` and writes what the key sends there, encoded for the program's keyboard mode. That's how `|`, `"` and non-ASCII go without the clipboard and without the ~3 s wait `hc keys` keeps after a person types.
- **Zoom:** like tmux, panes you can't see don't get keys.

## Limits

- **Cursors look inactive.** While syncing, no terminal has the keyboard, so Herdr draws every cursor hollow (□ rather than ■).
- **No IME input.** Japanese and other composed text don't reach the pill; paste them with Cmd-V.
- **A key right after a pane move goes to one pane.** Herdr runs a pane-moving binding (`ctrl-t h` bound to `pane.go:left`) itself; the pill takes the keyboard back a few tens of milliseconds later, and a key typed in between goes only to the pane you moved to.
- **`send:` and `terminal` bindings need a second line.** While syncing, the pill has the keyboard, not a terminal: a `send:` binding in `global` types into no terminal, and the `terminal` section doesn't apply (`alt-left` bound there to `send:\u001bb` goes as a plain Alt+Left, and Cmd keys other than Cmd-V do nothing). Bind the key again in `mod:sync-panes` to `sync-panes.send:<text>`, as `keys.json` does for `ctrl-t a`.
- **Python 3, and tried on macOS only.** Typing needs Python 3 (`python3` or `python`; on Windows `py -3` first). On Linux, pasting is Super+V; on Windows, programs that ask for win32 input mode may not get keys right.

## What Herdr would need

This mod works around what a mod can't do today. The real thing would be synchronize-panes in Herdr itself: the focused terminal keeps the keyboard, and what you type also goes to the other terminals of the tab. Every limit above would go away.

Short of that, two things would let a mod get close:

- a way for a mod to see the input a terminal receives. You could keep typing in the pane, so the pill, the hollow cursors, the IME gap, the pane-move gap and the second `send:` line would all go;
- a way for a mod to type into a given terminal: text and keys, in order, without moving focus, resizing, touching the clipboard or waiting for `hc`'s ~3 s of quiet. `send.py`, and with it Python, would go.

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

Then merge [`sync-panes/keys.json`](sync-panes/keys.json) into `~/.config/herdr-app/keys.json`. Check that nothing else already uses those keys, and pick others if it does: single keys (`cmd-shift-e`) or sequences (`ctrl-b e`) both work. The mod reads its bindings from `keys.json`, so nothing in `main.js` needs editing. Installing under another folder name means renaming `sync-panes` in `mod.json`'s `key`, in `main.js` (`mod:sync-panes`, `sync-panes.stop`, `mod.open:sync-panes`, `mods/sync-panes/send.py`) and in your keys.

## What it runs

Python (`send.py`), which runs `hc connect` to type into the terminals (and `hc keys` for the rare key it can't encode itself). It reads no files and makes no network requests.

## License

MIT
