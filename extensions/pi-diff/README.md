# pi-diff

Pierre-themed inline diff rendering for pi's `edit` and `write` tools.

The extension supports stacked and side-by-side layouts. Set and save the global layout with:

```text
/pi-diff-layout split
/pi-diff-layout stacked
```

The command writes the ignored file `~/.pi/agent/pi-diff.json`. You can also edit it directly:

```json
{
  "layout": "split"
}
```

`PI_DIFF_LAYOUT` has the highest priority.

This extension is based on [tanvesh01/pierre-diffs](https://github.com/tanvesh01/pierre-diffs). See [LICENSE](LICENSE).
