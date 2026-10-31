// Types the same input into every terminal of one tab, like tmux's
// synchronize-panes. While this window has the keyboard, each key goes to
// all of them: named keys through `hc keys`, text it can't name (shifted
// symbols, non-ASCII) through the clipboard and `terminal.paste` on each pane
// (macOS: osascript). Cmd-V pastes the clipboard to all.
//
// What it shows is what it sends: keys are only sent while the pill says
// Sync. Pausing (the keyboard went elsewhere), stopping, leaving the tab, a
// change in which panes are targeted and a failed send all drop what's
// still queued; a send already handed to hc can't be called back. A failed
// send also holds input until the pill is clicked. <prefix> <key> runs that
// key's binding from keys.json instead of typing it; the prefix is read from
// the binding of sync-panes.stop. Opened with mod.open:sync-panes; the stop
// binding or the ✕ closes it.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { hc, exec, run, panes, focused, spaces, keys, commands, shared, theme, props, closeOverlay, notify, nextCommand } from "herdr";

const LABEL = {
  sync: (n, tab) => `Sync ${n} · ${tab}`,
  paused: "Paused",
  none: "No terminals",
  failed: (who) => `Failed ${who} · click to resume`,
  failedTitle: "Sync panes stopped sending",
  tooBig: "The clipboard is too large to put back (an image?); symbols weren't sent so it isn't lost",
  badSend: "This send: binding has characters that can't be typed; nothing was sent",
};

