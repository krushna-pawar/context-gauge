# context-gauge

A Claude Code mod that puts a one-line status card above the prompt.

**In the terminal**

![context-gauge in the Claude Code terminal](assets/terminal-interface.png)

**In the Claude desktop app**

![context-gauge in the Claude desktop app's Code tab](assets/app-interface.png)

The card shows:

- **Model** in use
- **CTX**: how full the context window is, with tokens used / window size
- **5H / 7D**: how much of your 5-hour and 7-day usage limits you've used (subscription plans)
- **Effort / mode**: the current effort level and permission mode

Percentages turn red at 90%. The card fits itself to the terminal width, dropping the token
count and then the bars as space runs out. In the desktop app it lays out to fit the window's font.

## Install

In a Claude Code terminal session, run:

```
/plugin install context-gauge --marketplace krushna-pawar/context-gauge
```

Answer `y` to add the marketplace, then press Enter to install for your user. The card shows up
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
