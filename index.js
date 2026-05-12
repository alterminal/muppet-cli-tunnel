const WebSocket = require("ws");
const parseArgs = require("minimist");
const { spawn } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

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
    this.maxReconnectAttempts = Math.max(
      1,
      parseInt(options.maxReconnectAttempts) || 10,
    );
    this.reconnectDelay = Math.max(
      100,
      parseInt(options.reconnectDelay) || 3000,
    );
    this.shouldReconnect = true;
    this.isManualClose = false;
    this.pingInterval = Math.max(5000, parseInt(options.pingInterval) || 30000);
    this.pingTimer = null;
    this.missedPongs = 0;
    this.maxMissedPongs = Math.max(1, parseInt(options.maxMissedPongs) || 3);
    this.reconnectTimer = null;
    this.boundHandlers = null;

    this.serverUrl =
      options.serverUrl || "wss://www.alterminal.com/mcps/tunnels/websocket";
  }

  getUrl() {
    return `${this.serverUrl}?id=${this.id}&secret_key=${this.secretKey}`;
  }

  connect() {
    // 重置狀態，確保乾淨的連接
    this.initialized = false;

    const url = this.getUrl();
    log.info(`嘗試連接到: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on("open", this.handleOpen.bind(this));
    this.ws.on("message", this.handleMessage.bind(this));
    this.ws.on("error", this.handleError.bind(this));
    this.ws.on("close", this.handleClose.bind(this));
    this.ws.on("pong", this.handlePong.bind(this));
  }

  startPing() {
    this.stopPing();
    this.missedPongs = 0;
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.missedPongs >= this.maxMissedPongs) {
          log.warn(`連續 ${this.maxMissedPongs} 次未收到pong，認為連接已斷開`);
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
  }

  handlePong() {
    this.missedPongs = 0;
  }

  handleOpen() {
    log.info("Muppet tunnel連接已建立");
    this.reconnectAttempts = 0;
    this.startPing();

    if (!Array.isArray(this.cmd) || this.cmd.length === 0) {
      log.error("沒有指定要執行的命令");
      return;
    }

    // 啟動子進程
    try {
      this.mcpProcess = spawn(this.cmd[0], this.cmd.slice(1), {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      log.error(`啟動子進程失敗: ${err.message}`);
      return;
    }

    // 處理 spawn 失敗（例如命令不存在）
    this.mcpProcess.on("error", (err) => {
      log.error(`子進程錯誤: ${err.message}`);
      this.mcpProcess = null;
    });

    this.mcpProcess.stderr.on("data", (data) => {
      log.error(`子進程 stderr: ${data.toString().trim()}`);
    });

    this.mcpProcess.once("close", (code) => {
      log.info(`子進程退出，代碼：${code}`);
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(line);
      }
    });

    // 發送 initialize 請求，並在寫入失敗時處理
    const initMessage = JSON.stringify({
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
    });

    const writeResult = this.mcpProcess.stdin.write(initMessage + "\n");
    if (!writeResult) {
      log.warn("寫入初始化請求時緩衝區已滿，等待 drain 事件...");
    }
  }

  handleMessage(data) {
    if (!this.mcpProcess || !this.mcpProcess.stdin) {
      log.warn("收到消息但子進程已不存在，丟棄消息");
      return;
    }

    if (this.mcpProcess.stdin.destroyed) {
      log.warn("子進程 stdin 已銷毀，丟棄消息");
      return;
    }

    try {
      const messageStr = typeof data === "string" ? data : data.toString();
      this.mcpProcess.stdin.write(messageStr + "\n");
    } catch (err) {
      log.error(`寫入子進程失敗: ${err.message}`);
    }
  }

  handleError(error) {
    if (error.code === "ECONNREFUSED") {
      log.error(`無法連接到服務器，連接被拒絕: ${error.message}`);
    } else if (error.code === "ETIMEDOUT") {
      log.error(`連接服務器超時: ${error.message}`);
    } else {
      log.error(`WebSocket錯誤: ${error.message}`);
    }
  }

  handleClose(code, reason) {
    const reasonStr = reason ? reason.toString() : "";

    // 1002 是協議錯誤，通常是因為 id/secret_key 錯誤
    if (code === 1002) {
      log.error(`WebSocket協議錯誤 (${code}): ${reasonStr}`);
      log.error("可能原因: ID 或 Secret Key 不正確");
      this.isManualClose = true;
      this.shouldReconnect = false;
      this.cleanup();
      return;
    }

    log.info(`WebSocket連接已關閉: ${code} - ${reasonStr}`);

    this.cleanup();

    if (!this.isManualClose && this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  cleanup() {
    // 停止ping
    this.stopPing();

    // 清除重連計時器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 關閉readline接口
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // 終止子進程（確保資源釋放）
    if (this.mcpProcess) {
      const proc = this.mcpProcess;
      try {
        if (!proc.killed) {
          proc.kill("SIGTERM");
          // 設置強制終止計時器：若進程未響應 SIGTERM，則發送 SIGKILL
          setTimeout(() => {
            try {
              if (!proc.killed) {
                proc.kill("SIGKILL");
                log.warn("子進程未響應 SIGTERM，已強制終止");
              }
            } catch (err) {
              // 進程可能已經退出
            }
          }, 5000);
        }
      } catch (err) {
        // 進程可能已經退出
      }
      this.mcpProcess = null;
    }

    // 重置初始化狀態，確保重連時重新進行 MCP 握手
    this.initialized = false;

    // 清理 WebSocket 並移除事件監聽器
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.terminate();
        }
      } catch (err) {
        // ws 可能已處於非正常狀態
      }
      this.ws = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.info(`已達到最大重連次數 (${this.maxReconnectAttempts})，停止重連`);
      this.shouldReconnect = false;
      return;
    }

    // 指數退避，加上上限避免延遲過大
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
      60000,
    );
    this.reconnectAttempts++;

    log.info(
      `將在 ${Math.round(delay)}ms 後進行第 ${this.reconnectAttempts} 次重連嘗試`,
    );

    this.reconnectTimer = setTimeout(() => {
      if (!this.isManualClose && this.shouldReconnect) {
        log.info(`嘗試第 ${this.reconnectAttempts} 次重連...`);
        this.connect();
      }
    }, delay);
  }

  disconnect() {
    log.info("手動斷開連接");
    this.isManualClose = true;
    this.shouldReconnect = false;
    this.cleanup();
  }

  reconnect() {
    // 先清理所有狀態，再建立新連接
    this.isManualClose = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    log.info("重連前清理所有狀態...");
    this.isManualClose = true; // 避免 cleanup 觸發 scheduleReconnect
    this.cleanup();
    this.isManualClose = false;

    // 使用較短延遲確保舊連接完全清理
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 500);
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// ======================== 工具函數 ========================

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
      return { _source: null };
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    const config = JSON.parse(content);
    return { ...config, _source: configPath };
  } catch (error) {
    if (error instanceof SyntaxError) {
      log.error(`配置文件 JSON 格式錯誤: ${error.message}`);
    } else {
      log.error(`讀取配置文件失敗: ${error.message}`);
    }
    return { _source: null };
  }
}

// 合併配置：命令行參數 > 環境變量 > 配置文件 > 默認值
function mergeConfig(fileConfig, cliArgs, envConfig) {
  // 輔助函數：選取第一個有效值
  const pick = (...values) => {
    for (const v of values) {
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };

  return {
    id: pick(cliArgs.id, envConfig.id, fileConfig.id),
    secret_key: pick(
      cliArgs.key,
      cliArgs["secret-key"],
      envConfig.secret_key,
      fileConfig.secret_key,
      fileConfig.secretKey,
    ),
    cmd: cliArgs._ && cliArgs._.length > 0 ? cliArgs._ : fileConfig.cmd || [],
    maxReconnectAttempts: pick(
      cliArgs.maxReconnect,
      cliArgs["max-reconnect"],
      fileConfig.maxReconnectAttempts,
      10,
    ),
    reconnectDelay: pick(
      cliArgs.reconnectDelay,
      cliArgs["reconnect-delay"],
      fileConfig.reconnectDelay,
      3000,
    ),
    serverUrl: pick(
      cliArgs.serverUrl,
      cliArgs["server-url"],
      envConfig.serverUrl,
      fileConfig.serverUrl,
      "wss://www.alterminal.com/mcps/tunnels/websocket",
    ),
    pingInterval: pick(
      cliArgs.pingInterval,
      cliArgs["ping-interval"],
      fileConfig.pingInterval,
      30000,
    ),
    maxMissedPongs: pick(
      cliArgs.maxMissedPongs,
      cliArgs["max-missed-pongs"],
      fileConfig.maxMissedPongs,
      3,
    ),
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
  try {
    const pkg = require("./package.json");
    console.log(`v${pkg.version}`);
  } catch {
    console.log("v1.0.0");
  }
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

// 設置優雅關閉處理
function setupGracefulShutdown(client) {
  const handleSignal = (signal) => {
    log.info(`收到 ${signal} 信號，正在關閉...`);
    client.disconnect();
    // 給 cleanup 一點時間完成
    setTimeout(() => {
      process.exit(0);
    }, 200);
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  // 處理未捕獲的異常
  process.on("uncaughtException", (err) => {
    log.error(`未捕獲的異常: ${err.message}`);
    log.error(err.stack);
    client.disconnect();
    setTimeout(() => {
      process.exit(1);
    }, 200);
  });
}

// ======================== 主入口 ========================

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    alias: {
      c: "config",
      i: "id",
      k: "secret-key",
      h: "help",
      v: "version",
    },
    boolean: ["help", "version"],
    string: ["config", "id", "secret-key", "server-url"],
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
  const fileConfig = loadConfig(configPath);

  if (fileConfig._source === null && configPath !== "config.json") {
    log.error(`錯誤: 指定的配置文件不存在或無法讀取: ${configPath}`);
    process.exit(1);
  }

  if (fileConfig._source) {
    log.info(`✓ 已從 ${configPath} 加載配置`);
  } else if (configPath === "config.json") {
    log.warn(`⚠ 未找到配置文件 ${configPath}，將使用默認配置和命令行參數`);
  }

  // 合併配置
  const config = mergeConfig(fileConfig, args, envConfig);
  let finalCmd = config.cmd;

  // 創建 readline 接口用於標準輸入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 如果沒有提供命令，詢問用戶輸入
  if (!Array.isArray(finalCmd) || finalCmd.length === 0) {
    const cmdInput = await askQuestion(rl, "請輸入要執行的命令: ");
    if (!cmdInput) {
      log.error("錯誤: 命令不能為空");
      rl.close();
      process.exit(1);
    }
    finalCmd = cmdInput.trim().split(/\s+/);
  }

  log.info(`執行的命令: ${finalCmd.join(" ")}`);

  let id = config.id;
  let secretKey = config.secret_key;

  // 如果沒有提供 id，通過標準輸入詢問
  if (!id) {
    id = await askQuestion(rl, "請輸入 Tunnel ID (UUID): ");
    if (!id) {
      log.error("錯誤: ID 不能為空");
      rl.close();
      process.exit(1);
    }
  }

  // 如果沒有提供 key，通過標準輸入詢問
  if (!secretKey) {
    secretKey = await askQuestion(rl, "請輸入 Secret Key: ");
    if (!secretKey) {
      log.error("錯誤: Secret Key 不能為空");
      rl.close();
      process.exit(1);
    }
  }

  rl.close();

  const client = new MCPWebSocketClient({
    id,
    secret_key: secretKey,
    cmd: finalCmd,
    maxReconnectAttempts: config.maxReconnectAttempts,
    reconnectDelay: config.reconnectDelay,
    serverUrl: config.serverUrl,
    pingInterval: config.pingInterval,
    maxMissedPongs: config.maxMissedPongs,
  });

  // 優雅關閉處理
  setupGracefulShutdown(client);

  // 開始連接
  client.connect();
}

// 如果直接運行此腳本則執行main函數
if (require.main === module) {
  main();
}

module.exports = MCPWebSocketClient;
