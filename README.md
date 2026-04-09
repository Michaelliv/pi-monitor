# pi-monitor

Run background processes with live output in a native floating window — built for [pi](https://github.com/badlogic/pi-mono).

Start a build, a server, a test suite — anything long-running — and watch the output stream in real-time in a native macOS window while you keep working. When it finishes, pi gets notified automatically.

## How it works

One tool, everything on disk.

1. **LLM calls `monitor`** — starts a background process
2. **A floating terminal window opens** — streams stdout/stderr live via [Glimpse](https://github.com/hazat/glimpse)
3. **Everything is written to disk** — log, pid, exit code
4. **When the process finishes** — pi is notified via follow-up message with the log path

The process lifecycle is fully managed on disk:

```
/tmp/pi-monitor/<id>/
├── pid          # process ID
├── command      # the command that was run
├── output.log   # combined stdout and stderr
└── exitcode     # written when the process finishes
```

No extra tools needed. Use pi's built-in tools to interact:

- **Read output** → `read /tmp/pi-monitor/mon-1/output.log`
- **List sessions** → `ls /tmp/pi-monitor/`
- **Kill a process** → `kill $(cat /tmp/pi-monitor/mon-1/pid)`
- **Check if done** → presence of `exitcode` file means finished

## Install

```bash
pi install npm:pi-monitor
```

Or from source:

```bash
pi install /path/to/pi-monitor
```

> macOS only. Requires Swift toolchain (ships with Xcode or Xcode Command Line Tools).

## Usage

Just ask pi to run something in the background. The LLM calls `monitor` automatically when appropriate:

- **"Run the tests and let me know when they finish"**
- **"Start the dev server in the background"**
- **"Build the project and show me the output"**
- **"Tail the logs while I work on something else"**

### Tool parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `command` | string | required | The bash command to run |
| `title` | string | command | Window title |
| `width` | number | 900 | Window width in pixels |
| `height` | number | 500 | Window height in pixels |

### Window features

- **Live streaming** — stdout in white, stderr in red
- **Auto-scroll** — follows output, stops when you scroll up
- **Copy button** — copies all output to clipboard
- **Status indicator** — green dot while running, gray on exit 0, red on failure
- **Line counter and timer** — in the status bar

### Completion notification

When a monitored process exits, pi receives a follow-up message with:
- Session ID and exit code
- The original command
- Path to the full log file

This lets pi react — read the log, report results, or start the next step.

## Project structure

```
pi-monitor/
├── .pi/extensions/monitor/
│   └── index.ts          # Extension: monitor tool, Glimpse window, disk management
└── package.json          # pi-package manifest
```

## Credits

- [pi](https://github.com/badlogic/pi-mono) — the extensible coding agent
- [Glimpse](https://github.com/hazat/glimpse) — native macOS WKWebView windows

## License

MIT
