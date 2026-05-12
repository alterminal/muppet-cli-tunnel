import { spawn } from "child_process";
import readline from "readline";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

/**
 * McpClient - MCP 子進程客戶端
 *
 * 只負責啟動子進程和通過 stdio 與子進程通訊，
 * 不涉及 WebSocket 連接等邏輯。
 */
export default class McpClient {
  /**
   * @param {string|string[]} cmd - 要執行的命令
   */
  constructor(cmd) {
    this.cmd = Array.isArray(cmd) ? cmd : [cmd];
    this.initialized = false;
    this.mcpProcess = null;
    this.rl = null;
    this._callbacks = {
      onstdout: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      oninitialized: null,
    };
  }

  /**
   * 啟動子進程
   */
  start() {
    if (this.mcpProcess) {
      log.warn("子進程已在運行中");
      return;
    }

    try {
      this.mcpProcess = spawn(this.cmd[0], this.cmd.slice(1), {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      log.error(`啟動子進程失敗: ${err.message}`);
      if (this._callbacks.onerror) {
        this._callbacks.onerror(err);
      }
      return;
    }

    // 處理 spawn 失敗（例如命令不存在）
    this.mcpProcess.on("error", (err) => {
      log.error(`子進程錯誤: ${err.message}`);
      this.mcpProcess = null;
      if (this._callbacks.onerror) {
        this._callbacks.onerror(err);
      }
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
      if (this._callbacks.onclose) {
        this._callbacks.onclose(code);
      }
    });

    // 創建 readline 接口來逐行讀取 stdout
    this.rl = readline.createInterface({
      input: this.mcpProcess.stdout,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line) => {
      // 第一行用於跳過 initialize 響應
      if (!this.initialized) {
        this.initialized = true;
        if (this._callbacks.oninitialized) {
          this._callbacks.oninitialized();
        }
        return;
      }
      // 通知上層有 stdout 數據
      if (this._callbacks.onstdout) {
        this._callbacks.onstdout(line);
      }
    });
  }

  /**
   * 向子進程 stdin 寫入消息
   * @param {string} message - 要寫入的消息
   * @returns {boolean} 是否寫入成功
   */
  write(message) {
    if (!this.mcpProcess || !this.mcpProcess.stdin) {
      log.warn("收到消息但子進程已不存在，丟棄消息");
      return false;
    }

    if (this.mcpProcess.stdin.destroyed) {
      log.warn("子進程 stdin 已銷毀，丟棄消息");
      return false;
    }

    try {
      const messageStr =
        typeof message === "string" ? message : message.toString();
      const result = this.mcpProcess.stdin.write(messageStr + "\n");
      if (!result) {
        log.warn("寫入時緩衝區已滿，等待 drain 事件...");
      }
      return true;
    } catch (err) {
      log.error(`寫入子進程失敗: ${err.message}`);
      return false;
    }
  }

  /**
   * 停止子進程並清理資源
   */
  stop() {
    // 重置初始化狀態，確保重啟時重新進行 MCP 握手
    this.initialized = false;

    // 關閉 readline 接口
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // 終止子進程
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
  }

  /**
   * 註冊事件回調
   * @param {'stdout'|'message'|'error'|'close'|'initialized'} event - 事件名稱
   * @param {Function} callback - 回調函數
   */
  on(event, callback) {
    const validEvents = ["stdout", "message", "error", "close", "initialized"];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = callback;
    }
  }

  /**
   * 移除事件回調
   * @param {'stdout'|'message'|'error'|'close'|'initialized'} event - 事件名稱
   */
  off(event) {
    const validEvents = ["stdout", "message", "error", "close", "initialized"];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = null;
    }
  }

  /**
   * 發送初始化請求
   * 會自動注入 \\n 作為行尾分隔符
   */
  sendInitialize() {
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
    return this.write(initMessage);
  }

  /**
   * 檢查子進程是否在運行
   * @returns {boolean}
   */
  isRunning() {
    return this.mcpProcess !== null && !this.mcpProcess.killed;
  }
}
