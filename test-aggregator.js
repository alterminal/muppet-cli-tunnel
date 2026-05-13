/**
 * McpServerAggregator 測試腳本
 */
import McpServerAggregator from "./McpServerAggregator.js";
import fs from "fs";
import path from "path";

const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

// 讀取 aggregate.json 配置
const configPath = path.resolve("./config/aggregate.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

log.info("創建 McpServerAggregator 實例...");
const aggregator = new McpServerAggregator({
  servers: config.servers,
});

// 設置事件監聽
aggregator.on("clientinitialized", (clientName, client, tools) => {
  log.info(`✓ 客戶端 "${clientName}" 初始化完成，共 ${tools.length} 個工具`);
});

aggregator.on("allclientsready", (clients) => {
  log.info(`\n所有客戶端準備就緒！共 ${clients.length} 個客戶端`);
  
  // 顯示所有工具
  const allTools = aggregator.getAllTools();
  log.info(`\n已註冊工具總數: ${allTools.length}`);
  log.info("工具列表:");
  for (const tool of allTools) {
    log.info(`  - ${tool.name} (來自: ${tool.clientName})`);
    if (tool.description) {
      log.info(`    描述: ${tool.description}`);
    }
  }
});

aggregator.on("toolregistered", (clientName, tool) => {
  log.info(`  [工具註冊] ${tool.name} <- ${clientName}`);
});

aggregator.on("error", (clientName, err) => {
  log.error(`客戶端 "${clientName}" 錯誤: ${err.message}`);
});

// 初始化並啟動所有客戶端
log.info("開始初始化...");
aggregator.initialize()
  .then(() => {
    log.info("\n初始化完成!");
    log.info(`初始化狀態: ${aggregator.isInitialized()}`);
    log.info(`客戶端數量: ${aggregator.getClientNames().length}`);
    log.info(`工具總數: ${aggregator.getAllTools().length}`);
  })
  .catch((err) => {
    log.error(`初始化失敗: ${err.message}`);
  });

// 設置優雅關閉
const handleShutdown = () => {
  log.info("\n正在關閉...");
  aggregator.stopAll();
  setTimeout(() => {
    process.exit(0);
  }, 500);
};

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);