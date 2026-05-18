import MCPClient from "./MCPClient.js";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

/**
 * MCPServerAggregator - MCP 服務器聚合器
 *
 * 根據配置啟動多個 MCPClient，在接收到 call tool 時根據 tool name
 * 尋找對應的 MCPClient 並將請求轉發給該 MCPClient。
 */
export default class MCPServerAggregator {
  /**
   * @param {Object} options - 配置選項
   * @param {Array<Object>} options.servers - 服務器配置數組
   * @param {string} options.servers[].name - 服務器名稱（唯一標識）
   * @param {string|string[]} options.servers[].cmd - 要執行的命令
   */
  constructor(options = {}) {
    this.servers = options.servers || [];
    this.clients = new Map(); // name -> MCPClient
    this.clientTools = new Map(); // clientName -> Set<toolName>
    this.allTools = []; // 所有工具的扁平列表
    this._initializedClients = new Set();
    this._initializedCount = 0;
    this._readyPromise = null;
    this._readyResolve = null;
    this._readyReject = null;
    this._clientRequestIdCounters = new Map(); // clientName -> nextRequestId

    // 事件回調
    this._callbacks = {
      onclientinitialized: null,
      onallclientsready: null,
      ontoolregistered: null,
      onerror: null,
    };

    // 每個 client 的 pending 請求（用於處理 call tool 響應）
    this._pendingRequests = new Map(); // requestId -> { resolve, reject, clientName }
    this._requestId = 0;

    // 初始化客戶端
    this._initClients();
  }

  /**
   * 初始化所有客戶端
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._readyPromise) {
      return this._readyPromise;
    }

    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });

    const clientNames = Array.from(this.clients.keys());
    if (clientNames.length === 0) {
      log.warn("沒有配置任何服務器");
      this._readyResolve([]);
      return this._readyPromise;
    }

    log.info(`開始初始化 ${clientNames.length} 個客戶端...`);

    for (const name of clientNames) {
      // 初始化該客戶端的請求 ID 計數器
      this._clientRequestIdCounters.set(name, 1000);

      const client = this.clients.get(name);
      try {
        this._setupClientEvents(name, client);
        client.start();
        client.sendInitialize();
      } catch (err) {
        log.error(`啟動客戶端 "${name}" 失敗: ${err.message}`);
        this._emit("error", name, err);
      }
    }

    return this._readyPromise;
  }

  /**
   * 設置客戶端事件監聽
   * @param {string} name - 客戶端名稱
   * @param {MCPClient} client - MCPClient 實例
   */
  _setupClientEvents(name, client) {
    client.on("initialized", () => {
      log.info(`客戶端 "${name}" MCP 初始化完成`);
    });

    client.on("stdout", (line) => {
      // 解析 JSON-RPC 消息
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        // 非 JSON 消息，忽略
        return;
      }

      // 忽略通知消息
      if (parsed.id === undefined && parsed.method) {
        return;
      }

      // 檢查是否是初始化響應
      if (!this._initializedClients.has(name) && parsed.result) {
        // 初始化成功，標記並獲取工具列表
        // 使用客戶端專用的請求 ID
        const requestId = this._getNextClientRequestId(name);
        client.listTools(requestId);
        return;
      }

      // 處理 tools/list 響應
      if (parsed.result && parsed.result.tools && !parsed.error) {
        // 檢查是否已初始化過
        if (this._initializedClients.has(name)) {
          return; // 避免重複處理
        }
        this._handleToolsList(name, parsed.result.tools);
        return;
      }

      // 處理 tools/call 響應
      if (parsed.id !== undefined && this._pendingRequests.has(parsed.id)) {
        const pending = this._pendingRequests.get(parsed.id);
        this._pendingRequests.delete(parsed.id);

        if (parsed.error) {
          if (pending.reject) {
            pending.reject(parsed.error);
          }
        } else if (parsed.result) {
          if (pending.resolve) {
            pending.resolve(parsed.result);
          }
        }
        return;
      }
    });

