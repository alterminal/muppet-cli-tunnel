const WebSocket = require("ws");
const parseArgs = require("minimist");
const args = parseArgs(process.argv.slice(2));
const { spawn } = require("child_process");
const readline = require("readline");

const cmd = args._;
console.log(cmd);

const params = {
  id: args.id,
  secret_key: args.key,
};

const serverUrl = "ws://localhost:4000/mcps/tunnels/websocket";
const url = `${serverUrl}?id=${params.id}&secret_key=${params.secret_key}`;

// 创建WebSocket连接
const ws = new WebSocket(url);
const mcpprocess = spawn(
  cmd[0],
  cmd.filter((_, i) => i > 0),
);

ws.on("open", () => {
  console.log("WebSocket连接已建立");
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log("send ping");
      ws.send("ping");
    }
  }, 20000);
  mcpprocess.stdout.on("data", (data) => {});

  mcpprocess.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  mcpprocess.on("close", (code) => {
    console.log(`子進程退出，代碼：${code}`);
  });
  const rl = readline.createInterface({
    input: mcpprocess.stdout,
    crlfDelay: Infinity,
  });
  rl.on("line", (line) => {
    ws.send(line);
  });
});

ws.on("message", (data) => {
  mcpprocess.stdin.write(data);
  mcpprocess.stdin.write("\n");
});

ws.on("error", (error) => {
  console.error("WebSocket错误:", error);
});

ws.on("close", (code, reason) => {
  if (code == "1002") {
    console.log(`WebSocket连接已关闭: ${code} - ${reason}`);
    return;
  }
  console.log(`WebSocket连接已关闭: ${code} - ${reason}`);
});
