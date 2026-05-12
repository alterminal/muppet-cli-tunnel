# Filesystem MCP Server 範例

本範例展示如何使用 `muppet-cli-tunnel` 將本地 [MCP Filesystem Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) 通過 WebSocket 隧道連接到遠端服務。

## 架構

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│  遠端 MCP 客戶端  │ ◄──────────────────► │  muppet-cli-tunnel │
└─────────────────┘                      └────────┬─────────┘
                                                   │ stdin/stdout
                                        ┌──────────▼─────────┐
                                        │  filesystem-server  │
                                        │  (npx @modelcontext │
                                        │   protocol/server-  │
                                        │   filesystem)       │
                                        └──────────┬─────────┘
                                                   │
                                        ┌──────────▼─────────┐
                                        │    本地檔案系統      │
                                        │  (/home/user/data)  │
                                        └────────────────────┘
```

## 前置需求

- Node.js >= 22.0.0
- pnpm（推薦）或 npm
- 已安裝 `muppet-cli-tunnel` 依賴

## 快速開始

### 1. 安裝 muppet-cli-tunnel 依賴

```bash
cd /path/to/muppet-cli-tunnel
pnpm install
```

### 2. 複製設定檔

```bash
cp example/filesystem/config.json config.json
```

### 3. 修改設定檔

編輯 `config.json`，填入你的 Tunnel ID 和 Secret Key，以及要允許存取的目錄路徑：

```json
{
  "id": "your-tunnel-uuid-here",
  "secret_key": "your-secret-key-here",
  "cmd": [
    "npx",
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/home/user/allowed-directory"
  ],
  "maxReconnectAttempts": 10,
  "reconnectDelay": 3000,
  "pingInterval": 30000,
  "maxMissedPongs": 3
}
```

### 4. 啟動隧道

```bash
node index.js
```

或者指定自訂設定檔：

```bash
node index.js -c example/filesystem/config.json
```

## 設定檔說明

| 參數                   | 說明                                               | 範例                                                                          |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                   | Tunnel ID（UUID 格式），在平台上建立 Tunnel 時取得 | `"eeaa7e08-7887-4044-9a27-e2753a99b3e5"`                                      |
| `secret_key`           | Secret Key，用於驗證連線                           | `"helloworld"`                                                                |
| `cmd`                  | MCP Server 啟動命令，最後一個參數為允許存取的目錄  | `["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/data"]` |
| `serverUrl`            | WebSocket 服務端地址                               | `"wss://www.alterminal.com/mcps/tunnels/websocket"`                           |
| `maxReconnectAttempts` | 最大重連次數                                       | `10`                                                                          |
| `reconnectDelay`       | 重連延遲（毫秒）                                   | `3000`                                                                        |
| `pingInterval`         | 心跳檢測間隔（毫秒）                               | `30000`                                                                       |
| `maxMissedPongs`       | 最大丟失 Pong 次數                                 | `3`                                                                           |

## 允許多個目錄

Filesystem MCP Server 支援允許多個目錄，只需在命令中依序列出：

```json
{
  "cmd": [
    "npx",
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/home/user/projects",
    "/home/user/documents",
    "/var/log/app"
  ]
}
```

> **安全提示**：只允許 AI 存取必要的目錄，避免暴露敏感資料。

## 命令列方式啟動

你也可以不使用設定檔，直接通過命令列參數啟動：

```bash
node index.js \
  --id your-tunnel-uuid \
  --key your-secret-key \
  -- npx -y @modelcontextprotocol/server-filesystem /home/user/allowed-dir
```

## 可用工具

連接成功後，遠端 AI Actor 可以使用以下檔案系統工具：

| 工具                           | 說明                       |
| ------------------------------ | -------------------------- |
| `read_file` / `read_text_file` | 讀取檔案內容               |
| `read_multiple_files`          | 批次讀取多個檔案           |
| `write_file`                   | 建立或覆寫檔案             |
| `edit_file`                    | 編輯檔案（diff 模式）      |
| `create_directory`             | 建立目錄                   |
| `list_directory`               | 列出目錄內容               |
| `list_directory_with_sizes`    | 列出目錄內容（含檔案大小） |
| `directory_tree`               | 遞迴列出目錄樹             |
| `move_file`                    | 移動或重新命名檔案         |
| `search_files`                 | 搜尋檔案                   |
| `get_file_info`                | 獲取檔案中繼資料           |
| `list_allowed_directories`     | 列出允許存取的目錄         |

## 疑難排解

### 首次執行需要下載 npx 套件

第一次執行時，`npx -y @modelcontextprotocol/server-filesystem` 會自動下載套件，可能需要一些時間。

### 目錄不存在

確認 `cmd` 中指定的目錄路徑確實存在且有讀寫權限：

```bash
ls -la /your/allowed/directory
```

### 連線失敗

- 確認 WebSocket 服務端正常運作
- 檢查 `id` 和 `secret_key` 是否正確
- 確認網路防火牆未阻擋 WebSocket 連線

## 相關資源

- [MCP Filesystem Server 官方文件](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
- [Model Context Protocol 規範](https://modelcontextprotocol.io/)
- [muppet-cli-tunnel 主文件](../../README.md)
