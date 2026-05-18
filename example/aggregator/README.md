# MCP WebSocket 隧道聚合器模式

## 概述

聚合器模式允許您通過單個 WebSocket 隧道連接管理多個 MCP 服務器。當客戶端調用工具時，聚合器會根據工具名稱自動將請求分發到正確的 MCP 服務器。

## 配置文件格式

```json
{
  "comment": "MCP WebSocket 隧道配置文件 - 聚合器模式",
  "id": "your-tunnel-uuid-here",
  "secret_key": "your-secret-key-here",
  "aggregator": {
    "serverUrl": "wss://www.alterminal.com/mcps/tunnels/websocket",
    "maxReconnectAttempts": 10,
    "reconnectDelay": 3000,
    "pingInterval": 30000,
    "maxMissedPongs": 3
  },
  "servers": [
    {
      "name": "filesystem",
      "cmd": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/ydc3148/alter"]
    },
    {
      "name": "another-server",
      "cmd": ["npx", "-y", "@some/mcp-server", "--arg", "value"]
    }
  ]
}
```

### 配置說明

| 字段 | 類型 | 說明 |
|------|------|------|
| `id` | string | 隧道 ID (UUID) |
| `secret_key` | string | Secret Key |
| `aggregator.serverUrl` | string | WebSocket 服務器 URL |
| `aggregator.maxReconnectAttempts` | number | 最大重連次數（默認: 10）|
| `aggregator.reconnectDelay` | number | 重連延遲毫秒數（默認: 3000）|
| `aggregator.pingInterval` | number | Ping 間隔毫秒數（默認: 30000）|
| `aggregator.maxMissedPongs` | number | 最大丟失 Pong 次數（默認: 3）|
| `servers` | array | MCP 服務器配置數組 |
| `servers[].name` | string | 服務器名稱（唯一標識）|
| `servers[].cmd` | array | 要執行的命令 |

## 使用方式

```bash
# 使用默認配置 (config.json)
node index.js

# 使用指定配置
node index.js -c ./example/aggregator/aggregator.json

# 或使用環境變量
MUPPET_CONFIG=./config/aggregate.json node index.js
```

## 運行示例

```bash
# 進入項目目錄
cd muppet-cli-tunnel

# 安裝依賴
pnpm install

# 運行聚合器示例
node index.js -c ./example/aggregator/aggregator.json
```

## 命令行選項

| 選項 | 說明 |
|------|------|
| `-c, --config <path>` | 指定配置文件路徑 |
| `-i, --id <uuid>` | 隧道 ID (UUID) |
| `-k, --secret-key <key>` | Secret Key |
| `-h, --help` | 顯示幫助信息 |
| `-v, --version` | 顯示版本號 |

## 工作流程

1. 連接到 WebSocket 服務器
2. 初始化所有配置的 MCP 服務器
3. 接收來自服務器的 `tools/call` 和 `tools/list` 請求
4. 根據工具名稱分發請求到對應的 MCP 服務器
5. 將執行結果通過 WebSocket 返回給客戶端

## 事件監聽

你可以註冊以下事件監聽：

```javascript
const client = new MCPWebSocketAggregatorClient(options);

client.on('connected', () => {
  console.log('已連接到服務器');
});

client.on('disconnected', (code, reason) => {
  console.log(`連接已關閉: ${code} - ${reason}`);
});

client.on('clientinitialized', (clientName, tools) => {
  console.log(`${clientName} 已就緒，${tools.length} 個工具`);
});

client.on('allclientsready', (clientNames, tools) => {
  console.log(`所有客戶端已就緒，總共 ${tools.length} 個工具`);
});

client.on('error', (error) => {
  console.error('錯誤:', error);
});
```

## 環境變量

| 變量 | 說明 |
|------|------|
| `MUPPET_CONFIG` | 配置文件路徑 |
| `MUPPET_ID` | 隧道 ID |
| `MUPPET_SECRET_KEY` | Secret Key |
| `MUPPET_SERVER_URL` | WebSocket 服務器 URL |