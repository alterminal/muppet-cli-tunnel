const WebSocket = require("ws");
const parseArgs = require("minimist");
const { spawn } = require("child_process");
const readline = require("readline");

class MCPWebSocketClient {
  constructor(options = {}) {
    this.id = options.id;
    this.secretKey = options.secret_key;
    this.cmd = options.cmd || [];

    this.ws = null;
    this.mcpProcess = null;
    this.rl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.shouldReconnect = true;
    this.isManualClose = false;

    this.serverUrl =
      options.serverUrl || "wss://www.alterminal.com/mcps/tunnels/websocket";
  }

  getUrl() {
    return `${this.serverUrl}?id=${this.id}&secret_key=${this.secretKey}`;
  }

  connect() {
    const url = this.getUrl();
    console.log(`嘗試連接到: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on("open", this.handleOpen.bind(this));
    this.ws.on("message", this.handleMessage.bind(this));
    this.ws.on("error", this.handleError.bind(this));
    this.ws.on("close", this.handleClose.bind(this));
  }

  handleOpen() {
    console.log("Muppet tunnel連接已建立");
    this.reconnectAttempts = 0; // 重置重連計數

    // 啟動子進程
    if (this.cmd.length === 0) {
      console.error("沒有指定要執行的命令");
      return;
    }

    this.mcpProcess = spawn(this.cmd[0], this.cmd.slice(1));

    // 處理子進程輸出
    this.mcpProcess.stdout.on("data", (data) => {
      // 可以選擇記錄或處理輸出
    });

    this.mcpProcess.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
    });

    this.mcpProcess.on("close", (code) => {
      console.log(`子進程退出，代碼：${code}`);
      this.mcpProcess = null;
    });

    // 創建readline接口來逐行讀取stdout
    this.rl = readline.createInterface({
      input: this.mcpProcess.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(line);
      }
    });
  }

  handleMessage(data) {
    if (this.mcpProcess && this.mcpProcess.stdin) {
      this.mcpProcess.stdin.write(data);
      this.mcpProcess.stdin.write("\n");
    }
  }

  handleError(error) {
    console.error("WebSocket錯誤:", error);
  }

  handleClose(code, reason) {
    if (code === "1002") {
      console.log(`WebSocket連接已關閉: ${code} - ${reason}`);
      return;
    }

    console.log(`WebSocket連接已關閉: ${code} - ${reason}`);

    // 清理資源
    this.cleanup();

    // 如果不是手動關閉且需要重連，則嘗試重連
    if (!this.isManualClose && this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  cleanup() {
    // 關閉readline接口
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // 終止子進程
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }

    // 關閉WebSocket
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(
        `已達到最大重連次數 (${this.maxReconnectAttempts})，停止重連`,
      );
      this.shouldReconnect = false;
      return;
    }

    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts); // 指數退避
    this.reconnectAttempts++;

    console.log(
      `將在 ${delay}ms 後進行第 ${this.reconnectAttempts} 次重連嘗試`,
    );

    setTimeout(() => {
      if (!this.isManualClose && this.shouldReconnect) {
        console.log(`嘗試第 ${this.reconnectAttempts} 次重連...`);
        this.connect();
      }
    }, delay);
  }

  disconnect() {
    this.isManualClose = true;
    this.shouldReconnect = false;
    this.cleanup();
    console.log("手動斷開連接");
  }

  reconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("當前連接仍在使用中，先斷開再重連");
      this.isManualClose = false; // 確保斷開後會重連
      this.disconnect();
      setTimeout(() => {
        this.connect();
      }, 1000);
    } else {
      this.connect();
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// 通過標準輸入詢問用戶
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// 命令行參數解析和使用示例
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._;

  // 創建 readline 接口用於標準輸入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 如果沒有提供命令，詢問用戶輸入
  let finalCmd = cmd;
  if (finalCmd.length === 0) {
    const cmdInput = await askQuestion(rl, "請輸入要執行的命令: ");
    if (!cmdInput) {
      console.error("錯誤: 命令不能為空");
      rl.close();
      process.exit(1);
    }
    // 解析用戶輸入的命令（支援空格分隔的多個參數）
    finalCmd = cmdInput.trim().split(/\s+/);
  }

  console.log("執行的命令:", finalCmd);

  let id = args.id;
  let secretKey = args.key;

  // 如果沒有提供 id，通過標準輸入詢問
  if (!id) {
    id = await askQuestion(rl, "請輸入 Tunnel ID (UUID): ");
    if (!id) {
      console.error("錯誤: ID 不能為空");
      rl.close();
      process.exit(1);
    }
  }

  // 如果沒有提供 key，通過標準輸入詢問（輸入時隱藏密碼）
  if (!secretKey) {
    secretKey = await askQuestion(rl, "請輸入 Secret Key: ");
    if (!secretKey) {
      console.error("錯誤: Secret Key 不能為空");
      rl.close();
      process.exit(1);
    }
  }

  rl.close();

  const client = new MCPWebSocketClient({
    id: id,
    secret_key: secretKey,
    cmd: finalCmd,
    maxReconnectAttempts: args.maxReconnect || 10,
    reconnectDelay: args.reconnectDelay || 3000,
    serverUrl:
      args.serverUrl || "wss://www.alterminal.com/mcps/tunnels/websocket",
  });

  // 優雅關閉處理
  process.on("SIGINT", () => {
    console.log("\n收到中斷信號，正在關閉...");
    client.disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 100);
  });

  process.on("SIGTERM", () => {
    console.log("\n收到終止信號，正在關閉...");
    client.disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 100);
  });

  // 開始連接
  client.connect();
}

// 如果直接運行此腳本則執行main函數
if (require.main === module) {
  main();
}

module.exports = MCPWebSocketClient;
