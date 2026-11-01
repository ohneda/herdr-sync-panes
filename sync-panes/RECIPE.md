# Sync panes

Type once, into every terminal of one tab: tmux's `synchronize-panes` for Herdr. `ctrl-t e` starts it, `ctrl-t shift-e` stops it, and a small pill sits in the tab bar while it's on. Your other key bindings keep working while it's on, multi-key ones included, as tmux's prefix keys do. This is a piece you add to your current layout, not a whole window.

![Sync panes](preview.png)

This file is the brief: enough to build Sync panes from an empty folder. The files next to it are one build of it. If they don't work on your Herdr, or you want it different, build it again from here.

## What you see

- A pill in the tab bar, about 24px high, at x 600, y 3 in the window. It has no Herdr frame: the pill draws its own rounded 12px border.
- While it holds the keyboard: a 6px dot breathing in the theme's `accent` color (opacity 0.35 → 1 over 1200 ms), "Sync N · <tab>" (N = terminals it types into, then the tab's name) in `foreground`, and a 18px round ✕ on the right. Border in `accent`.
- When the keyboard is elsewhere (you clicked a terminal): the dot and border turn `dim`, the text says "Paused" in `muted`, and the dot stops breathing.
- When there's no terminal to type into (none in the tab, or a non-terminal pane is zoomed): "No terminals", in `dim`.
- After a send fails: the dot and border turn `blocked`, the text says "Failed t3 · click to resume" (the terminals that failed), and a Herdr notification carries the error.
- Text is 11.5px on the theme's `popover` background. Nothing else is added to the layout.

## How it behaves

**What it shows is what it sends.** Keys are only sent while the pill says "Sync". Everything still queued is dropped when it pauses, stops, leaves its tab, fails, or when the panes it types into change. A key already handed to `send.py` can't be called back.

- `ctrl-t e` opens the pill in the shown tab and gives it the keyboard. Every key you type goes to every terminal pane of **that tab**, in order. When a pane in it is zoomed, only that pane counts: a zoomed terminal gets keys alone, a zoomed non-terminal pane (Files, a preview) means nothing gets keys. tmux also skips panes you can't see.
- Showing another tab (or space) ends it: the pill closes. tmux's sync is per window; leaving the window leaves it.
- Panes added to the tab, closed, zoomed or unzoomed change who gets keys from the next key on; keys queued for the old set are dropped.
- What a key types without Ctrl or Alt (letters, digits, symbols such as `!`, `"`, `|`, `:`, non-ASCII from the keyboard layout) goes as text. Enter, Tab, Backspace, Escape, Space, arrows, Home/End, Page Up/Down, Delete, Insert, F1–F12 and Ctrl/Alt combinations go as keys, encoded the way each terminal's program asked for: application cursor keys, the kitty keyboard protocol. Other keys (F13 and up) are not sent.
- Every key is typed straight into each terminal, with no clipboard and no focus change: `|` is as quick as `l`, and keys right after it don't wait.
- Cmd-V pastes the clipboard into every pane.
- Other Cmd shortcuts are ignored. IME composition doesn't reach it; paste Japanese and other composed text with Cmd-V.
- **Paused**: clicking a terminal takes the keyboard; keys go only to that terminal, and nothing queued goes anywhere. Clicking the pill resumes. Cmd-V and moving panes with a binding move focus for a moment but don't pause.
- **If a send fails** for any terminal, typing is held until you click the pill. Key bindings still work meanwhile.
- **Multi-key bindings run, as tmux's prefix keys do.** Herdr itself runs the `keys.json` bindings it knows while the pill has the keyboard; the pill never sees those keys. With `ctrl-t n` bound to `tab.next`, it goes to the next tab (which ends syncing); `ctrl-t shift-e` stops. A plain `send:` binding would type into no terminal (the pill, not a terminal, has the keyboard), so the chord is bound again in `mod:sync-panes`, which wins while the pill has the keyboard, to `sync-panes.send:<text>`: `ctrl-t a` → `sync-panes.send:\u0014` types a literal Ctrl+T into every terminal, like tmux's `send-prefix`. Keys that start a multi-key binding but end up matching none reach the pill. It holds them while some binding still starts with them (looking in `mod:sync-panes`, then `layout:<shown layout>`, then `global`), then looks the whole sequence up and types nothing: an unbound one does nothing, nor does a `terminal` binding. Escape drops a half-typed one, and so do pause, resume, failure and stop.
- **Moving between panes keeps syncing**, as in tmux: when a binding moves the keyboard to another pane of the tab (`ctrl-t h`, `ctrl-t l`, a "last pane" binding) with no click since the pill last had it, the pill takes the keyboard back. A click on a pane pauses, and a binding that leaves the focused pane as it was (a rename dialog, the palette) leaves the keyboard where Herdr put it.
- `sync-panes.send:` text (and a `send:` binding, should one reach the pill) is typed into every terminal when every character can be: printable characters, Enter (`\r`, `\n`), Tab, Escape and Ctrl+A–Z. Anything else (NUL, Ctrl+\ ] ^ _, DEL) and nothing is sent; a warning says so.
- Which keys the pill holds comes from `keys()`: the start of every multi-key binding in those sections. Rebinding in `keys.json` (`ctrl-b e`, or a single key such as `cmd-shift-e`) is all it takes; there's nothing to change in `main.js`.
- `ctrl-t shift-e` or the ✕ stops it.
- Drag the pill anywhere; Herdr remembers the spot (window `key: "sync-panes"`).

