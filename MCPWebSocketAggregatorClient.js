import WebSocket from "ws";
import MCPAggregator from "./MCPAggregator.js";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

/**
 * MCPWebSocketAggregatorClient - MCP WebSocket 隧道客戶端（聚合器模式）
 *
 * 使用 MCPAggregator 管理多個 MCP 服務器，透過 WebSocket 隧道與服務器通訊。
 * 接收來自服務器的 call tool 請求，根據工具名稱分發給對應的 MCP 服務器。
 */
export default class MCPWebSocketAggregatorClient {
  /**
   * @param {Object} options - 配置選項
   * @param {string} options.id - 隧道 ID (UUID)
   * @param {string} options.secretKey - Secret Key
   * @param {string} options.serverUrl - WebSocket 服務器 URL
   * @param {number} options.maxReconnectAttempts - 最大重連次數
   * @param {number} options.reconnectDelay - 重連延遲（毫秒）
   * @param {number} options.pingInterval - Ping 間隔（毫秒）
   * @param {number} options.maxMissedPongs - 最大丟失 Pong 次數
   * @param {Array<Object>} options.servers - MCP 服務器配置數組
   */
  constructor(options = {}) {
    this.id = options.id;
    this.secretKey = options.secretKey;
    this.serverUrl =
      options.serverUrl || "wss://www.alterminal.com/mcps/tunnels/websocket";

    // WebSocket 配置
    this.maxReconnectAttempts = Math.max(
      1,
      parseInt(options.maxReconnectAttempts) || 10,
    );
    this.reconnectDelay = Math.max(
      100,
      parseInt(options.reconnectDelay) || 3000,
    );
    this.pingInterval = Math.max(5000, parseInt(options.pingInterval) || 30000);
    this.maxMissedPongs = Math.max(1, parseInt(options.maxMissedPongs) || 3);

    // 狀態
    this.ws = null;
    this.aggregator = null;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    this.isManualClose = false;

    // 定時器
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.missedPongs = 0;

    // 事件回調
    this._callbacks = {
      onconnected: null,
      ondisconnected: null,
      onerror: null,
      onclientinitialized: null,
      onallclientsready: null,
    };

    // 初始化聚合器
    this._initAggregator(options.servers);
  }

  /**
   * 初始化聚合器
   * @param {Array<Object>} servers - 服務器配置數組
   */
  _initAggregator(servers) {
    if (!servers || !Array.isArray(servers) || servers.length === 0) {
      log.warn("沒有配置任何 MCP 服務器");
      return;
    }

    this.aggregator = new MCPAggregator({ servers });

    // 設置聚合器事件監聽
    this.aggregator.on("clientinitialized", (clientName, client, tools) => {
      log.info(`客戶端 "${clientName}" 已就緒，加載了 ${tools.length} 個工具`);
      if (this._callbacks.onclientinitialized) {
        this._callbacks.onclientinitialized(clientName, tools);
      }
    });

    this.aggregator.on("allclientsready", (clientNames) => {
      log.info(`所有 ${clientNames.length} 個客戶端已就緒`);
      const allTools = this.aggregator.getAllTools();
      log.info(`總共加載了 ${allTools.length} 個工具`);
      if (this._callbacks.onallclientsready) {
        this._callbacks.onallclientsready(clientNames, allTools);
      }
    });

    this.aggregator.on("error", (clientName, err) => {
      log.error(`客戶端 "${clientName}" 錯誤: ${err.message}`);
      if (this._callbacks.onerror) {
        this._callbacks.onerror(clientName, err);
      }
    });

    log.info(`已初始化聚合器，管理 ${servers.length} 個 MCP 服務器`);
  }

  /**
   * 獲取 WebSocket URL
   * @returns {string}
   */
  getUrl() {
    return `${this.serverUrl}?id=${this.id}&secret_key=${this.secretKey}`;
  }

