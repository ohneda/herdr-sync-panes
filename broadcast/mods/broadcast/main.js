// Types the same input into every terminal of one tab, like tmux's
// synchronize-panes. While this window has the keyboard, each key goes to
// all of them: named keys through `hc keys`, text it can't name (shifted
// symbols, non-ASCII) through the clipboard and `terminal.paste` on each pane
// (macOS: pbpaste/osascript). Cmd-V pastes the clipboard to all.
//
// It sticks to the tab it was opened in: showing another tab ends it, and
// queued keys never reach a different tab. A failed send drops what's still
// queued and holds input until the pill is clicked. <prefix> <key> runs that
// key's binding from keys.json instead of typing it; the prefix is read from
// the binding of broadcast.stop. Opened with mod.open:broadcast; the stop
// binding or the ✕ closes it.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, exec, run, panes, focused, spaces, keys, commands, shared, theme, props, closeOverlay, notify, nextCommand } from "herdr";

const LABEL = {
  sync: (n, tab) => `Sync ${n} · ${tab}`,
  paused: "Paused",
  none: "No terminals",
  failed: (who) => `Failed ${who} · click to resume`,
  failedTitle: "Broadcast stopped sending",
  clipboard: "Cannot read the clipboard",
};

// Characters `hc keys` takes as they are.
const PLAIN = /^[a-z0-9\-,.=\[\]';`/]$/;
// GPUI key names -> hc key names, where they differ.
const NAMED = {
  escape: "esc", enter: "enter", backspace: "backspace", tab: "tab", space: "space",
  up: "up", down: "down", left: "left", right: "right", home: "home", end: "end",
  pageup: "pageup", pagedown: "pagedown", delete: "delete", insert: "insert",
};

// One key as an hc key name, or null when hc can't name it.
function keyName(base) {
  if (NAMED[base]) return NAMED[base];
  if (/^f([1-9]|1[0-2])$/.test(base)) return base;
  if (base === "\\") return "backslash";
  if (PLAIN.test(base)) return base;
  return null;
}

// The prefix: the first chord of broadcast.stop's binding ("ctrl-t shift-e"
// -> "ctrl-t"), or null when it isn't bound to a two-key sequence.
function prefixKey() {
  const b = keys().find((k) => k.action === "broadcast.stop" && k.keys.includes(" "));
  return b ? b.keys.split(" ")[0].toLowerCase() : null;
}

// What `<prefix> <key>` does here: the most specific binding that would
// apply outside a terminal.
function bindingFor(chord) {
  const order = ["mod:broadcast", `layout:${shared("layout")}`, "global"];
  for (const section of order) {
    const b = keys().find((k) => k.section === section && k.keys.toLowerCase() === chord);
    if (b) return b.action;
  }
  return null;
}

// Runs a keys.json action ("tab.next", "tab.select:2", "last-pane.go").
function runAction(action) {
  const i = action.indexOf(":");
  if (i < 0) return run(action);
  const name = action.slice(0, i), value = action.slice(i + 1);
  const arg = commands().find((c) => c.name === name)?.args[0]?.name;
  run(name, arg ? { [arg]: /^\d+$/.test(value) ? Number(value) : value } : {});
}

// hc's message from a failed run (it prints {"error": {"message"}}).
function failure(r) {
  const out = (r.stderr || r.stdout || "").trim();
  try { return JSON.parse(out).error.message || out; } catch { return out || `hc exited ${r.code}`; }
}

export default class Broadcast extends View {
  init(_props, cx) {
    const f = focused();
    this.tab = f?.tab ?? null;
    this.openPane = f?.pane ?? null;
    this.queue = [];
    this.busy = false;
    this.pending = false;
    this.stopped = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Take the keyboard again unless the person moved on in the meantime.
    cx.timer.after(300, () => {
      if (!this.handle.is_focused() && focused()?.pane === this.openPane) this.handle.focus();
    });
    // Leaving the tab ends it; render notices too, this covers no redraws.
    cx.timer.every(300, () => this.checkTab());
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "stop") this.stop();
        cx.notify();
      }
    });
  }

  async close() {
    this.stopped = true;
    this.queue = [];
  }

  // The tab's terminal panes, or only the zoomed one: like tmux, panes you
  // can't see don't get keys.
  targets() {
    const ps = panes().filter((p) => p.tab === this.tab && p.terminal);
    const zoomed = ps.filter((p) => p.zoomed);
    return zoomed.length ? zoomed : ps;
  }

  checkTab() {
    const tab = focused()?.tab;
    if (!this.stopped && tab && tab !== this.tab) this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.queue = [];
    closeOverlay(props().overlay);
  }

  // A KeyEvent as a queue item: { keys: [...] }, { text }, or null.
  translate(e) {
    const m = e.modifiers;
    const base = e.key;
    if (m.control || m.alt) {
      const name = keyName(base);
      if (!name) return null;
      const mods = [m.control && "ctrl", m.alt && "alt", m.shift && "shift"].filter(Boolean);
      return { keys: [[...mods, name].join("+")] };
    }
    if (NAMED[base] || /^f([1-9]|1[0-2])$/.test(base)) {
      return { keys: [(m.shift ? "shift+" : "") + keyName(base)] };
    }
    const ch = e.key_char;
    if (!ch) return null;
    if (/^[A-Z]$/.test(ch)) return { keys: ["shift+" + ch.toLowerCase()] };
    const name = keyName(ch);
    return name ? { keys: [name] } : { text: ch };
  }

  key(e, cx) {
    cx.stop_propagation();
    if (this.stopped) return;
    const stroke = e.keystroke.toLowerCase();
    if (this.pending) {
      this.pending = false;
      return this.prefixed(stroke, cx);
    }
    const prefix = prefixKey();
    if (prefix && stroke === prefix) {
      this.pending = true;
      return;
    }
    // After a failure nothing is typed until the pill is clicked.
    if (this.error) return;
    if (e.modifiers.platform) {
      if (e.key === "v") this.push({ paste: true }, cx);
      return;
    }
    const item = this.translate(e);
    if (item) this.push(item, cx);
  }

  // <prefix> <key>: that key's binding, as tmux runs its command instead of
  // sending the key. An unbound key does nothing.
  prefixed(stroke, cx) {
    if (stroke === "escape") return;
    const action = bindingFor(`${prefixKey()} ${stroke}`);
    if (!action || action.startsWith("mod.open:broadcast")) return;
    if (action === "broadcast.stop") return this.stop();
    if (action.startsWith("send:")) {
      if (!this.error) this.pushSend(action.slice(5), cx);
      return;
    }
    runAction(action);
  }

  // A send: binding's text (e.g. "\u0014", a literal prefix) to every terminal.
  pushSend(text, cx) {
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (ch === "\r") this.push({ keys: ["enter"] }, cx);
      else if (ch === "\u001b") this.push({ keys: ["esc"] }, cx);
      else if (code >= 1 && code <= 26) this.push({ keys: ["ctrl+" + String.fromCharCode(code + 96)] }, cx);
      else {
        const name = keyName(ch);
        this.push(name ? { keys: [name] } : { text: ch }, cx);
      }
    }
  }

  // Queues an item for the panes there are now, merging it into the last
  // one of its kind when it goes to the same panes.
  push(item, cx) {
    const targets = this.targets();
    if (!targets.length) return;
    item.targets = targets;
    item.to = targets.map((p) => p.terminal).join(" ");
    const last = this.queue[this.queue.length - 1];
    if (last && last.to === item.to && item.keys && last.keys) last.keys.push(...item.keys);
    else if (last && last.to === item.to && item.text != null && last.text != null) last.text += item.text;
    else this.queue.push(item);
    this.drain(cx);
  }

  drain(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        while (this.queue.length && !this.stopped) {
          this.checkTab();
          if (this.stopped) break;
          const item = this.queue.shift();
          if (item.keys) await this.sendKeys(item.targets, item.keys);
          else if (item.paste) this.pasteEach(item.targets);
          else await this.sendText(item.targets, item.text);
        }
      } catch (err) {
        this.fail([], String(err?.message ?? err));
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Stops typing: what's queued is dropped (a trailing Enter must not run a
  // half-typed command anywhere) and input waits for a click on the pill.
  fail(terminals, message) {
    this.queue = [];
    this.error = { terminals, message: message || "send failed" };
    notify({ title: LABEL.failedTitle, body: `${terminals.join(", ")} ${this.error.message}`.trim(), level: "error" });
  }

  async sendKeys(targets, names) {
    const results = await Promise.all(targets.map((p) => hc(["keys", p.terminal, ...names])));
    const bad = targets.filter((_p, i) => results[i].code !== 0);
    if (bad.length) this.fail(bad.map((p) => p.terminal), failure(results[targets.indexOf(bad[0])]));
  }

  // Text hc keys can't name: on the clipboard, pasted into each pane, then
  // the clipboard is put back, unless something else was copied meanwhile.
  // Both writes are marked transient and concealed, so clipboard managers
  // don't keep what was typed.
  async sendText(targets, text) {
    const saved = await exec("pbpaste", []);
    if (saved.code !== 0) throw new Error(LABEL.clipboard);
    const ours = await copy(text);
    try {
      this.pasteEach(targets);
    } finally {
      if ((await changeCount()) === ours) await copy(saved.stdout);
    }
  }

  pasteEach(targets) {
    const back = focused()?.pane;
    const live = this.handle.is_focused();
    try {
      for (const p of targets) {
        run("pane.focus", { pane: p.pane });
        run("terminal.paste");
      }
    } finally {
      if (back) run("pane.focus", { pane: back });
      if (live) this.handle.focus();
    }
  }

  resume() {
    this.error = null;
    this.handle.focus();
  }

  // A small pill: it has to hold the keyboard, so it can't go away, but it
  // stays out of the way. Drag it anywhere; the window remembers the spot.
  render() {
    this.checkTab();
    const t = theme();
    const n = this.targets().length;
    const live = this.handle.is_focused();
    const name = spaces().flatMap((s) => s.tabs).find((x) => x.id === this.tab)?.name ?? "";
    const color = this.error ? t.blocked : live && n ? t.accent : t.dim;
    const text = this.error ? LABEL.failed(this.error.terminals.join(", ") || "")
      : !n ? LABEL.none
      : live ? LABEL.sync(n, name)
      : LABEL.paused;
    return h_flex().id("broadcast").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_click((_e, cx) => { this.resume(); cx.notify(); })
      .h(24).pl(10).pr(4).gap(6).items_center().rounded(12)
      .bg(t.popover).border_1().border_color(color).text_size(11.5).text_color(t.foreground)
      .child(div().w(6).h(6).rounded(3).bg(color)
        .when(live && n > 0 && !this.error, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
      .child(div().text_color(live || this.error ? t.foreground : t.muted).child(text))
      .child(div().id("bc-close").w(18).h(18).rounded(9).flex().items_center().justify_center()
        .text_size(10).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.stop()).child("✕"));
  }
}

// Puts text on the clipboard with the nspasteboard.org markers clipboard
// managers honor: don't record it (Transient) and don't show it (Concealed).
// The text travels in an environment variable, never as an argument, so
// clipboard contents can't be read as osascript options. Prints the
// clipboard's change count after the write.
const COPY = `ObjC.import("AppKit");
const text = $.NSProcessInfo.processInfo.environment.objectForKey("BROADCAST_TEXT");
const pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.setStringForType(text.isNil() ? "" : text, "public.utf8-plain-text");
pb.setStringForType("", "org.nspasteboard.TransientType");
pb.setStringForType("", "org.nspasteboard.ConcealedType");
pb.changeCount;`;
const COUNT = `ObjC.import("AppKit"); $.NSPasteboard.generalPasteboard.changeCount;`;

async function copy(text) {
  const r = await exec("/usr/bin/env", [`BROADCAST_TEXT=${text}`, "osascript", "-l", "JavaScript", "-e", COPY]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot set the clipboard");
  return Number(r.stdout.trim());
}

async function changeCount() {
  const r = await exec("osascript", ["-l", "JavaScript", "-e", COUNT]);
  return r.code === 0 ? Number(r.stdout.trim()) : NaN;
}
