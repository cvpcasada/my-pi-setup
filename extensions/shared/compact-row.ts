import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

export type RowStatus = "running" | "done" | "error" | "stopped";

/** One line: `left` truncated with …, status mark and chevron flush right. */
export class CompactRow implements Component {
  constructor(
    private left: string,
    private right: string,
    private pad: number,
  ) {}

  render(width: number): string[] {
    const inner = width - this.pad * 2;
    if (inner <= 0) return [];
    const rightWidth = visibleWidth(this.right);
    const left = truncateToWidth(
      this.left,
      Math.max(0, inner - rightWidth - 1),
      "…",
    );
    const gap = Math.max(1, inner - visibleWidth(left) - rightWidth);
    const margin = " ".repeat(this.pad);
    return [margin + left + " ".repeat(gap) + this.right + margin];
  }

  invalidate(): void {}
}

const MARKS = {
  running: ["dim", "…"],
  done: ["success", "✓"],
  error: ["error", "✗"],
  stopped: ["muted", "■"],
} as const;

export function compactRow(
  icon: string,
  title: string,
  summary: string,
  status: RowStatus,
  expanded: boolean,
  theme: Theme,
  pad: number,
): CompactRow {
  let left = theme.fg("muted", icon) + " ";
  if (title) left += theme.fg("toolTitle", theme.bold(title)) + " ";
  left += theme.fg("muted", summary);
  const [color, mark] = MARKS[status];
  const right =
    theme.fg(color, mark) + " " + theme.fg("dim", expanded ? "⌄" : "›");
  return new CompactRow(left, right, pad);
}

/** Clicks flip expansion per item; the next ctrl+o toggle overrides clicks. */
const clicked = new WeakMap<object, { global: boolean; expanded: boolean }>();

export class ClickToExpand implements Component {
  private cache?: { expanded: boolean; component: Component };

  constructor(
    private key: object,
    private globalExpanded: boolean,
    private build: (expanded: boolean) => Component,
  ) {}

  private expanded(): boolean {
    const click = clicked.get(this.key);
    return click?.global === this.globalExpanded
      ? click.expanded
      : this.globalExpanded;
  }

  render(width: number): string[] {
    const expanded = this.expanded();
    if (this.cache?.expanded !== expanded)
      this.cache = { expanded, component: this.build(expanded) };
    return this.cache.component.render(width);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    clicked.set(this.key, {
      global: this.globalExpanded,
      expanded: !this.expanded(),
    });
    return { handled: true };
  }

  invalidate(): void {
    this.cache = undefined;
  }
}
