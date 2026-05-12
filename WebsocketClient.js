import WebSocket from "ws";

/**
 * WebsocketClient - 專門負責 WebSocket 連接和自動重連的模塊
 * 不包含任何 MCP 相關的業務邏輯
 */
export default class WebsocketClient {
  constructor(options = {}) {
    this.url = options.url;
    this.protocols = options.protocols;
    
    // 重連配置
    this.maxReconnectAttempts = Math.max(1, parseInt(options.maxReconnectAttempts) || 10);
    this.reconnectDelay = Math.max(100, parseInt(options.reconnectDelay) || 3000);
    this.reconnectAttempts = 0;
    
    // 心跳配置
    this.pingInterval = Math.max(5000, parseInt(options.pingInterval) || 30000);
    this.maxMissedPongs = Math.max(1, parseInt(options.maxMissedPongs) || 3);
    
    // 內部狀態
    this.ws = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.missedPongs = 0;
    this.shouldReconnect = true;
    this.isManualClose = false;
    
    // 事件回調
    this.onOpen = options.onOpen || null;
    this.onClose = options.onClose || null;
    this.onError = options.onError || null;
    this.onMessage = options.onMessage || null;
    this.onReconnecting = options.onReconnecting || null;
    this.onReconnected = options.onReconnected || null;
    this.onReconnectFailed = options.onReconnectFailed || null;
  }
  
  /**
   * 建立 WebSocket 連接
   */
  connect() {
    if (!this.url) {
      this._emitError(new Error("URL 未指定"));
      return;
    }
    
    this._cleanup();
    
    try {
      this.ws = this.protocols 
        ? new WebSocket(this.url, this.protocols)
        : new WebSocket(this.url);
      
      this.ws.on("open", this._handleOpen.bind(this));
      this.ws.on("message", this._handleMessage.bind(this));
      this.ws.on("error", this._handleError.bind(this));
      this.ws.on("close", this._handleClose.bind(this));
      this.ws.on("pong", this._handlePong.bind(this));
    } catch (err) {
      this._emitError(err);
    }
  }
  
  /**
   * 發送消息
   * @param {string|Buffer|ArrayBuffer|TypedArray} data 
   * @returns {boolean}
   */
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(data);
      return true;
    } catch (err) {
      this._emitError(err);
      return false;
    }
  }
  
  /**
   * 斷開連接（手動關閉，不再自動重連）
   */
  disconnect() {
    this.isManualClose = true;
    this.shouldReconnect = false;
    this._cleanup();
  }
  
  /**
   * 強制重連
   */
  reconnect() {
    this.isManualClose = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    
    this._cleanup();
    
    // 確保舊連接完全清理後再建立新連接
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
   * 檢查是否正在連接中
   * @returns {boolean}
   */
  isConnecting() {
    return this.ws && this.ws.readyState === WebSocket.CONNECTING;
  }
  
  /**
   * 獲取當前 WebSocket 實例（外部不應直接操作）
   * @returns {WebSocket|null}
   */
  getWs() {
    return this.ws;
  }
  
  // ==================== 私有方法 ====================
  
  /**
   * 處理連接打開事件
   * @private
   */
  _handleOpen() {
    this.reconnectAttempts = 0;
    this.missedPongs = 0;
    this._startPing();
    
    if (this.onOpen) {
      this.onOpen();
    }
  }
  
  /**
   * 處理收到的消息
   * @param {string|Buffer|ArrayBuffer|TypedArray} data
   * @private
   */
  _handleMessage(data) {
    if (this.onMessage) {
      this.onMessage(data);
    }
  }
  
  /**
   * 處理錯誤事件
   * @param {Error} error
   * @private
   */
  _handleError(error) {
    if (this.onError) {
      this.onError(error);
    }
  }
  
  /**
   * 處理連接關閉事件
   * @param {number} code
   * @param {Buffer|string} reason
   * @private
   */
  _handleClose(code, reason) {
    const reasonStr = reason ? reason.toString() : "";
    
    // 1002 是協議錯誤，通常表示認證失敗或連接被拒絕
    // 這種情況下不應該自動重連
    if (code === 1002) {
      if (this.onError) {
        this.onError(new Error(`WebSocket 協議錯誤 (${code}): ${reasonStr}`));
      }
      this.shouldReconnect = false;
      this.isManualClose = true;
    }
    
    this._cleanup();
    
    if (this.onClose) {
      this.onClose(code, reasonStr);
    }
    
    // 排程重連
    if (!this.isManualClose && this.shouldReconnect) {
      this._scheduleReconnect();
    }
  }
  
  /**
   * 處理 pong 響應
   * @private
   */
  _handlePong() {
    this.missedPongs = 0;
  }
  
  /**
   * 啟動心跳機制
   * @private
   */
  _startPing() {
    this._stopPing();
    this.missedPongs = 0;
    
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (this.missedPongs >= this.maxMissedPongs) {
          console.warn(`[WebsocketClient] 連續 ${this.maxMissedPongs} 次未收到 pong，認為連接已斷開`);
          this.ws.terminate();
          return;
        }
        this.ws.ping();
        this.missedPongs++;
      }
    }, this.pingInterval);
  }
  
  /**
   * 停止心跳
   * @private
   */
  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  
  /**
   * 排程自動重連
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[WebsocketClient] 已達到最大重連次數 (${this.maxReconnectAttempts})，停止重連`);
      this.shouldReconnect = false;
      
      if (this.onReconnectFailed) {
        this.onReconnectFailed(this.reconnectAttempts);
      }
      return;
    }
    
    // 指數退避，最大延遲 60 秒
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
      60000
    );
    this.reconnectAttempts++;
    
    console.info(`[WebsocketClient] 將在 ${Math.round(delay)}ms 後進行第 ${this.reconnectAttempts} 次重連嘗試`);
    
    if (this.onReconnecting) {
      this.onReconnecting(this.reconnectAttempts, delay);
    }
    
    this.reconnectTimer = setTimeout(() => {
      if (!this.isManualClose && this.shouldReconnect) {
        this.connect();
        if (this.onReconnected) {
          this.onReconnected(this.reconnectAttempts);
        }
      }
    }, delay);
  }
  
  /**
   * 清理資源
   * @private
   */
  _cleanup() {
    // 停止心跳
    this._stopPing();
    
    // 清除重連計時器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 清理 WebSocket
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
   * 發射錯誤事件
   * @param {Error} error
   * @private
   */
  _emitError(error) {
    if (this.onError) {
      this.onError(error);
    }
  }
}