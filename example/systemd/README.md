# Muppet CLI Tunnel - Systemd 配置示例

## 文件說明

- `muppet-tunnel.service` - systemd service 單元文件
- `muppet-tunnel.env.example` - 環境變量配置模板

## 安裝步驟

### 1. 創建 systemd 配置目錄（存放敏感信息）

```bash
# 創建專用目錄
sudo mkdir -p /etc/muppet-cli-tunnel/env

# 複製環境變量模板
sudo cp muppet-tunnel.env.example /etc/muppet-cli-tunnel/env/muppet-tunnel.env

# 編輯環境變量文件（填入真實的 ID 和密鑰）
sudo vim /etc/muppet-cli-tunnel/env/muppet-tunnel.env

# 設置權限（確保只有 root 可以讀取）
sudo chmod 600 /etc/muppet-cli-tunnel/env/muppet-tunnel.env
```

### 2. 複製 service 文件到 systemd 目錄

```bash
# 複製 service 文件
sudo cp muppet-tunnel.service /etc/systemd/system/

# 編輯 service 文件，根據實際情況調整路徑
sudo vim /etc/systemd/system/muppet-tunnel.service
```

### 3. 可選：創建專用用戶（推薦）

```bash
# 創建專用運行用戶
sudo useradd -r -s /bin/false muppet

# 設置應用目錄權限
sudo chown -R muppet:muppet /home/ydc3148/alter/muppet-cli-tunnel

# 取消 service 文件中的註釋
# User=muppet
# Group=muppet
```

### 4. 重新加載 systemd 配置

```bash
sudo systemctl daemon-reload
```

### 5. 啟動和測試

```bash
# 測試啟動
sudo systemctl start muppet-tunnel

# 檢查狀態
sudo systemctl status muppet-tunnel

# 測試日誌輸出
sudo journalctl -u muppet-tunnel -f
```

### 6. 設置開機自啟

```bash
sudo systemctl enable muppet-tunnel
```

## 常用命令

```bash
# 啟動服務
sudo systemctl start muppet-tunnel

# 停止服務
sudo systemctl stop muppet-tunnel

# 重啟服務
sudo systemctl restart muppet-tunnel

# 查看狀態
sudo systemctl status muppet-tunnel

# 查看日誌
sudo journalctl -u muppet-tunnel -f

# 查看最近日誌
sudo journalctl -u muppet-tunnel -n 100

# 禁用開機自啟
sudo systemctl disable muppet-tunnel
```

## 配置說明

### 環境變量（muppet-tunnel.env）

| 變量名 | 說明 | 預設值 |
|--------|------|--------|
| `MUPPET_ID` | 隧道 ID | - |
| `MUPPET_SECRET_KEY` | 認證密鑰 | - |
| `MUPPET_SERVER_URL` | WebSocket 服務器地址 | 見配置文件 |
| `NODE_ENV` | Node.js 環境 | - |

### Service 配置選項

| 參數 | 說明 |
|------|------|
| `Restart=on-failure` | 進程異常退出時自動重啟 |
| `RestartSec=5` | 重啟前等待 5 秒 |
| `TimeoutStopSec=30` | 停止超時 30 秒 |
| `StandardOutput=journal` | 標準輸出寫入 journal |
| `NoNewPrivileges=true` | 禁止提升權限 |

## 故障排除

### 檢查進程是否運行

```bash
ps aux | grep muppet
```

### 檢查端口佔用

```bash
ss -tlnp | grep node
```

### 完整重置 systemd 配置

```bash
sudo systemctl stop muppet-tunnel
sudo systemctl disable muppet-tunnel
sudo rm /etc/systemd/system/muppet-tunnel.service
sudo systemctl daemon-reload
sudo systemctl reset-failed
```