  /**
   * 連接到 WebSocket 服務器
   */
  connect() {
    if (!this.id || !this.secretKey) {
      log.error("錯誤: ID 和 Secret Key 必須提供");
      return;
    }

    // 重置狀態
    this.shouldReconnect = true;
    this.isManualClose = false;

    const url = this.getUrl();
    log.info(`嘗試連接到: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on("open", this._handleOpen.bind(this));
    this.ws.on("message", this._handleMessage.bind(this));
    this.ws.on("error", this._handleError.bind(this));
    this.ws.on("close", this._handleClose.bind(this));
    this.ws.on("pong", this._handlePong.bind(this));
  }

  /**
   * 啟動 WebSocket ping
   */
  _startPing() {
    this._stopPing();
    this.missedPongs = 0;
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.missedPongs >= this.maxMissedPongs) {
          log.warn(`連續 ${this.maxMissedPongs} 次未收到 pong，認為連接已斷開`);
          this.ws.terminate();
          return;
        }
        this.ws.ping();
        this.missedPongs++;
      }
    }, this.pingInterval);
  }

  /**
   * 停止 WebSocket ping
   */
  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * 處理 pong 回應
   */
  _handlePong() {
    this.missedPongs = 0;
  }

  /**
   * 處理 WebSocket 連接打開
   */
  _handleOpen() {
    log.info("WebSocket 連接已建立");
    this.reconnectAttempts = 0;
    this._startPing();

    // 觸發連接事件
    if (this._callbacks.onconnected) {
      this._callbacks.onconnected();
    }

    // 初始化聚合器中的所有客戶端
    if (this.aggregator) {
      this.aggregator.initialize().then(() => {
        log.info("所有 MCP 客戶端初始化完成");
      }).catch((err) => {
        log.error(`初始化 MCP 客戶端失敗: ${err.message}`);
      });
    }
  }

  /**
   * 處理 WebSocket 消息
   * @param {string|Buffer} data - 收到的消息
   */
  _handleMessage(data) {
    try {
      const messageStr = typeof data === "string" ? data : data.toString();
      let parsed;

      try {
        parsed = JSON.parse(messageStr);
      } catch {
        // 非 JSON 消息，忽略
        log.warn(`收到非 JSON 消息: ${messageStr.substring(0, 100)}`);
        return;
      }

      // 處理不同的 MCP 方法
      if (parsed.method === "tools/call") {
        this._handleCallTool(parsed);
      } else if (parsed.method === "tools/list") {
        this._handleListTools(parsed);
      } else {
        log.warn(`未知的 method: ${parsed.method}`);
      }
    } catch (err) {
      log.error(`處理消息失敗: ${err.message}`);
    }
  }

  /**
   * 處理 tools/call 請求
   * @param {Object} message - JSON-RPC 消息
   */
  async _handleCallTool(message) {
    if (!this.aggregator) {
      this._sendError(message.id, -32603, "Aggregator 未初始化");
      return;
    }

    const { name: toolName, arguments: args = {} } = message.params || {};
    const requestId = message.id;

    if (!toolName) {
      this._sendError(requestId, -32602, "缺少 tool name");
      return;
    }

    try {
      log.info(`收到 tools/call 請求: ${toolName}`);
      const result = await this.aggregator.callTool(toolName, args);
      this._sendResponse(requestId, result);
    } catch (err) {
      log.error(`執行工具 "${toolName}" 失敗: ${err.message}`);
      this._sendError(requestId, -32603, err.message);
    }
  }

  /**
   * 處理 tools/list 請求
   * @param {Object} message - JSON-RPC 消息
   */
  _handleListTools(message) {
    if (!this.aggregator) {
      this._sendError(message.id, -32603, "Aggregator 未初始化");
      return;
    }

    const tools = this.aggregator.getAllTools();
    this._sendResponse(message.id, { tools });
  }

  /**
   * 發送 JSON-RPC 響應
   * @param {number|string} id - 請求 ID
   * @param {Object} result - 結果
   */
  _sendResponse(id, result) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const response = JSON.stringify({
      jsonrpc: "2.0",
      id,
      result,
    });
    this.ws.send(response);
  }

  /**
   * 發送 JSON-RPC 錯誤
   * @param {number|string} id - 請求 ID
   * @param {number} code - 錯誤碼
   * @param {string} message - 錯誤消息
   */
  _sendError(id, code, message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const response = JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
    this.ws.send(response);
  }

  /**
   * 處理 WebSocket 錯誤
   * @param {Error} error - 錯誤對象
   */
  _handleError(error) {
    if (error.code === "ECONNREFUSED") {
      log.error(`無法連接到服務器，連接被拒絕: ${error.message}`);
    } else if (error.code === "ETIMEDOUT") {
      log.error(`連接服務器超時: ${error.message}`);
    } else {
      log.error(`WebSocket錯誤: ${error.message}`);
    }

    if (this._callbacks.onerror) {
      this._callbacks.onerror(error);
    }
  }

  /**
   * 處理 WebSocket 關閉
   * @param {number} code - 關閉碼
   * @param {Buffer} reason - 關閉原因
   */
  _handleClose(code, reason) {
    const reasonStr = reason ? reason.toString() : "";

    log.info(`WebSocket連接已關閉: ${code} - ${reasonStr}`);

    // 1002 是協議錯誤，通常是因為 id/secret_key 錯誤
    if (code === 1002) {
      log.error(`WebSocket協議錯誤 (${code}): ${reasonStr}`);
      log.error("可能原因: ID 或 Secret Key 不正確");
      this.isManualClose = true;
      this.shouldReconnect = false;
    }

    this._cleanup();

    // 觸發斷開連接事件
    if (this._callbacks.ondisconnected) {
      this._callbacks.ondisconnected(code, reasonStr);
    }

    // 排程重連
    if (!this.isManualClose && this.shouldReconnect) {
      this._scheduleReconnect();
    }
  }

  /**
   * 清理資源
   */
  _cleanup() {
    this._stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 停止聚合器中的所有客戶端
    if (this.aggregator) {
      this.aggregator.stopAll();
    }
  }

  /**
   * 排程重連
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.info(`已達到最大重連次數 (${this.maxReconnectAttempts})，停止重連`);
      this.shouldReconnect = false;
      return;
    }

    // 指數退避
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

  /**
   * 斷開連接
   */
  disconnect() {
    log.info("手動斷開連接");
    this.isManualClose = true;
    this.shouldReconnect = false;
    this._cleanup();

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

  /**
   * 手動重連
   */
  reconnect() {
    log.info("手動觸發重連...");
    this.isManualClose = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    // 先清理
    this.isManualClose = true; // 避免 cleanup 觸發 scheduleReconnect
    this._cleanup();
    this.isManualClose = false;

    // 使用較短延遲確保舊連接完全清理
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 500);
  }

  /**
   * 檢查是否已連接
   * @returns {boolean}
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 註冊事件監聽
   * @param {'connected'|'disconnected'|'error'|'clientinitialized'|'allclientsready'} event - 事件名稱
   * @param {Function} callback - 回調函數
   */
  on(event, callback) {
    const validEvents = [
      "connected",
      "disconnected",
      "error",
      "clientinitialized",
      "allclientsready",
    ];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = callback;
    }
  }

  /**
   * 移除事件監聽
   * @param {'connected'|'disconnected'|'error'|'clientinitialized'|'allclientsready'} event - 事件名稱
   */
  off(event) {
    const validEvents = [
      "connected",
      "disconnected",
      "error",
      "clientinitialized",
      "allclientsready",
    ];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = null;
    }
  }
}