# CLI MCP Server 範例

本範例展示如何使用 `muppet-cli-tunnel` 將 [cli-mcp-server](https://github.com/modelcontextprotocol/servers/tree/main/src/cli) 通過 WebSocket 隧道連接到遠端服務。

CLI MCP Server 允許 AI Actor 在你的本地終端中執行命令，實現自動化操作。

## 架構

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│  遠端 MCP 客戶端  │ ◄──────────────────► │  muppet-cli-tunnel │
└─────────────────┘                      └────────┬─────────┘
                                                   │ stdin/stdout
                                        ┌──────────▼─────────┐
                                        │   cli-mcp-server    │
                                        │  (uvx cli-mcp-      │
                                        │   server)           │
                                        └──────────┬─────────┘
                                                   │
                                        ┌──────────▼─────────┐
                                        │    本地 Shell        │
                                        │  (bash/sh/cmd)      │
                                        └────────────────────┘
```

## 前置需求

- Node.js >= 22.0.0
- pnpm（推薦）或 npm
- Python >= 3.8（`uvx` 需要）
- `uv` 套件管理器（用於執行 `uvx`）

### 安裝 uv

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或使用 pip
pip install uv
```

## 快速開始

### 1. 安裝 muppet-cli-tunnel 依賴

```bash
cd /path/to/muppet-cli-tunnel
pnpm install
```

### 2. 複製設定檔

```bash
cp example/cli/config.json config.json
```

### 3. 修改設定檔

編輯 `config.json`，填入你的 Tunnel ID 和 Secret Key：

```json
{
  "id": "your-tunnel-uuid-here",
  "secret_key": "your-secret-key-here",
  "cmd": ["uvx", "cli-mcp-server"],
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
node index.js -c example/cli/config.json
```

## 設定檔說明

| 參數                   | 說明                                               | 範例                                                |
| ---------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `id`                   | Tunnel ID（UUID 格式），在平台上建立 Tunnel 時取得 | `"325462bb-84d4-4513-9f02-a82a35359ea0"`            |
| `secret_key`           | Secret Key，用於驗證連線                           | `"helloworld"`                                      |
| `cmd`                  | MCP Server 啟動命令                                | `["uvx", "cli-mcp-server"]`                         |
| `serverUrl`            | WebSocket 服務端地址                               | `"wss://www.alterminal.com/mcps/tunnels/websocket"` |
| `maxReconnectAttempts` | 最大重連次數                                       | `10`                                                |
| `reconnectDelay`       | 重連延遲（毫秒）                                   | `3000`                                              |
| `pingInterval`         | 心跳檢測間隔（毫秒）                               | `30000`                                             |
| `maxMissedPongs`       | 最大丟失 Pong 次數                                 | `3`                                                 |

## 命令列方式啟動

你也可以不使用設定檔，直接通過命令列參數啟動：

```bash
node index.js \
  --id your-tunnel-uuid \
  --key your-secret-key \
  -- uvx cli-mcp-server
```

## 可用工具

連接成功後，遠端 AI Actor 可以使用 `run_command` 工具在本地終端執行命令。

> **安全提示**：CLI MCP Server 會給予 AI Actor 在你的系統上執行任意命令的能力。建議：
>
> - 使用專用帳戶或容器執行
> - 限制可存取的目錄範圍
> - 定期審查執行記錄
> - 不要在生產環境中使用具有 root/管理員權限的帳戶

## 疑難排解

### uvx: command not found

確認 `uv` 已正確安裝並在 PATH 中：

```bash
which uvx
uvx --version
```

如果未安裝，請參考上方「安裝 uv」章節。

### 命令執行逾時

某些長時間運行的命令可能會導致 MCP 客戶端逾時。建議將長時間任務拆分為多個較小的命令。

### 連線失敗

- 確認 WebSocket 服務端正常運作
- 檢查 `id` 和 `secret_key` 是否正確
- 確認網路防火牆未阻擋 WebSocket 連線

## 相關資源

- [MCP CLI Server 官方文件](https://github.com/modelcontextprotocol/servers/tree/main/src/cli)
- [Model Context Protocol 規範](https://modelcontextprotocol.io/)
- [uv 套件管理器](https://github.com/astral-sh/uv)
- [muppet-cli-tunnel 主文件](../../README.md)
