# herdr-sync-panes

A [Herdr](https://herdr.dev) mod: type once, into every terminal of a tab, like tmux's `synchronize-panes`.

![Sync panes](sync-panes/preview.png)

- `ctrl-t e` starts syncing in the shown tab; a small "Sync N · <tab>" pill sits in the tab bar. `ctrl-t e` again, the pill's ✕, or showing another tab stops it.
- Every key you type goes to every terminal of that tab. When a pane is zoomed, only it gets keys.
- Your key bindings keep working: with `ctrl-t n` bound to `tab.next`, it goes to the next tab instead of typing `n`.
- `ctrl-t a` types a literal Ctrl+T into every terminal, like tmux's `send-prefix`.
- Cmd-V pastes the clipboard into every terminal.
- What the pill shows is what it sends: when it says Paused, failed or is gone, nothing still queued is typed anywhere.

## Limits

- **You type into the pill, not the pane.** Herdr gives mods no way to listen to a terminal's own input, so the pill holds the keyboard and types into the panes. Click a terminal to type into just that one ("Paused"); click the pill to sync again.
- **Cursors look inactive.** While syncing, no terminal has the keyboard, so Herdr draws every cursor hollow (□ rather than ■).
- **No IME input or dead keys.** Japanese and other composed text, and accents made with Option+E then E, don't reach the pill; paste them with Cmd-V. Other Option keys work as in Herdr's terminals (`option_as_alt`).
- **A key right after a pane move goes to one pane.** After a binding moves you to another pane, the pill takes the keyboard back a few tens of milliseconds later; a key typed in between goes only to that pane.
- **Some bindings need a second line.** `send:` bindings in `global` or a `layout:` section, and everything in the `terminal` section (say `alt-left` bound to `send:\u001bb`), don't work while syncing. Bind the key in `mod:sync-panes` too, to `sync-panes.send:<text>` with the same text, as `keys.json` does for `ctrl-t a`.
- **Python 3, and tried on macOS only.** Typing needs Python 3 (`python3` or `python`; on Windows `py -3`). On Linux, pasting is Super+V, and on Windows Win+V, which Windows keeps for its clipboard history; on Windows, programs that ask for win32 input mode may not get keys right.

## What Herdr would need

The real thing would be synchronize-panes in Herdr itself: the focused terminal keeps the keyboard, and what you type also goes to the other terminals of the tab. Every limit above would go away.

Short of that, two things would let a mod get close:

- a way for a mod to see the input a terminal receives. You could keep typing in the pane, so the pill, the hollow cursors, the IME gap, the pane-move gap and the second lines would all go;
- a way for a mod to type into a given terminal: text and keys, in order, without moving focus, resizing, touching the clipboard or waiting for `hc`'s ~3 s of quiet. Python would go.

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

Then merge [`sync-panes/keys.json`](sync-panes/keys.json) into `~/.config/herdr-app/keys.json`.

**Keys.** tmux has no default key for `synchronize-panes`, so `ctrl-t e` is this mod's choice. It suits you if your Herdr bindings already start with `ctrl-t`. If not, binding `ctrl-t e` makes Herdr wait for a second key after `ctrl-t`, so programs that use Ctrl+T (a shell's transpose-chars, fzf) may no longer get it directly; pick other keys instead, a single key (`cmd-shift-e`) or a sequence (`ctrl-b e`), and move `ctrl-t a` with them. Nothing in `main.js` needs editing. For a key that only stops, bind `sync-panes.stop`; pressed while not syncing, Herdr says the command is unknown.

**Another folder name** means renaming `sync-panes` in `mod.json`'s `key`, in `main.js` (`mod:sync-panes`, `sync-panes.stop`, `mod.open:sync-panes`, `mods/sync-panes/send.py`) and in your keys.

## What it runs

Python (`send.py`), which runs `hc connect` to type into the terminals (and `hc keys` for the rare key it can't encode itself). On macOS, every 2 s while syncing, it reads `option_as_alt` from Herdr's `settings.json` and, when that is `"auto"`, runs `defaults read` for the keyboard layout. It reads no other files but the one it writes for `send.py`, and makes no network requests.

## License

MIT
