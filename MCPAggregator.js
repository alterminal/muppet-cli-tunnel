import MCPClient from "./MCPClient.js";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

/**
 * MCPAggregator - MCP 客戶端聚合器
 *
 * 管理多個 MCPClient 實例，聚合它們的工具列表，
 * 並提供統一的事件接口。
 */
export default class McpServerAggregator {
  /**
   * @param {Object} options - 配置選項
   * @param {Array} options.servers - 服務器配置列表，每項包含 name 和 cmd
   * @param {Object} options.aggregatorOptions - 聚合器級別的選項（如 WebSocket 連接等）
   */
  constructor(options = {}) {
    this.servers = options.servers || [];
    this.aggregatorOptions = options.aggregatorOptions || {};
    
    // 客戶端 Map: name -> { client, tools }
    this.clients = new Map();
    
    // 工具列表: 所有客戶端的工具合併
    this.allTools = [];
    
    // 初始化狀態
    this._initialized = false;
    this._initializing = false;
    
    // 事件監聽器
    this._eventListeners = {
      clientinitialized: [],
      allclientsready: [],
      toolregistered: [],
      error: [],
      clientclosed: [],
    };
    
    // 待處理的初始化 Promise
    this._initPromise = null;
  }

  /**
   * 註冊事件監聽器
   * @param {'clientinitialized'|'allclientsready'|'toolregistered'|'error'|'clientclosed'} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (this._eventListeners[event]) {
      this._eventListeners[event].push(callback);
    } else {
      log.warn(`未知的事件類型: ${event}`);
    }
  }

  /**
   * 移除事件監聽器
   * @param {'clientinitialized'|'allclientsready'|'toolregistered'|'error'|'clientclosed'} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this._eventListeners[event]) {
      const index = this._eventListeners[event].indexOf(callback);
      if (index > -1) {
        this._eventListeners[event].splice(index, 1);
      }
    }
  }

  /**
   * 觸發事件
   * @param {string} event
   * @param {...any} args
   */
  _emit(event, ...args) {
    if (this._eventListeners[event]) {
      for (const listener of this._eventListeners[event]) {
        try {
          listener(...args);
        } catch (err) {
          log.error(`事件監聽器執行失敗: ${err.message}`);
        }
      }
    }
  }

  /**
   * 獲取所有已註冊的工具
   * @returns {Array} 工具列表
   */
  getAllTools() {
    return this.allTools;
  }

  /**
   * 獲取所有客戶端名稱
   * @returns {string[]} 客戶端名稱列表
   */
  getClientNames() {
    return Array.from(this.clients.keys());
  }

  /**
   * 檢查是否所有客戶端都已初始化
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * 獲取特定客戶端的工具列表
   * @param {string} clientName
   * @returns {Array|null}
   */
  getClientTools(clientName) {
    const clientInfo = this.clients.get(clientName);
    return clientInfo ? clientInfo.tools : null;
  }

  /**
   * 獲取客戶端實例
   * @param {string} clientName
   * @returns {MCPClient|null}
   */
  getClient(clientName) {
    const clientInfo = this.clients.get(clientName);
    return clientInfo ? clientInfo.client : null;
  }

  /**
   * 根據工具名稱查找對應的客戶端
   * @param {string} toolName
   * @returns {{ clientName: string, client: MCPClient }|null}
   */
  findToolClient(toolName) {
    for (const [clientName, clientInfo] of this.clients) {
      const tool = clientInfo.tools.find(t => t.name === toolName);
      if (tool) {
        return { clientName, client: clientInfo.client };
      }
    }
    return null;
  }

  /**
   * 初始化並啟動所有 MCP 客戶端
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) {
      log.warn("聚合器已經初始化");
      return;
    }

    if (this._initializing) {
      return this._initPromise;
    }

    this._initializing = true;
    this._initPromise = this._doInitialize();
    
    try {
      await this._initPromise;
      this._initialized = true;
    } finally {
      this._initializing = false;
      this._initPromise = null;
    }
  }

  /**
   * 執行實際的初始化邏輯
   * @returns {Promise<void>}
   */
  async _doInitialize() {
    log.info(`開始初始化 ${this.servers.length} 個 MCP 客戶端...`);

    // 創建並啟動所有客戶端
    const initPromises = this.servers.map((serverConfig) =>
      this._startClient(serverConfig)
    );

    // 等待所有客戶端初始化完成
    await Promise.all(initPromises);

    log.info("所有 MCP 客戶端初始化完成");
    this._emit("allclientsready", this.getClientNames());
  }

