import fs from "fs";
import parseArgs from "minimist";
import path from "path";
import readline from "readline";
import MCPWebSocketClient from "./MCPWebSocketClient.js";
import MCPWebSocketAggregatorClient from "./MCPWebSocketAggregatorClient.js";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

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
    // 通用配置
    id: pick(cliArgs.id, envConfig.id, fileConfig.id),
    secret_key: pick(
      cliArgs.key,
      cliArgs["secret-key"],
      envConfig.secret_key,
      fileConfig.secret_key,
      fileConfig.secretKey,
    ),
    serverUrl: pick(
      cliArgs.serverUrl,
      cliArgs["server-url"],
      envConfig.serverUrl,
      fileConfig.serverUrl,
      "wss://www.alterminal.com/mcps/tunnels/websocket",
    ),
    maxReconnectAttempts: pick(
      cliArgs.maxReconnect,
      cliArgs["max-reconnect"],
      fileConfig.maxReconnectAttempts,
      fileConfig.aggregator?.maxReconnectAttempts,
      10,
    ),
    reconnectDelay: pick(
      cliArgs.reconnectDelay,
      cliArgs["reconnect-delay"],
      fileConfig.reconnectDelay,
      fileConfig.aggregator?.reconnectDelay,
      3000,
    ),
    pingInterval: pick(
      cliArgs.pingInterval,
      cliArgs["ping-interval"],
      fileConfig.pingInterval,
      fileConfig.aggregator?.pingInterval,
      30000,
    ),
    maxMissedPongs: pick(
      cliArgs.maxMissedPongs,
      cliArgs["max-missed-pongs"],
      fileConfig.maxMissedPongs,
      fileConfig.aggregator?.maxMissedPongs,
      3,
    ),
    // 單一命令模式
    cmd: cliArgs._ && cliArgs._.length > 0 ? cliArgs._ : fileConfig.cmd || [],
    // 聚合器模式
    servers: fileConfig.servers || [],
    useAggregator: fileConfig.servers && fileConfig.servers.length > 0,
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

模式:
  單一命令模式: 提供 [命令...] 參數，連接單一 MCP 服務器
  聚合器模式:   使用包含 servers 數組的配置文件

環境變量:
  MUPPET_CONFIG           配置文件路徑
  MUPPET_ID               隧道 ID
  MUPPET_SECRET_KEY       Secret Key
  MUPPET_SERVER_URL       WebSocket 服務器 URL

示例:
  # 單一命令模式
  node index.js -c ./my-config.json
  node index.js -c /etc/muppet/config.json --id xxx --secret-key yyy node server.js

  # 聚合器模式
  node index.js -c ./example/aggregator/aggregator.json

  # 使用環境變量
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

  // 創建 readline 接口用於標準輸入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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

  let client;

  // 判斷使用哪種模式：聚合器模式 或 單一命令模式
  if (config.useAggregator) {
    // 聚合器模式
    log.info(`使用聚合器模式，${config.servers.length} 個服務器`);
    for (const server of config.servers) {
      log.info(`  - ${server.name}: ${server.cmd.join(" ")}`);
    }

    client = new MCPWebSocketAggregatorClient({
      id,
      secretKey,
      serverUrl: config.serverUrl,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectDelay: config.reconnectDelay,
      pingInterval: config.pingInterval,
      maxMissedPongs: config.maxMissedPongs,
      servers: config.servers,
    });

    // 設置聚合器事件監聽
    client.on("clientinitialized", (clientName, tools) => {
      log.info(`  → ${clientName} 已就緒 (${tools.length} 個工具)`);
    });

    client.on("allclientsready", (clientNames, tools) => {
      log.info(`所有 ${clientNames.length} 個客戶端已就緒，總共 ${tools.length} 個工具`);
    });
  } else {
    // 單一命令模式
    let finalCmd = config.cmd;

    // 如果沒有提供命令，詢問用戶輸入
    if (!Array.isArray(finalCmd) || finalCmd.length === 0) {
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const cmdInput = await askQuestion(rl2, "請輸入要執行的命令: ");
      rl2.close();
      
      if (!cmdInput) {
        log.error("錯誤: 命令不能為空");
        process.exit(1);
      }
      finalCmd = cmdInput.trim().split(/\s+/);
    }

    log.info(`使用單一命令模式，執行的命令: ${finalCmd.join(" ")}`);

    client = new MCPWebSocketClient({
      id,
      secret_key: secretKey,
      cmd: finalCmd,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectDelay: config.reconnectDelay,
      serverUrl: config.serverUrl,
      pingInterval: config.pingInterval,
      maxMissedPongs: config.maxMissedPongs,
    });
  }

  // 優雅關閉處理
  setupGracefulShutdown(client);

  // 開始連接
  client.connect();
}

// 如果直接運行此腳本則執行main函數
main();