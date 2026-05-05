const WebSocket = require("ws");
const parseArgs = require("minimist");
const { spawn } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

class MCPWebSocketClient {
  constructor(options = {}) {
    this.id = options.id;
    this.secretKey = options.secret_key;
    this.cmd = options.cmd || [];
    this.initialized = false;
    this.ws = null;
    this.mcpProcess = null;
    this.rl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.shouldReconnect = true;
    this.isManualClose = false;
    this.pingInterval = options.pingInterval || 30000; // 預設30秒ping一次
    this.pingTimer = null;
    this.missedPongs = 0;
    this.maxMissedPongs = options.maxMissedPongs || 3; // 連續3次沒收到pong則斷開

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
    this.ws.on("pong", this.handlePong.bind(this));
  }

  startPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.missedPongs = 0;
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.missedPongs >= this.maxMissedPongs) {
          console.log(
            `連續 ${this.maxMissedPongs} 次未收到pong，認為連接已斷開`,
          );
          this.ws.terminate();
          return;
        }
        this.ws.ping();
        this.missedPongs++;
      }
    }, this.pingInterval);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.missedPongs = 0;
  }

  handlePong() {
    this.missedPongs = 0;
  }

  handleOpen() {
    console.log("Muppet tunnel連接已建立");
    this.reconnectAttempts = 0; // 重置重連計數
    this.startPing(); // 啟動定期ping

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
      if (!this.initialized) {
        this.initialized = true;
        return;
      }
      if (
        this.initialized &&
        this.ws &&
        this.ws.readyState === WebSocket.OPEN
      ) {
        this.ws.send(line);
      }
    });
    // 等待子進程就緒後發送 initialize 請求
    this.mcpProcess.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "muppet-cli-tunnel",
            version: "1.0.0",
          },
        },
      }),
    );
    this.mcpProcess.stdin.write("\n");
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
    // 停止ping
    this.stopPing();

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

// 讀取配置文件
function loadConfig(configPath) {
  try {
    const fullPath = path.resolve(configPath);
    if (!fs.existsSync(fullPath)) {
      return {};
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`讀取配置文件失敗: ${error.message}`);
    return {};
  }
}

// 合併配置：命令行參數 > 環境變量 > 配置文件 > 默認值
function mergeConfig(fileConfig, cliArgs, envConfig) {
  return {
    // 優先級: 命令行參數 > 環境變量 > 配置文件 > 默認值
    id: cliArgs.id || envConfig.id || fileConfig.id,
    secret_key:
      cliArgs.key ||
      cliArgs["secret-key"] ||
      envConfig.secret_key ||
      fileConfig.secret_key ||
      fileConfig.secretKey,
    cmd: cliArgs._.length > 0 ? cliArgs._ : fileConfig.cmd || [],
    maxReconnectAttempts:
      cliArgs.maxReconnect ||
      cliArgs["max-reconnect"] ||
      fileConfig.maxReconnectAttempts ||
      10,
    reconnectDelay:
      cliArgs.reconnectDelay ||
      cliArgs["reconnect-delay"] ||
      fileConfig.reconnectDelay ||
      3000,
    serverUrl:
      cliArgs.serverUrl ||
      cliArgs["server-url"] ||
      envConfig.serverUrl ||
      fileConfig.serverUrl ||
      "wss://www.alterminal.com/mcps/tunnels/websocket",
    pingInterval:
      cliArgs.pingInterval ||
      cliArgs["ping-interval"] ||
      fileConfig.pingInterval ||
      30000,
    maxMissedPongs:
      cliArgs.maxMissedPongs ||
      cliArgs["max-missed-pongs"] ||
      fileConfig.maxMissedPongs ||
      3,
  };
}

// 顯示幫助信息
function showHelp() {
  console.log(`
Muppet CLI Tunnel - MCP WebSocket 隧道客戶端

使用方法: node index.js [選項] [命令...]

選項:
  -c, --config <path>      指定配置文件路徑 (默認: config.json)
  -i, --id <uuid>          隧道 ID (UUID)
  -k, --secret-key <key>   Secret Key
  --server-url <url>       WebSocket 服務器 URL
  --max-reconnect <n>      最大重連次數 (默認: 10)
  --reconnect-delay <ms>   重連延遲 (默認: 3000ms)
  --ping-interval <ms>     Ping 間隔 (默認: 30000ms)
  --max-missed-pongs <n>   最大丟失 Pong 次數 (默認: 3)
  -h, --help              顯示此幫助信息
  -v, --version           顯示版本號

環境變量:
  MUPPET_CONFIG           配置文件路徑
  MUPPET_ID               隧道 ID
  MUPPET_SECRET_KEY       Secret Key
  MUPPET_SERVER_URL       WebSocket 服務器 URL

示例:
  node index.js -c ./my-config.json
  node index.js -c /etc/muppet/config.json --id xxx --secret-key yyy node server.js
  MUPPET_CONFIG=./prod.json node index.js
`);
}

// 顯示版本信息
function showVersion() {
  const pkg = require('./package.json');
  console.log(`v${pkg.version}`);
}

// 從環境變量加載配置
function loadEnvConfig() {
  return {
    config: process.env.MUPPET_CONFIG,
    id: process.env.MUPPET_ID,
    secret_key: process.env.MUPPET_SECRET_KEY,
    serverUrl: process.env.MUPPET_SERVER_URL,
  };
}

// 命令行參數解析和使用示例
async function main() {
  const args = parseArgs(process.argv.slice(2), {
    alias: {
      c: 'config',
      i: 'id',
      k: 'secret-key',
      h: 'help',
      v: 'version',
    },
    boolean: ['help', 'version'],
    string: ['config', 'id', 'secret-key', 'server-url'],
  });

  // 顯示幫助信息
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // 顯示版本信息
  if (args.version) {
    showVersion();
    process.exit(0);
  }

  // 讀取環境變量配置
  const envConfig = loadEnvConfig();

  // 讀取配置文件（優先級: 命令行參數 > 環境變量 > 默認值）
  const configPath = args.config || envConfig.config || "config.json";
  
  // 檢查配置文件是否存在
  const fullConfigPath = path.resolve(configPath);
  const fileConfig = loadConfig(fullConfigPath);
  
  if (configPath !== "config.json" && Object.keys(fileConfig).length === 0) {
    console.error(`錯誤: 指定的配置文件不存在或無法讀取: ${configPath}`);
    process.exit(1);
  }

  if (Object.keys(fileConfig).length > 0) {
    console.log(`✓ 已從 ${configPath} 加載配置`);
  } else {
    console.log(`⚠ 未找到配置文件 ${configPath}，將使用默認配置和命令行參數`);
  }

  // 合併配置
  const config = mergeConfig(fileConfig, args, envConfig);
  const cmd = config.cmd;

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

  let id = config.id;
  let secretKey = config.secret_key;

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
    maxReconnectAttempts: config.maxReconnectAttempts,
    reconnectDelay: config.reconnectDelay,
    serverUrl: config.serverUrl,
    pingInterval: config.pingInterval,
    maxMissedPongs: config.maxMissedPongs,
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
