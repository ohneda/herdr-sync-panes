// Types the same input into every terminal of the shown tab. While this
// window has the keyboard, each key goes to all of them: named keys through
// `hc keys`, text it can't name (shifted symbols, non-ASCII) through the
// clipboard and `terminal.paste` on each pane (macOS: pbpaste/osascript). Cmd-V
// pastes the clipboard to all. Opened with <prefix> e (mod.open:broadcast);
// <prefix> shift-e or the ✕ closes it (broadcast.stop).

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, exec, run, panes, focused, theme, props, closeOverlay, nextCommand } from "herdr";

// Your prefix (keys.json spelling, and hc's for sending it literally). The
// window holds the keyboard, so it watches for <prefix> shift-e itself too.
const PREFIX = "ctrl-t";
const PREFIX_HC = "ctrl+t";

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

export default class Broadcast extends View {
  init(_props, cx) {
    this.queue = [];
    this.busy = false;
    this.prefix = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "stop") this.stop();
        cx.notify();
      }
    });
  }

  // The shown tab's terminal panes.
  targets() {
    const tab = focused()?.tab;
    return panes().filter((p) => p.tab === tab && p.terminal);
  }

  stop() {
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
    const m = e.modifiers;
    cx.stop_propagation();
    // The prefix, in case the window sees it before the app's bindings do.
    if (this.prefix) {
      this.prefix = false;
      if (e.keystroke === "shift-e") return this.stop();
      if (e.keystroke === "e") return;
      // <prefix> a or <prefix> <prefix>: the prefix itself, to every terminal.
      if (e.keystroke === "a" || e.keystroke === PREFIX) return this.push({ keys: [PREFIX_HC] }, cx);
    } else if (e.keystroke === PREFIX) {
      this.prefix = true;
      return;
    }
    if (m.platform) {
      if (e.key === "v") this.push({ paste: true }, cx);
      return;
    }
    const item = this.translate(e);
    if (item) this.push(item, cx);
  }

  // Queues an item, merging it into the last one of its kind.
  push(item, cx) {
    const last = this.queue[this.queue.length - 1];
    if (last && item.keys && last.keys) last.keys.push(...item.keys);
    else if (last && item.text != null && last.text != null) last.text += item.text;
    else this.queue.push(item);
    this.drain(cx);
  }

  drain(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        while (this.queue.length) {
          const item = this.queue.shift();
          const targets = this.targets();
          if (item.keys) await this.sendKeys(targets, item.keys);
          else if (item.paste) this.pasteEach(targets);
          else await this.sendText(targets, item.text);
        }
      } catch (err) {
        this.error = String(err?.message ?? err);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  async sendKeys(targets, keys) {
    const results = await Promise.all(targets.map((p) => hc(["keys", p.terminal, ...keys])));
    const bad = results.find((r) => r.code !== 0);
    this.error = bad ? (bad.stderr || bad.stdout).trim() : null;
  }

  // Text hc keys can't name: on the clipboard, pasted into each pane, then
  // the clipboard is put back. Both writes are marked transient and
  // concealed, so clipboard managers don't keep what was typed.
  async sendText(targets, text) {
    const saved = (await exec("pbpaste", [])).stdout;
    try {
      await copy(text);
      this.pasteEach(targets);
    } finally {
      await copy(saved);
    }
  }

  pasteEach(targets) {
    const back = focused()?.pane;
    for (const p of targets) {
      run("pane.focus", { pane: p.pane });
      run("terminal.paste");
    }
    if (back) run("pane.focus", { pane: back });
    this.handle.focus();
  }

  // A small pill: it has to hold the keyboard, so it can't go away, but it
  // stays out of the way. Drag it anywhere; the window remembers the spot.
  render() {
    const t = theme();
    const n = this.targets().length;
    const live = this.handle.is_focused();
    const color = this.error ? t.blocked : live ? t.accent : t.dim;
    return h_flex().id("broadcast").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_click(() => this.handle.focus())
      .h(24).pl(10).pr(4).gap(6).items_center().rounded(12)
      .bg(t.popover).border_1().border_color(color).text_size(11.5).text_color(t.foreground)
      .child(div().w(6).h(6).rounded(3).bg(color)
        .when(live, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
      .child(div().text_color(live ? t.foreground : t.muted).child(live ? `Sync ${n}` : "Paused"))
      .child(div().id("bc-close").w(18).h(18).rounded(9).flex().items_center().justify_center()
        .text_size(10).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.stop()).child("✕"));
  }
}

// Puts text on the clipboard with the nspasteboard.org markers clipboard
// managers honor: don't record it (Transient) and don't show it (Concealed).
const COPY = `function run(argv) {
  ObjC.import("AppKit");
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  pb.setStringForType(argv[0], "public.utf8-plain-text");
  pb.setStringForType("", "org.nspasteboard.TransientType");
  pb.setStringForType("", "org.nspasteboard.ConcealedType");
}`;
async function copy(text) {
  const r = await exec("osascript", ["-l", "JavaScript", "-e", COPY, text]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot set the clipboard");
}
