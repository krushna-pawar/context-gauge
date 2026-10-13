# main-card

A Claude Code mod that puts a one-line status card above the prompt:

```
OPUS 5.5  │  CTX ━━━━━━━━━━  42%   84.1k / 200k  │  5H ━━━━━━━  31%  │  7D ━━━━━━━  12%  │  HIGH / AUTO
```

- **Model** in use
- **CTX**: how full the context window is, with tokens used / window size
- **5H / 7D**: how much of your 5-hour and 7-day usage limits you've used (subscription plans)
- **Effort / mode**: the current effort level and permission mode

Percentages turn red at 90%. The card fits itself to the terminal width, dropping the token
count and then the bars as space runs out. It also draws in the Claude desktop app's Code tab.

## Install

In a Claude Code terminal session, run:

```
/plugin install main-card --marketplace krushna-pawar/claude-main-card
```

Answer `y` to add the marketplace, then press Enter to install for your user. The card shows up
right away and in every new session.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

After changing the code, bump `version` in `.claude-plugin/plugin.json` and run
`claude plugin marketplace update main-card-local && claude plugin update main-card@main-card-local`.