    client.on("close", (code) => {
      log.info(`客戶端 "${name}" 連接關閉，代碼: ${code}`);
      this._initializedClients.delete(name);
    });

    client.on("error", (err) => {
      log.error(`客戶端 "${name}" 錯誤: ${err.message}`);
      this._emit("error", name, err);
    });
  }

  /**
   * 獲取客戶端的下一個請求 ID
   * @param {string} clientName - 客戶端名稱
   * @returns {number}
   */
  _getNextClientRequestId(clientName) {
    const counter = this._clientRequestIdCounters.get(clientName) || 1000;
    this._clientRequestIdCounters.set(clientName, counter + 1);
    return counter;
  }

  /**
   * 處理工具列表
   * @param {string} clientName - 客戶端名稱
   * @param {Array} tools - 工具數組
   */
  _handleToolsList(clientName, tools) {
    if (this._initializedClients.has(clientName)) {
      // 已初始化過，更新工具列表
      this.clientTools.get(clientName)?.clear();
    }

    this._initializedClients.add(clientName);
    this._initializedCount++;

    // 存儲工具
    const toolSet = new Set();
    for (const tool of tools) {
      const toolInfo = {
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || {},
        clientName: clientName,
      };
      this.allTools.push(toolInfo);
      toolSet.add(tool.name);

      this._emit("toolregistered", clientName, toolInfo);
    }
    this.clientTools.set(clientName, toolSet);

    log.info(`客戶端 "${clientName}" 加載了 ${tools.length} 個工具`);

    // 觸發客戶端初始化完成事件
    this._emit("clientinitialized", clientName, client, tools);

    // 檢查是否所有客戶端都已初始化
    if (this._initializedCount === this.clients.size) {
      log.info("所有客戶端初始化完成");
      this._emit("allclientsready", Array.from(this.clients.keys()));

      if (this._readyResolve) {
        this._readyResolve(Array.from(this.clients.values()));
      }
    }
  }

  /**
   * 初始化客戶端
   * @private
   */
  _initClients() {
    for (const server of this.servers) {
      const name = server.name;
      if (!name) {
        log.warn("服務器配置缺少 name 字段，跳過");
        continue;
      }

      if (this.clients.has(name)) {
        log.warn(`客戶端 "${name}" 已存在，將被覆蓋`);
      }

      const client = new MCPClient(server.cmd, name + "_", {
        autoListTools: false,
      });
      this.clients.set(name, client);

      // 初始化工具集合
      this.clientTools.set(name, new Set());

      log.info(`已創建客戶端 "${name}"`);
    }
  }

  /**
   * 查找工具所屬的客戶端
   * @param {string} toolName - 工具名稱
   * @returns {{ clientName: string, client: MCPClient } | null}
   */
  _findClientByTool(toolName) {
    for (const [clientName, tools] of this.clientTools) {
      if (tools.has(toolName)) {
        const client = this.clients.get(clientName);
        if (client && client.isRunning()) {
          return { clientName, client };
        }
      }
    }
    return null;
  }

  /**
   * 調用工具
   * @param {string} toolName - 工具名稱
   * @param {Object} args - 工具參數
   * @returns {Promise<Object>} 工具執行結果
   */
  async callTool(toolName, args = {}) {
    const target = this._findClientByTool(toolName);

    if (!target) {
      throw new Error(`工具 "${toolName}" 未找到或其所屬客戶端未運行`);
    }

    const { clientName, client } = target;

    return new Promise((resolve, reject) => {
      const id = ++this._requestId;
      this._pendingRequests.set(id, { resolve, reject, clientName });

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      });

      if (!client.write(message)) {
        this._pendingRequests.delete(id);
        reject(new Error(`寫入客戶端 "${clientName}" 失敗`));
      }
    });
  }

  /**
   * 獲取所有工具列表
   * @returns {Array<Object>} 工具數組
   */
  getAllTools() {
    return [...this.allTools];
  }

  /**
   * 獲取所有客戶端名稱
   * @returns {Array<string>}
   */
  getClientNames() {
    return Array.from(this.clients.keys());
  }

  /**
   * 獲取客戶端的工具列表
   * @param {string} clientName - 客戶端名稱
   * @returns {Array<Object>}
   */
  getClientTools(clientName) {
    const toolSet = this.clientTools.get(clientName);
    if (!toolSet) return [];

    return this.allTools.filter((t) => t.clientName === clientName);
  }

  /**
   * 檢查是否所有客戶端都已初始化
   * @returns {boolean}
   */
  isInitialized() {
    return this._initializedCount === this.clients.size;
  }

  /**
   * 獲取客戶端實例
   * @param {string} name - 客戶端名稱
   * @returns {MCPClient | null}
   */
  getClient(name) {
    return this.clients.get(name) || null;
  }

  /**
   * 註冊事件監聽
   * @param {'clientinitialized'|'allclientsready'|'toolregistered'|'error'} event - 事件名稱
   * @param {Function} callback - 回調函數
   */
  on(event, callback) {
    const eventMap = {
      clientinitialized: "onclientinitialized",
      allclientsready: "onallclientsready",
      toolregistered: "ontoolregistered",
      error: "onerror",
    };

    const callbackName = eventMap[event];
    if (callbackName) {
      this._callbacks[callbackName] = callback;
    }
  }

  /**
   * 移除事件監聽
   * @param {'clientinitialized'|'allclientsready'|'toolregistered'|'error'} event - 事件名稱
   */
  off(event) {
    const eventMap = {
      clientinitialized: "onclientinitialized",
      allclientsready: "onallclientsready",
      toolregistered: "ontoolregistered",
      error: "onerror",
    };

    const callbackName = eventMap[event];
    if (callbackName) {
      this._callbacks[callbackName] = null;
    }
  }

  /**
   * 觸發事件
   * @param {string} event - 事件名稱
   * @param {...*} args - 事件參數
   */
  _emit(event, ...args) {
    const eventMap = {
      clientinitialized: "onclientinitialized",
      allclientsready: "onallclientsready",
      toolregistered: "ontoolregistered",
      error: "onerror",
    };

    const callbackName = eventMap[event];
    if (callbackName && this._callbacks[callbackName]) {
      try {
        this._callbacks[callbackName](...args);
      } catch (err) {
        log.error(`事件監聽器執行失敗: ${err.message}`);
      }
    }
  }

  /**
   * 停止所有客戶端
   */
  stopAll() {
    log.info("正在停止所有客戶端...");

    for (const [name, client] of this.clients) {
      try {
        client.stop();
        log.info(`已停止客戶端 "${name}"`);
      } catch (err) {
        log.error(`停止客戶端 "${name}" 失敗: ${err.message}`);
      }
    }

    // 清理狀態
    this._initializedClients.clear();
    this._initializedCount = 0;
    this._readyPromise = null;
    this._readyResolve = null;
    this._readyReject = null;
    this._pendingRequests.clear();
  }

  /**
   * 重啟指定客戶端
   * @param {string} name - 客戶端名稱
   */
  restartClient(name) {
    const client = this.clients.get(name);
    if (!client) {
      log.warn(`客戶端 "${name}" 不存在`);
      return;
    }

    log.info(`重啟客戶端 "${name}"...`);

    // 標記為未初始化
    this._initializedClients.delete(name);

    // 停止並重啟
    client.stop();

    // 延遲重啟以確保進程完全退出
    setTimeout(() => {
      try {
        client.start();
        client.sendInitialize();
        log.info(`客戶端 "${name}" 已重啟`);
      } catch (err) {
        log.error(`重啟客戶端 "${name}" 失敗: ${err.message}`);
      }
    }, 1000);
  }

  /**
   * 重啟所有客戶端
   */
  restartAll() {
    for (const name of this.clients.keys()) {
      this.restartClient(name);
    }
  }
}
