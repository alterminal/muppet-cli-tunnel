# Muppet CLI Tunnel

一個基於 WebSocket 的 MCP (Model Context Protocol) 隧道 CLI 工具，用於將本地 MCP 服務器通過 WebSocket 連接到遠程服務。

## 功能特點

- 🔌 **WebSocket 隧道連接** - 建立穩定的雙向通信隧道
- 🔄 **標準 IO 轉發** - 將本地 MCP 服務器的 stdin/stdout 與 WebSocket 消息雙向轉發
- 🛡️ **身份驗證** - 支持 ID 和 Secret Key 的連接驗證
- ⚡ **輕量級** - 依賴簡潔，運行高效

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

### 基本語法

```bash
node index.js --id <UUID> --key <SECRET_KEY> -- <MCP_SERVER_COMMAND>
```

### 參數說明

| 參數    | 說明                              | 必填 |
| ------- | --------------------------------- | ---- |
| `--id`  | 連接 ID (UUID 格式)               | ✅   |
| `--key` | 密鑰，用於身份驗證                | ✅   |
| `--`    | 分隔符，後面接 MCP 服務器啟動命令 | ✅   |

### 使用示例

#### 文件系統 MCP 服務器

```bash
node index.js \
  --id 80b7da29-4c96-42fc-84e3-ae684d4b4b1d \
  --key helloworld \
  -- npx -y @modelcontextprotocol/server-filesystem <allow path>
```

#### SQLite MCP 服務器

```bash
node index.js \
  --id your-uuid-here \
  --key your-secret-key \
  -- npx -y @modelcontextprotocol/server-sqlite /path/to/database.db
```

## 工作原理

1. **建立連接** - 使用提供的 ID 和 Key 連接到 WebSocket 服務器
2. **啟動 MCP 服務器** - 執行指定的 MCP 服務器命令作為子進程
3. **消息轉發** -
   - 將 MCP 服務器的 stdout 輸出轉發到 WebSocket
   - 將 WebSocket 接收到的消息寫入 MCP 服務器的 stdin
4. **心跳檢測** - 每 20 秒發送一次 ping 消息保持連接

## 項目結構

```
muppet-cli-tunnel/
├── index.js          # 主入口文件
├── package.json      # 項目配置
├── README.md         # 本文檔
└── pnpm-lock.yaml    # 依賴鎖定文件
```

## 依賴項

- [ws](https://github.com/websockets/ws) - WebSocket 客戶端實現
- [minimist](https://github.com/minimistjs/minimist) - 命令行參數解析

## 環境變量

| 變量 | 說明                   | 默認值 |
| ---- | ---------------------- | ------ |
| -    | 目前不支持環境變量配置 | -      |

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

## 開發計劃

- [ ] 支持配置文件方式啟動
- [ ] 添加日誌級別控制
- [ ] 支持重連機制
- [ ] 添加 TLS/SSL 支持

## 許可證

ISC

## 貢獻

歡迎提交 Issue 和 Pull Request！

## 相關資源

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Servers](https://github.com/modelcontextprotocol/servers)
