import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { Buffer } from "buffer";
import { run, props, closeOverlay, notify, exec, theme, spaces, panes, shared, setShared } from "herdr";

const SPLITS = "one-sidebar.splits";

export const splitKey = (terminals) => [...terminals].sort().join(",");

function launch(plan) {
  const arg = Buffer.from(JSON.stringify(plan)).toString("base64");
  const script = [
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'dir="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/one-sidebar-menu"',
    `nohup python3 -I "$dir/move.py" ${arg} >> "\${TMPDIR:-/tmp}/herdr-split.log" 2>&1 &`,
  ].join("\n");
  exec("/bin/sh", ["-c", script], { timeout: 5000 }).catch((err) =>
    notify({ title: "Split view didn't start", body: String(err?.message ?? err), level: "error" }));
}

function split(ids) {
  const space = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === ids[0]));
  if (!space) return;
  const all = panes();
  const groups = (space.tabs ?? []).filter((x) => ids.includes(x.id))
    .map((x) => ({ name: x.name, terminals: all.filter((p) => p.tab === x.id && p.terminal).map((p) => p.terminal) }))
    .filter((g) => g.terminals.length);
  const terminals = groups.flatMap((g) => g.terminals);
  if (terminals.length < 2) return;
  setShared(SPLITS, { ...(shared(SPLITS) ?? {}), [splitKey(terminals)]: groups });
  launch({ mode: "split", space: space.id, groups });
}

function separate(id) {
  const space = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === id));
  if (!space) return;
  const here = panes().filter((p) => p.tab === id && p.terminal).map((p) => p.terminal);
  const key = splitKey(here);
  const records = shared(SPLITS) ?? {};
  const groups = records[key] ?? records[id] ?? [];
  const known = new Set(groups.flatMap((g) => g.terminals));
  const parts = [
    ...groups.map((g) => ({ name: g.name, terminals: g.terminals.filter((t) => here.includes(t)) })),
    ...here.filter((t) => !known.has(t)).map((t) => ({ name: "", terminals: [t] })),
  ].filter((g) => g.terminals.length);
  const { [key]: _a, [id]: _b, ...left } = records;
  setShared(SPLITS, left);
  if (here.length < 2) {
    if (parts[0]?.name) run("tab.rename", { id, name: parts[0].name });
    return;
  }
  launch({ mode: "separate", space: space.id, groups: parts });
}

function items(p) {
  if (p.split) {
    return [
      { label: "Separate tabs", icon: "layers", act: () => separate(p.split) },
      { label: "Rename", icon: "square-pen", act: () => run("tab.rename", { id: p.split }) },
    ];
  }
  return [
    { label: "Open in split view", icon: "panel-right", act: () => split(p.ids ?? []) },
  ];
}

export default class OneSidebarMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const p = props() ?? {};
    const it = items(p)[i];
    if (!it) return;
    closeOverlay(p.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const list = items(props() ?? {});
    return v_flex()
      .id("one-sidebar-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(list.map((it, i) => h_flex()
        .id(`osm-${i}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.choose(i))
        .child(svg(`mods/workspace-chrome/${it.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(it.label))));
  }
}
