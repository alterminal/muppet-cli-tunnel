# Muppet CLI Tunnel

一個基於 WebSocket 的 MCP (Model Context Protocol) 隧道 CLI 工具，用於將本地 MCP 服務器通過 WebSocket 連接到遠程服務。

## 功能特點

- 🔌 **WebSocket 隧道連接** - 建立穩定的雙向通信隧道
- 🔄 **標準 IO 轉發** - 將本地 MCP 服務器的 stdin/stdout 與 WebSocket 消息雙向轉發
- 🛡️ **身份驗證** - 支持 ID 和 Secret Key 的連接驗證
- ⚡ **輕量級** - 依賴簡潔，運行高效
- 📁 **配置文件支持** - 支持 JSON 配置文件，命令行參數可覆蓋配置
- 🖥️ **聚合器模式** - 支持通過單一隧道連接管理多個 MCP 服務器

## 安裝

### 前置需求

- Node.js >= 22.0.0
- pnpm (推薦) 或 npm

### 安裝依賴

```bash
git clone https://github.com/alterminal/muppet-cli-tunnel.git
cd muppet-cli-tunnel
pnpm install
# 或
npm install
```

## 使用方法

### 方式一：單一 MCP 服務器模式

#### 配置文件方式

創建 `config.json` 文件：

```json
{
  "id": "your-tunnel-id-uuid",
  "secret_key": "your-secret-key",
  "cmd": [
    "npx",
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/path/to/allowed/dir"
  ],
  "serverUrl": "wss://www.alterminal.com/mcps/tunnels/websocket",
  "maxReconnectAttempts": 10,
  "reconnectDelay": 3000,
  "pingInterval": 30000,
  "maxMissedPongs": 3
}
```

然後運行：

```bash
node index.js
```

#### 命令行方式

```bash
node index.js --id <UUID> --key <SECRET_KEY> -- <MCP_SERVER_COMMAND>
```

### 方式二：聚合器模式（多 MCP 服務器）

聚合器模式允許通過單一 WebSocket 隧道連接管理多個 MCP 服務器。當客戶端調用工具時，聚合器會根據工具名稱自動將請求分發到正確的 MCP 服務器。

#### 配置文件方式

創建包含 `servers` 數組的配置文件：

```json
{
  "id": "your-tunnel-id-uuid",
  "secret_key": "your-secret-key",
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
      "cmd": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    {
      "name": "sqlite",
      "cmd": ["npx", "-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.db"]
    }
  ]
}
```

然後運行：

```bash
node index.js -c ./example/aggregator/aggregator.json
```

#### 聚合器模式配置說明

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

### 方式三：指定自定義配置文件

```bash
node index.js --config /path/to/custom-config.json
# 或簡寫
node index.js -c /path/to/custom-config.json
```

### 參數優先級

配置加載順序（後面的覆蓋前面的）：

1. 默認值
2. 配置文件 (`config.json`)
3. 命令行參數
4. 交互式輸入（僅限未提供的必需參數）

### 配置選項

| 配置項 | 命令行參數 | 說明 | 默認值 |
| ---------------------- | ----------------------- | -------------------- | ------------------------------------------------- |
| `id` | `--id` | 連接 ID (UUID 格式) | 必填 |
| `secret_key` | `--key`, `--secret-key` | 密鑰，用於身份驗證 | 必填 |
| `cmd` | `--` 後的命令 | MCP 服務器啟動命令（單一模式） | 必填（單一模式） |
| `serverUrl` | `--server-url` | WebSocket 服務器地址 | `wss://www.alterminal.com/mcps/tunnels/websocket` |
| `maxReconnectAttempts` | `--max-reconnect` | 最大重連次數 | `10` |
| `reconnectDelay` | `--reconnect-delay` | 重連延遲（毫秒） | `3000` |
| `pingInterval` | `--ping-interval` | Ping 間隔（毫秒） | `30000` |
| `maxMissedPongs` | `--max-missed-pongs` | 最大丟失 Pong 次數 | `3` |
| `-` | `--config`, `-c` | 自定義配置文件路徑 | `config.json` |

### 使用示例

#### 文件系統 MCP 服務器（單一模式）

```bash
node index.js --id <UUID> --key <SECRET_KEY> -- npx -y @modelcontextprotocol/server-filesystem /path
```

#### 多 MCP 服務器（聚合器模式）

```bash
# 使用示例配置
node index.js -c ./example/aggregator/aggregator.json
```

#### SQLite MCP 服務器

```bash
node index.js \
  --id your-uuid-here \
  --key your-secret-key \
  --server-url wss://custom-server.com/ws \
  -- npx -y @modelcontextprotocol/server-sqlite /path/to/database.db
```

## 工作原理

### 單一模式

1. **建立連接** - 使用提供的 ID 和 Key 連接到 WebSocket 服務器
2. **啟動 MCP 服務器** - 執行指定的 MCP 服務器命令作為子進程
3. **消息轉發** -
   - 將 MCP 服務器的 stdout 輸出轉發到 WebSocket
   - 將 WebSocket 接收到的消息寫入 MCP 服務器的 stdin
4. **心跳檢測** - 每 30 秒發送一次 ping 消息保持連接

### 聚合器模式

1. **建立連接** - 使用提供的 ID 和 Key 連接到 WebSocket 服務器
2. **啟動多個 MCP 服務器** - 根據 `servers` 配置啟動多個 MCP 服務器
3. **工具發現** - 每個 MCP 服務器初始化後，聚合器收集並緩存所有工具
4. **請求分發** - 接收 `tools/call` 請求，根據工具名稱分發到對應的 MCP 服務器
5. **返回結果** - 將工具執行結果通過 WebSocket 返回給客戶端

## 項目結構

```
muppet-cli-tunnel/
├── index.js                        # 主入口文件
├── MCPClient.js                    # MCP 客戶端（單一 MCP 服務器）
├── MCPAggregator.js                # MCP 聚合器（多 MCP 服務器）
├── MCPWebSocketClient.js           # WebSocket 客戶端（單一模式）
├── MCPWebSocketAggregatorClient.js # WebSocket 客戶端（聚合器模式）
├── config.json                     # 配置文件（可自定義）
├── package.json                    # 項目配置
├── README.md                       # 本文檔
└── example/                        # 示例配置
    ├── cli/
    ├── filesystem/
    └── aggregator/
```

## 依賴項

- [ws](https://github.com/websockets/ws) - WebSocket 客戶端實現
- [minimist](https://github.com/minimistjs/minimist) - 命令行參數解析

## 故障排除

### 連接失敗

- 確認 WebSocket 服務器已啟動並在監聽對應端口
- 檢查 ID 和 Key 是否正確

### MCP 服務器無響應

- 確認 MCP 服務器命令可正常運行
- 檢查 MCP 服務器的路徑和權限

### 連接斷開

- 檢查網絡連接穩定性
- 查看服務器日誌獲取詳細錯誤信息

## 範例

- [CLI 模式](./example/cli/README.md) - 使用 CLI MCP 服務器
- [Filesystem 模式](./example/filesystem/README.md) - 使用文件系統 MCP 服務器
- [聚合器模式](./example/aggregator/README.md) - 使用多個 MCP 服務器

## 開發計劃

- [x] 支持配置文件方式啟動
- [x] 支持聚合器模式（多 MCP 服務器）
- [ ] 添加日誌級別控制
- [x] 支持重連機制
- [ ] 添加 TLS/SSL 支持

## 許可證

ISC

## 貢獻

歡迎提交 Issue 和 Pull Request！

## 相關資源

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Servers](https://github.com/modelcontextprotocol/servers)