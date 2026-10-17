# Glossary

- **Card**: the bordered one-line band above the prompt.
- **Rail**: what the card shows at a given width, decided once by `rail()` in `hooks/format.ts`:
  for the terminal, cell-counted rows; for every other surface (desktop, vscode, mobile), a
  **flex** rail of parts that `hooks/register.tsx` lays out without deciding anything.
- **Ends**: the rail's two outer items, the model on the left and `EFFORT / MODE` on the right.
- **Gauge**: one of CTX, 5H and 7D: a label, a bar, a percentage and an optional tail.
- **Fill**: how much of a gauge's bar is filled, in percent (at least 2% for any use).
- **Tail**: what follows a gauge's percentage: the token count for CTX, the reset countdown for 5H.
- **Fit**: how much of the rail survives at a width (gap, token count, countdown, bars), tried
  roomiest first. The terminal and flex surfaces have their own fit order and minimum bar length.