## Built from

- **One mod**, `mods/sync-panes/`, with `main.js`, `send.py` and `mod.json`. The manifest has `place: "none"` and opens as a frameless window overlay (`kind: "window"`, `key: "sync-panes"`, `frame: "none"`, `at: {x: 600, y: 3}`), so there is no `layouts/` folder or layout change.
- **A `keys.json` snippet**, merged into the person's keys rather than replacing them:

  ```json
  {
    "global": {
      "ctrl-t e": "mod.open:sync-panes",
      "ctrl-t shift-e": "sync-panes.stop"
    },
    "mod:sync-panes": {
      "ctrl-t a": "sync-panes.send:\u0014"
    }
  }
  ```

  `sync-panes.stop` and `sync-panes.send:<text>` reach the mod through `nextCommand()` (as `"stop"` and `"send:<text>"`). Any keys work, single keys or sequences; the mod reads what's bound from `keys()`. Add a `mod:sync-panes` line for each `send:` binding you want to reach every terminal while syncing.
- **A focusable view**: `cx.focus_handle()`, focused in `init`, and once more 300 ms later only if the pill hasn't had the keyboard yet (focusing during render isn't allowed). `track_focus` and `on_key_down` on the pill's root; `handle.is_focused()` decides Sync vs Paused.
- **Taking the keyboard back** (`regain()`): Herdr applies `pane.focus` / `pane.go` after the mod's own `handle.focus()` in the same turn, so focusing right away loses. After a paste (if the pill had the keyboard), after a binding the pill ran that changed `focused().pane`, and when `watch()` sees a binding moved the keyboard to another pane, `cx.timer.after` tries again at 30, 120 and 300 ms, while the tab is the same and the pill doesn't have it, and calls `cx.notify()`: a focus handle changing doesn't redraw the pill by itself. The 300 ms watch timer also redraws whenever focus differs from what was last drawn, so Sync / Paused is never stale.
- **One watch** (`watch(cx)`, on a 300 ms `cx.timer.every`, on every render, before every queued key and before every send): a different `focused().tab` stops; a different target set drops the queue. While the pill has the keyboard it notes `focused().pane` and the time. When it has lost it (outside the 500 ms after it moved focus itself): if `on_mouse_down_out` (a press anywhere outside the pill) came after that time, or `focused().pane` is the one noted, or not a target, it pauses and drops the queue; otherwise a binding moved panes, and it takes the keyboard back with `regain()`. Dropping bumps a generation number; queued items carry the generation they were made in and give up when it changed, when stopped, or when the tab changed.
- **Targets:** `panes()` in that tab; if one is `zoomed`, just it when it has a `terminal`, else none; otherwise those with a `terminal`. Each queued item keeps the targets of the moment it was typed, and items only merge with the same targets.
- **Typing:** each queued item is a list of input, `{text}` or `{key, mods}` (`mods`: 1 Shift, 2 Alt, 4 Ctrl; key names `enter`, `esc`, `up`, `f5`, `a`, `;`, ...). Input typed while a send runs merges into the last queued item with the same targets (adjacent text joins), up to 256 entries. One item at a time is written as `{terminals, input}` JSON with `writeTextFile` into a folder made once with Python's `tempfile.mkdtemp` (private to the user, in its temporary folder) and handed over as `exec(python, [..., "-I", `${appHome()}/mods/sync-panes/send.py`, file])`. The Python is the first of `python3`, `python` that makes that folder (on Windows `py -3`, `python`, `python3`: there `python3` may be the Store's stand-in, which opens the Store); `-I` rules out Python 2. None: the send fails with "send.py needs Python 3". send.py deletes the file once read and prints `{terminal: null | error}`. `close()` removes the folder with the same Python (`shutil.rmtree`), so no `rm` is needed. Any error, a non-zero exit without that report, or a rejected `exec` fails: the failing terminals and the message are kept until the pill is clicked.
- **Multi-key bindings:** a key that starts a binding of two or more keys in `keys()` (by section as above) is held, and so is each next key while some binding still starts with the keys held; then the held keys are looked up in `keys()` and run with `run()`; `name:value` actions pass the value as the command's first argument from `commands()` (digits as numbers).
- **send.py** (Python 3, standard library only) speaks herdr-core's protocol through `hc connect`: a `hello {framed: true, generation: 1}` line, then frames `[channel u32 LE][kind u8][length u32 LE][payload]` (DATA 0, CREDIT 1, CLOSE 2; channel 0 is JSON-RPC). For each terminal, in its own thread on the one connection:
  - `terminal.attach {terminal, cols: 0, rows: 0, history: 0}`. The core never applies a 0×0 size, so the terminal keeps the size Herdr gave it. Data that comes back is credited (CREDIT with its length).
  - The modes are read from the first paint, which ends with `ESC[?9001h` or `l`, and from live output after it: `ESC[?1h/l` (application cursor keys), `ESC[=flags;how u` (kitty flags: set, or, and-not), `ESC[>flags u` (push), `ESC[>4;n m` (modifyOtherKeys), `ESC c` (reset). A kitty pop (`ESC[<u`) or a switch of screen (`?1049`, `?1047`, `?47`) after the paint means the flags are no longer known.
  - Text is written as UTF-8 DATA. Keys are encoded as Ghostty (and so `hc keys`) does: legacy (`\r`, `\x7f`, `ESC[A` or `ESC OA`, `ESC[1;5A`, `ESC OP`, `ESC[15~`, Ctrl+letter as a control byte, Alt as an `ESC` prefix, Shift/Ctrl+Enter/Tab/Esc as `ESC[27;m;code~`, Shift+Tab `ESC[Z`), and kitty flags 1, 2 and 4 (`ESC[27u`, `ESC[99;5u`, `ESC[13;2u`, `ESC[1;1:1A` with flag 2, F3 as `ESC[13~`). On purpose it differs where a real terminal would: Ctrl+Shift+letter is the control byte, Alt+Shift+letter `ESC` + capital, Ctrl+[ is `ESC`. A key with no legacy encoding (Ctrl+;) sends nothing.
  - Kitty flags 8 or 16, modifyOtherKeys with a modifier, or flags it lost track of: that key goes through the `terminal.keys` call instead, which waits for the core's quiet (see Watch out).
  - 30 ms between keys, as `hc keys` does, so a lone Esc isn't read as Alt with what follows.
  - Then CLOSE, and it waits for the core's CLOSE: the core reads a connection's frames in order, so by then every byte has gone to the terminal. Each attach waits at most 5 s for the first paint; the whole run gives up after 25 s (`exec` allows 30).
- **Cmd-V:** `run("pane.focus", {pane})` + `run("terminal.paste")` for each target; in `finally` focus goes back to the pane it came from, and the pill is refocused only if it had the keyboard.
- On-screen words are in the `LABEL` table at the top of `main.js`.

## Watch out

- `hc keys` and `hc send` wait until nobody has typed into that terminal for about 3 s (herdr-core's `HC_QUIET_MS`, 3000 by default, read when the core starts). A paste and anything typed through an attach count as typing. That was the lag after `|` when symbols went through the clipboard and the next keys through `hc keys`: so all typing goes through one attach, and `hc keys` only for the rare key send.py can't encode.
- `hc keys` takes only named keys: `!`, `"`, `|` are refused, and `shift+1` types `1`. `hc send` always presses Enter.
- An attach's size is applied whenever it types; `resumed: true` only delays it. Asking for 0×0 is what keeps the size. `observe: true` can't type.
- send.py finds the end of the first paint by its `ESC[?9001` (herdr-core 0.1.15). If a core sends something else, each send waits 5 s and fails.
- The key encoder is send.py's own, checked against what `hc keys` sends in legacy, application cursor, modifyOtherKeys and kitty 1, 5 and 7 modes. A mode change caused by a key in the same batch (Enter starting vim) applies to the keys after it only once the program's output has come back.
- Never put what's typed in a command's arguments: other users on the machine can see arguments in `ps`, and synced typing is often a password. `exec` has no stdin or environment option, so it goes in a file only this user can open.
- `run()` returns nothing, so the mod can't tell whether a Cmd-V paste landed, only that it asked.
- send.py needs Python 3 on the PATH Herdr's `exec` uses (macOS: Command Line Tools or Homebrew). Without it every send fails and says so.
- Only macOS has been tried. On Linux the paste chord is Super+V (the platform key), not Herdr's. On Windows, programs can ask for win32 input mode (`ESC[?9001h`), and send.py doesn't encode keys for it; whether ConPTY takes the plain encoding then is untested.
- The mod runs Python (send.py, which runs `hc connect`) through `exec`. It reads no files and reaches no network.
- A mod only sees keys while it has focus; there is no API to tap a terminal's own input. That is why the pill must exist while syncing, and why it isn't tmux's "keep typing in the pane" feel.
- Herdr runs its own bindings before a mod's key handler (Herdr 0.1.10): a bound key sequence never reaches the pill, and a mod can't tell which binding ran. That's why a pane move is recognized by its effect (the keyboard on another pane of the tab, no press in between). A key typed in the instant between the move and the pill taking the keyboard back (a few tens of ms) goes to that pane alone.
- The `terminal` section of `keys.json` doesn't apply while the pill has the keyboard: Herdr applies it only while a terminal has focus. A key bound there (`"alt-left": "send:\u001bb"`) reaches the pill and goes as the plain key (Alt+Left), and a Cmd key (`cmd-left`) does nothing. To keep one while syncing, bind it again in `mod:sync-panes` to `sync-panes.send:<text>` with the same text.
- A key that starts a multi-key binding (`ctrl-t`, with `ctrl-t n` bound) isn't typed while syncing. To type it, bind a sequence to `sync-panes.send:` in `mod:sync-panes`, as `ctrl-t a` does.
- `at: {x: 600, y: 3}` assumes the default `main` layout's tab bar; move it in `mod.json` or drag it once for other layouts.
- Follow the installed `herdr.d.ts` and `gpui-kit.d.ts`; never modify shipped mods.

## Done when

- `herdr-app check mods/sync-panes` passes.
- With two shells split in one tab, `ctrl-t e` shows "Sync 2 · <tab>" and typing `ls | grep "a"` + Enter runs the same command in both.
- Arrows, Ctrl+C, Backspace and Tab reach both shells.
- Typing `ls | wc -l` + Enter at a normal pace: every key, `|` and those after it included, reaches both shells within about 0.1 s; the clipboard isn't touched and the terminals keep their size.
- With vim open in both panes, arrows move and Esc leaves insert mode.
- Cmd-V pastes the clipboard into both.
- Clicking a terminal shows "Paused" and typing goes only there; clicking the pill shows "Sync 2 · <tab>" again.
- Typing `ls |` keeps "Sync 2 · <tab>", and the next keys still reach both shells.
- `ctrl-t h` and `ctrl-t l` between the two shells keep "Sync 2 · <tab>", and typing still reaches both. Clicking a shell still pauses; `ctrl-t shift-w` (a dialog) pauses and leaves the keyboard in the dialog.
- With `ctrl-t n` bound to `tab.next`, `ctrl-t n` while syncing goes to the next tab and the pill closes; nothing typed before reaches the new tab.
- Zooming one shell makes the pill say "Sync 1" and only that shell gets keys; zooming a Files or preview pane makes it say "No terminals".
- Killing one of the shells from outside and typing shows "Failed …"; nothing more is typed anywhere until the pill is clicked.
- `ctrl-t a` types a literal Ctrl+T into both (in `cat`, macOS shows a `load:` line in each); an unbound `ctrl-t <key>` types nothing.
- With the bindings moved to `ctrl-b` in `keys.json` only, `ctrl-b shift-e` stops it; with `sync-panes.stop` on a single key (`cmd-shift-e`), that key stops it.
- `ctrl-t shift-e` and the ✕ both close the pill, and normal typing goes to one terminal again.
