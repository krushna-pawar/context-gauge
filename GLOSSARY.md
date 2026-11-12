# Glossary

- **Footer**: the terminal's one line of gauges, at the right of the row under the prompt, built by
  `footer()` in `hooks/format.ts` as a cell-counted row.
- **Card**: the bordered one-line band above the prompt, on every surface but the terminal
  (desktop, vscode, mobile).
- **Rail**: what the card shows at a given width, decided once by `rail()` in `hooks/format.ts`:
  parts that `hooks/register.tsx` lays out with flex at the pane's full width, leaving the
  surface's own layout to share out the room: one row, or two on a narrow pane.
- **Ends**: the rail's two outer items, the model on the left and `EFFORT / MODE` on the right.
- **Gauge**: one of CTX, 5H and 7D. On the card: a label, a bar, a percentage and an optional
  tail. In the footer only the context has a bar.
- **Fill**: how much of a gauge's bar is filled, in percent (at least 2% for any use).
- **Tail**: what follows a gauge's percentage: the token count for CTX, the reset countdown for 5H.
- **Reset**: when the 5-hour window starts over. The footer says it twice: the **countdown**
  (`↻ 1:20`) and the **clock** time (`→ 3:40pm`).
- **Level**: how loud a footer reading is: calm (under 75%, grey), warm (from 75%, plain, its
  percentage bold) or critical (from 90%, its percentage red).
- **Fit**: how much survives at a width, tried roomiest first. The card's fits choose the gap,
  token count, countdown and bars; the footer's choose the model, bar, clock, countdown, effort
  and how many gauges.
