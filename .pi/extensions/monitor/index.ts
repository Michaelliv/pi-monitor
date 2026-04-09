import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const MONITOR_DIR = join(tmpdir(), "pi-monitor");

const MONITOR_HTML = `<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0c0c0c;color:#ccc;font:13px/1.45 "SF Mono","Menlo","Monaco",monospace;height:100vh;display:flex;flex-direction:column}
#log{flex:1;overflow-y:auto;padding:4px 12px;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text;cursor:text}
#log .e{color:#f44747}#log .o{color:#d4d4d4}
#bar{background:#1e1e1e;padding:3px 12px;font-size:11px;color:#808080;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #333}
#cp{background:none;border:1px solid #555;color:#808080;font:11px/1 inherit;padding:2px 8px;border-radius:3px;cursor:pointer;margin-left:8px}#cp:hover{background:#333;color:#ccc}#cp:active{background:#444}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px}
.dot.on{background:#89d185;box-shadow:0 0 4px #89d185}.dot.off{background:#808080}.dot.err{background:#f44747;box-shadow:0 0 4px #f44747}
#cur{display:inline-block;width:7px;height:14px;background:#ccc;animation:b 1s step-end infinite;vertical-align:text-bottom}
#cur.off{display:none}@keyframes b{50%{opacity:0}}
#log::-webkit-scrollbar{width:6px}#log::-webkit-scrollbar-track{background:#0c0c0c}
#log::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
</style></head><body>
<div id="log"><span id="cur"></span></div>
<div id="bar"><span><span class="dot on" id="dot"></span><span id="st">running</span> · <span id="n">0</span> lines</span><span><button id="cp" onclick="_cp()">copy</button> <span id="t">0s</span></span></div>
<script>
const L=document.getElementById('log'),C=document.getElementById('cur'),D=document.getElementById('dot'),S=document.getElementById('st'),N=document.getElementById('n'),T=document.getElementById('t');
let c=0,s=Date.now();
setInterval(()=>{let e=Math.floor((Date.now()-s)/1000),m=Math.floor(e/60),h=Math.floor(m/60);T.textContent=h?h+'h '+(m%60)+'m '+(e%60)+'s':m?m+'m '+(e%60)+'s':e+'s'},1000);
window._l=(t,e)=>{const atBottom=L.scrollTop+L.clientHeight>=L.scrollHeight-30;const d=document.createElement('div');d.className=e?'e':'o';d.textContent=t;L.insertBefore(d,C);c++;N.textContent=c;if(atBottom)L.scrollTop=L.scrollHeight};
window._d=(code)=>{C.className='off';if(code===0){D.className='dot off';S.textContent='exit 0'}else{D.className='dot err';S.textContent='exit '+code}};
document.addEventListener('keydown',(e)=>{if((e.metaKey||e.ctrlKey)&&e.key==='c'){const s=window.getSelection();if(s&&s.toString()){navigator.clipboard.writeText(s.toString());e.preventDefault()}}});
window._cp=()=>{const lines=L.querySelectorAll('.o,.e'),t=[...lines].map(l=>l.textContent).join(String.fromCharCode(10));window.glimpse.send({action:'copy',text:t})};
</script></body></html>`;

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export default function (pi: ExtensionAPI) {
  let counter = 0;
  const wins = new Map<string, any>();

  pi.on("session_shutdown", async () => {
    for (const [, w] of wins) { try { w.close(); } catch {} }
  });

  pi.registerTool({
    name: "monitor",
    label: "Monitor",
    description:
      "Run a bash command in the background and display its stdout/stderr in a live floating window. " +
      "The process is fully managed on disk under /tmp/pi-monitor/<id>/:\n" +
      "  pid        — process ID\n" +
      "  command    — the command that was run\n" +
      "  output.log — combined stdout and stderr\n" +
      "  exitcode   — written when the process finishes\n" +
      "Use `read` on output.log to see output. `ls /tmp/pi-monitor/` to list sessions. " +
      "`kill $(cat /tmp/pi-monitor/<id>/pid)` to stop one. " +
      "Presence of exitcode file means the process is done.",
    parameters: Type.Object({
      command: Type.String({ description: "The bash command to run (e.g. 'npm run dev', 'tail -f app.log')" }),
      title: Type.Optional(Type.String({ description: "Window title (defaults to the command)" })),
      width: Type.Optional(Type.Number({ description: "Window width in pixels (default: 900)" })),
      height: Type.Optional(Type.Number({ description: "Window height in pixels (default: 500)" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { open } = await import("glimpseui");

      const id = `mon-${++counter}`;
      const dir = join(MONITOR_DIR, id);
      mkdirSync(dir, { recursive: true });

      const command = params.command;
      const title = params.title ?? command;
      const logFile = join(dir, "output.log");
      const logStream = createWriteStream(logFile, { flags: "w" });

      // Write command file
      writeFileSync(join(dir, "command"), command + "\n");

      // Spawn the command with piped stdio
      const child = spawn("sh", ["-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: ctx.cwd,
      });

      // Write pid
      writeFileSync(join(dir, "pid"), String(child.pid) + "\n");

      // Open window
      const win = open(MONITOR_HTML, {
        width: params.width ?? 900,
        height: params.height ?? 500,
        title: `monitor: ${title}`,
        floating: true,
      });
      wins.set(id, win);

      await new Promise<void>((resolve) => win.on("ready", resolve));

      // Pipe stdout and stderr to both log file and window
      const feedLines = (stream: NodeJS.ReadableStream, isStderr: boolean) => {
        let buffer = "";
        const prefix = isStderr ? "[stderr] " : "";
        stream.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            logStream.write(prefix + line + "\n");
            win.send(`window._l('${esc(line)}',${isStderr})`);
          }
        });
        stream.on("end", () => {
          if (buffer) {
            logStream.write(prefix + buffer + "\n");
            win.send(`window._l('${esc(buffer)}',${isStderr})`);
          }
        });
      };

      feedLines(child.stdout!, false);
      feedLines(child.stderr!, true);

      child.on("close", (code) => {
        logStream.end();
        writeFileSync(join(dir, "exitcode"), String(code ?? 1) + "\n");

        win.send(`window._d(${code ?? 1})`);

        const status = child.killed ? "killed" : code === 0 ? "completed" : "failed";
        pi.sendMessage(
          {
            customType: "monitor",
            content: `Monitor ${id} ${status} (exit ${code ?? 1}). Command: "${command}". Log: ${logFile}`,
            display: true,
            details: { sessionId: id, command, exitCode: code ?? 1, status, logFile },
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      });

      win.on("message", (data: any) => {
        if (data?.action === "copy" && data.text) {
          const pb = spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] });
          pb.stdin!.write(data.text);
          pb.stdin!.end();
          win.send(`document.getElementById('cp').textContent='copied!';setTimeout(()=>document.getElementById('cp').textContent='copy',1500)`);
        }
      });

      win.on("closed", () => {
        try { child.kill(); } catch {}
        wins.delete(id);
      });

      return {
        content: [{
          type: "text",
          text: `Monitor ${id} started.\nDir: ${dir}\nLog: ${logFile}\nCommand: ${command}\nPID: ${child.pid}`,
        }],
        details: { sessionId: id, dir, logFile, command, pid: child.pid },
      };
    },
  });
}
