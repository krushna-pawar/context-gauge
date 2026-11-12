# context-gauge

A Claude Code mod that shows the model, context window, usage limits and effort beside the prompt.

**In the terminal**: one line under the prompt, at the right of Claude Code's own hint row. It adds
no rows.

```
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏸ manual mode on · ? for shortcuts      OPUS 5.5 · ctx ━━━━━━ 5% · 5h 62% ↻ 1:20 → 3:40pm · 7d 45% · high
```

**In the Claude desktop app** (and the VS Code panel): a one-line card above the prompt.

![context-gauge in the Claude desktop app's Code tab](assets/app-interface.png)

Both show:

- **Model** in use
- **ctx**: how full the context window is, as a bar and a percentage (the card adds tokens used /
  window size)
- **5h / 7d**: how much of your 5-hour and 7-day usage limits you've used (subscription plans).
  5h also says when it resets: how long from now (`↻ 1:20`, hours:minutes) and, in the terminal,
  at what time (`→ 3:40pm`, or `→ 15:40` on a 24-hour clock)
- **Effort**: the current effort level. The card adds the permission mode; in the terminal Claude
  Code's own hint beside the gauges already says it

Colors follow your Claude Code theme, so the gauges read on light themes as well as dark ones.

## Quiet until it matters

In the terminal the readings are as grey as Claude Code's own hints, so they stay out of the way:

- **Under 75%**: grey.
- **From 75%**: that reading turns plain and bold.
- **From 90%**: its percentage becomes a red chip, and its label, bar and reset time turn red.

On the card, percentages turn red at 90%.

## Narrow windows

The terminal line never wraps and always leaves Claude Code's hint its room. As the window narrows
it drops the reset's time of day first, then the model, then the bar and the effort, then the
countdown, then 7d:

```
OPUS 5.5 · ctx ━━━━━━ 5% · 5h 62% ↻ 1:20 → 3:40pm · 7d 45% · high
OPUS 5.5 · ctx ━━━━━━ 5% · 5h 62% ↻ 1:20 · 7d 45% · high
ctx ━━━━━━ 5% · 5h 62% ↻ 1:20 · 7d 45% · high
ctx 5% · 5h 62% ↻ 1:20 · 7d 45%
ctx 5% · 5h 62% · 7d 45%
ctx 5% · 5h 62%
```

Narrower still, the row is left to Claude Code.

In the desktop app and the VS Code panel the card fills the width, with thin bars taking the spare
room. On a narrow pane, as in VS Code's sidebar or a small window, it takes two rows: the model and
effort / mode, then the gauges without bars.

## Known limits

- **Effort** shows `—` until Claude's first request in a session, unless it's saved in your
  settings (`/effort` saves it).
- **5h / 7d** show `—` until Claude Code has a reading, usually after the first request, and
  only on subscription plans.
- **The terminal line** can't see how long Claude Code's hint beside it is, so it leaves 42
  columns for it. Where the hint is longer, Claude Code shortens the hint.
- **Mode after Shift+Tab** (the card only) updates with your next prompt or tool call: Claude Code
  raises no event for the key itself.
- The `[-]` beside the card is Claude Code's own collapse button; the mod can't hide it.

## Install

In a Claude Code terminal session, run:

```
/plugin install context-gauge --marketplace krushna-pawar/context-gauge
```

Answer `y` to add the marketplace, then press Enter to install for your user. The gauges show up
right away and in every new session.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

After changing the code, bump `version` in `.claude-plugin/plugin.json` and run
`claude plugin marketplace update context-gauge && claude plugin update context-gauge@context-gauge`.

## License

MIT, see [LICENSE](LICENSE).
