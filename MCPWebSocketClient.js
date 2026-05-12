import { spawn } from "child_process";
import readline from "readline";
import WebSocket from "ws";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

export default class MCPWebSocketClient {
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