// Characters `hc keys` takes as they are.
const PLAIN = /^[a-z0-9\-,.=\[\]';`/]$/;
// GPUI key names -> hc key names, where they differ.
const NAMED = {
  escape: "esc", enter: "enter", backspace: "backspace", tab: "tab", space: "space",
  up: "up", down: "down", left: "left", right: "right", home: "home", end: "end",
  pageup: "pageup", pagedown: "pagedown", delete: "delete", insert: "insert",
};
// Herdr applies a pane focus after the mod's own focus call, so after
// moving focus (a paste, <prefix> h) the pill takes the keyboard back on
// these delays, and losing it meanwhile isn't called a pause.
const REGAIN_MS = [30, 120, 300];
const SETTLE_MS = 500;

// One key as an hc key name, or null when hc can't name it.
function keyName(base) {
  if (NAMED[base]) return NAMED[base];
  if (/^f([1-9]|1[0-2])$/.test(base)) return base;
  if (base === "\\") return "backslash";
  if (PLAIN.test(base)) return base;
  return null;
}

// keys.json sections that apply while the pill has the keyboard, most
// specific first.
function sections() {
  return ["mod:sync-panes", `layout:${shared("layout")}`, "global"];
}

// The prefix: the first chord of sync-panes.stop's two-chord binding in the
// sections that apply ("ctrl-t shift-e" -> "ctrl-t"), or null.
function prefixKey() {
  for (const section of sections()) {
    const b = keys().find((k) => k.section === section && k.action === "sync-panes.stop" && k.keys.trim().split(/\s+/).length === 2);
    if (b) return b.keys.trim().split(/\s+/)[0].toLowerCase();
  }
  return null;
}

// What `<prefix> <key>` does here: the most specific binding that applies.
function bindingFor(chord) {
  for (const section of sections()) {
    const b = keys().find((k) => k.section === section && k.keys.trim().toLowerCase() === chord);
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

// A send: binding's text as queue items, or null when any character can't
// be typed faithfully (NUL, ctrl+\ ] ^ _, DEL): then nothing is sent.
function sendItems(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\r" || ch === "\n") out.push({ keys: ["enter"] });
    else if (ch === "\t") out.push({ keys: ["tab"] });
    else if (ch === "\u001b") out.push({ keys: ["esc"] });
    else if (code >= 1 && code <= 26) out.push({ keys: ["ctrl+" + String.fromCharCode(code + 96)] });
    else if (code < 32 || code === 127) return null;
    else {
      const name = keyName(ch);
      out.push(name ? { keys: [name] } : { text: ch });
    }
  }
  return out;
}

// hc's message from a failed run (it prints {"error": {"message"}}).
function failure(r) {
  const out = (r.stderr || r.stdout || "").trim();
  try { return JSON.parse(out).error.message || out; } catch { return out || `hc exited ${r.code}`; }
}

export default class SyncPanes extends View {
  init(_props, cx) {
    this.tab = focused()?.tab ?? null;
    this.queue = [];
    this.gen = 0;
    this.busy = false;
    this.pending = null;
    this.stopped = false;
    this.error = null;
    this.wasLive = false;
    this.quietUntil = 0;
    this.lastTo = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // One more try if the first didn't take, unless the pill has already
    // had the keyboard: then wherever it went was the person's choice.
    cx.timer.after(300, (cx) => {
      if (!this.wasLive && !this.stopped) {
        this.handle.focus();
        cx.notify();
      }
    });
    // Focus moving between the pill and a pane doesn't redraw the pill by
    // itself; redraw when it changed so Sync / Paused is never stale.
    this.shownLive = null;
    cx.timer.every(300, (cx) => {
      this.watch();
      if (this.handle.is_focused() !== this.shownLive) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "stop") this.stop();
        cx.notify();
      }
    });
  }

  async close() {
    this.stopped = true;
    this.drop();
  }

  // The tab's terminal panes. When a pane is zoomed, only it counts, and
  // only if it's a terminal: like tmux, panes you can't see don't get keys.
  targets() {
    const ps = panes().filter((p) => p.tab === this.tab);
    const zoomed = ps.find((p) => p.zoomed);
    if (zoomed) return zoomed.terminal ? [zoomed] : [];
    return ps.filter((p) => p.terminal);
  }

  // Forgets everything queued and any half-typed prefix; sends in flight
  // see the new generation and don't go on.
  drop() {
    this.gen++;
    this.queue = [];
    this.pending = null;
  }

  // Still sending what generation `gen` queued?
  alive(gen) {
    return !this.stopped && gen === this.gen && focused()?.tab === this.tab;
  }

  // Leaving the tab stops; losing the keyboard or a change in the target
  // panes drops what's queued. Runs on a timer and on every render.
  watch() {
    if (this.stopped) return;
    const tab = focused()?.tab;
    if (tab && tab !== this.tab) return this.stop();
    if (this.handle.is_focused()) this.wasLive = true;
    else if (this.wasLive && Date.now() > this.quietUntil) {
      this.wasLive = false;
      this.drop();
    }
    const to = this.targets().map((p) => p.terminal).join(" ");
    if (this.lastTo !== null && to !== this.lastTo) this.drop();
    this.lastTo = to;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.drop();
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
      const prefix = this.pending;
      this.pending = null;
      return this.prefixed(prefix, stroke, cx);
    }
    const prefix = prefixKey();
    if (prefix && stroke === prefix) {
      this.pending = prefix;
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
  // sending the key. An unbound key does nothing, and so does `terminal`
  // (it means "let the program have the key", and there's no program here).
  prefixed(prefix, stroke, cx) {
    if (stroke === "escape") return;
    const action = bindingFor(`${prefix} ${stroke}`);
    if (!action || action === "terminal" || action.startsWith("mod.open:sync-panes")) return;
    if (action === "sync-panes.stop") return this.stop();
    if (action.startsWith("send:")) {
      if (this.error) return;
      const items = sendItems(action.slice(5));
      if (!items) return notify({ title: LABEL.failedTitle, body: LABEL.badSend, level: "warning" });
      for (const item of items) this.push(item, cx);
      return;
    }
    // Moving between panes keeps syncing, as in tmux; an action that opens
    // a dialog leaves the focused pane as it was and keeps the keyboard.
    const before = focused()?.pane;
    runAction(action);
    this.regain(cx, before);
  }

  // Takes the keyboard back once Herdr has moved focus, if the pill had it,
  // the tab is the same and (with `before`) the focused pane changed.
  regain(cx, before) {
    this.quietUntil = Date.now() + SETTLE_MS;
    for (const ms of REGAIN_MS) {
      cx.timer.after(ms, (cx) => {
        if (this.stopped || this.handle.is_focused() || focused()?.tab !== this.tab) return;
        if (before !== undefined && focused()?.pane === before) return;
        this.handle.focus();
        cx.notify();
      });
    }
  }

  // Queues an item for the panes there are now, merging it into the last
  // one of its kind when it goes to the same panes.
  push(item, cx) {
    // Catch up first, so a change in panes drops older items, not this one.
    this.watch();
    if (this.stopped) return;
    const targets = this.targets();
    if (!targets.length) return;
    item.targets = targets;
    item.to = targets.map((p) => p.terminal).join(" ");
    item.gen = this.gen;
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
          this.watch();
          const item = this.queue.shift();
          if (!item || !this.alive(item.gen)) continue;
          if (item.keys) await this.sendKeys(item.targets, item.keys);
          else if (item.paste) this.pasteEach(item.targets, cx);
          else await this.sendText(item.targets, item.text, item.gen, cx);
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
    this.drop();
    this.error = { terminals, message: message || "send failed" };
    notify({ title: LABEL.failedTitle, body: `${terminals.join(", ")} ${this.error.message}`.trim(), level: "error" });
  }

  // Waits for every target to answer, failed or not, before the next batch.
  async sendKeys(targets, names) {
    const settled = await Promise.allSettled(targets.map((p) => hc(["keys", p.terminal, ...names])));
    const bad = [];
    let message = "";
    settled.forEach((s, i) => {
      const r = s.status === "fulfilled" ? s.value : null;
      if (r && r.code === 0) return;
      bad.push(targets[i].terminal);
      message ||= r ? failure(r) : String(s.reason?.message ?? s.reason);
    });
    if (bad.length) this.fail(bad, message);
  }

  // Text hc keys can't name: on the clipboard, pasted into each pane, then
  // the clipboard is put back, every type it held (rich text too). Saving
  // and setting happen in one osascript, and so do checking and restoring,
  // which keeps the window in which a copy of yours could be overwritten
  // small, but not zero. A clipboard too large to carry back (images) is
  // never touched: the symbols aren't sent.
  async sendText(targets, text, gen, cx) {
    const r = await clip(SAVE_AND_SET, { SYNC_PANES_TEXT: text });
    if (r === "TOOBIG") throw new Error(LABEL.tooBig);
    const { saved, count } = JSON.parse(r);
    try {
      if (this.alive(gen)) this.pasteEach(targets, cx);
    } finally {
      await clip(RESTORE, { SYNC_PANES_SAVED: JSON.stringify(saved), SYNC_PANES_COUNT: String(count) });
    }
  }

  // Pastes into each pane in turn; run() doesn't report whether a paste
  // landed. Focus goes back to where it was, and the pill gets the keyboard
  // back only if it had it.
  pasteEach(targets, cx) {
    const back = focused()?.pane;
    const live = this.handle.is_focused();
    this.quietUntil = Date.now() + SETTLE_MS;
    try {
      for (const p of targets) {
        run("pane.focus", { pane: p.pane });
        run("terminal.paste");
      }
    } finally {
      if (back) run("pane.focus", { pane: back });
      if (live) {
        this.handle.focus();
        if (cx) this.regain(cx);
      }
    }
  }

  resume() {
    this.error = null;
    this.pending = null;
    this.handle.focus();
  }

  // A small pill: it has to hold the keyboard, so it can't go away, but it
  // stays out of the way. Drag it anywhere; the window remembers the spot.
  render() {
    this.watch();
    const t = theme();
    const n = this.targets().length;
    const live = this.handle.is_focused();
    this.shownLive = live;
    const name = spaces().flatMap((s) => s.tabs).find((x) => x.id === this.tab)?.name ?? "";
    const color = this.error ? t.blocked : live && n ? t.accent : t.dim;
    const text = this.error ? LABEL.failed(this.error.terminals.join(", ") || "")
      : !n ? LABEL.none
      : live ? LABEL.sync(n, name)
      : LABEL.paused;
    return h_flex().id("sync-panes").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
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

// Clipboard scripts (JXA). Values travel in environment variables, never as
// arguments, so clipboard contents can't be read as osascript options.
// Typed text is marked with the nspasteboard.org Transient and Concealed
// markers, so clipboard managers don't record or show it; the restored
// contents are marked Transient so they aren't recorded twice. Saved
// contents are every type's data, base64, at most SAVE_LIMIT characters in
// all: environment variables can't carry much more.
const SAVE_LIMIT = 400000;
const MARKERS = ["org.nspasteboard.TransientType", "org.nspasteboard.ConcealedType"];
const SAVE_AND_SET = `function run() {
  ObjC.import("AppKit");
  const env = $.NSProcessInfo.processInfo.environment;
  const pb = $.NSPasteboard.generalPasteboard;
  const markers = ${JSON.stringify(MARKERS)};
  const saved = [];
  let size = 0;
  for (const type of ObjC.deepUnwrap(pb.types) || []) {
    if (markers.includes(type)) continue;
    const data = pb.dataForType(type);
    if (data.isNil()) continue;
    const b64 = data.base64EncodedStringWithOptions(0).js;
    size += b64.length + type.length;
    if (size > ${SAVE_LIMIT}) return "TOOBIG";
    saved.push([type, b64]);
  }
  pb.clearContents;
  pb.setStringForType(env.objectForKey("SYNC_PANES_TEXT"), "public.utf8-plain-text");
  for (const m of markers) pb.setStringForType("", m);
  return JSON.stringify({ saved, count: pb.changeCount });
}`;
const RESTORE = `function run() {
  ObjC.import("AppKit");
  const env = $.NSProcessInfo.processInfo.environment;
  const pb = $.NSPasteboard.generalPasteboard;
  if (String(pb.changeCount) !== env.objectForKey("SYNC_PANES_COUNT").js) return "changed";
  const saved = JSON.parse(env.objectForKey("SYNC_PANES_SAVED").js);
  pb.clearContents;
  if (!saved.length) return "restored";
  pb.declareTypesOwner(saved.map((s) => s[0]).concat(["${MARKERS[0]}"]), null);
  for (const [type, b64] of saved) pb.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0), type);
  pb.setStringForType("", "${MARKERS[0]}");
  return "restored";
}`;

async function clip(script, vars) {
  const assigns = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  const r = await exec("/usr/bin/env", [...assigns, "osascript", "-l", "JavaScript", "-e", script]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Cannot use the clipboard");
  return r.stdout.trim();
}