  /**
   * 啟動單個 MCP 客戶端
   * @param {Object} serverConfig - 服務器配置
   * @param {string} serverConfig.name - 客戶端名稱
   * @param {string|string[]} serverConfig.cmd - 執行命令
   * @returns {Promise<void>}
   */
  async _startClient(serverConfig) {
    const { name, cmd } = serverConfig;
    
    if (!name || !cmd) {
      log.error(`客戶端配置不完整，跳過: ${JSON.stringify(serverConfig)}`);
      return;
    }

    log.info(`啟動客戶端 "${name}": ${Array.isArray(cmd) ? cmd.join(" ") : cmd}`);

    return new Promise((resolve) => {
      const client = new MCPClient(cmd);
      
      // 設置事件監聽
      client.on("initialized", () => {
        log.info(`客戶端 "${name}" MCP 初始化完成`);
      });

      client.on("error", (err) => {
        log.error(`客戶端 "${name}" 錯誤: ${err.message}`);
        this._emit("error", name, err);
      });

      client.on("close", (code) => {
        log.info(`客戶端 "${name}" 連接關閉，代碼: ${code}`);
        this._emit("clientclosed", name, code);
      });

      // 監聽工具列表加載完成
      client.onToolsLoaded((tools) => {
        log.info(`客戶端 "${name}" 工具加載完成，共 ${tools.length} 個工具`);
        
        // 為每個工具標記來源客戶端名稱
        const taggedTools = tools.map(tool => ({
          ...tool,
          clientName: name,
        }));
        
        // 添加到工具列表
        for (const tool of taggedTools) {
          this.allTools.push(tool);
          this._emit("toolregistered", name, tool);
        }

        // 更新客戶端信息
        const clientInfo = this.clients.get(name);
        if (clientInfo) {
          clientInfo.tools = taggedTools;
        }

        // 觸發客戶端初始化完成事件
        this._emit("clientinitialized", name, client, taggedTools);
        
        resolve();
      });

      // 保存客戶端實例
      this.clients.set(name, {
        client,
        tools: [],
      });

      // 啟動客戶端
      client.start();
      
      // 發送初始化請求
      client.sendInitialize();

      // 設置超時：如果一段時間後仍未收到工具列表，也標記為完成
      setTimeout(() => {
        const clientInfo = this.clients.get(name);
        if (clientInfo && clientInfo.tools.length === 0) {
          log.warn(`客戶端 "${name}" 工具列表超時，視為已完成`);
          this._emit("clientinitialized", name, client, []);
          resolve();
        }
      }, 30000);
    });
  }

  /**
   * 停止所有 MCP 客戶端
   */
  stopAll() {
    log.info("停止所有 MCP 客戶端...");
    
    for (const [name, clientInfo] of this.clients) {
      try {
        clientInfo.client.stop();
        log.info(`已停止客戶端 "${name}"`);
      } catch (err) {
        log.error(`停止客戶端 "${name}" 失敗: ${err.message}`);
      }
    }

    // 清空客戶端列表
    this.clients.clear();
    this.allTools = [];
    this._initialized = false;
  }

  /**
   * 停止特定客戶端
   * @param {string} clientName
   */
  stopClient(clientName) {
    const clientInfo = this.clients.get(clientName);
    if (clientInfo) {
      clientInfo.client.stop();
      this.clients.delete(clientName);
      // 從 allTools 中移除該客戶端的工具
      this.allTools = this.allTools.filter(
        tool => tool.clientName !== clientName
      );
      log.info(`已停止客戶端 "${clientName}"`);
    }
  }

  /**
   * 重啟特定客戶端
   * @param {string} clientName
   * @returns {Promise<void>}
   */
  async restartClient(clientName) {
    const serverConfig = this.servers.find(s => s.name === clientName);
    if (!serverConfig) {
      throw new Error(`找不到客戶端配置: ${clientName}`);
    }

    // 停止舊客戶端
    this.stopClient(clientName);

    // 重新啟動
    await this._startClient(serverConfig);
  }

  /**
   * 獲取狀態信息
   * @returns {Object}
   */
  getStatus() {
    const status = {
      initialized: this._initialized,
      totalClients: this.clients.size,
      totalTools: this.allTools.length,
      clients: {},
    };

    for (const [name, clientInfo] of this.clients) {
      status.clients[name] = {
        running: clientInfo.client.isRunning(),
        toolsCount: clientInfo.tools.length,
      };
    }

    return status;
  }
}

// 導出別名，保持與測試腳本一致
export { McpServerAggregator as default };
