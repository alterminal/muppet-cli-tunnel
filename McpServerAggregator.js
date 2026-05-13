import McpClient from "./McpClient.js";

// 日誌工具函數，統一日誌格式
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`),
};

/**
 * McpServerAggregator - MCP 服務器聚合器
 *
 * 負責管理多個 McpClient，收集它們的工具，
 * 並提供通過工具名稱找到對應客戶端的能力。
 */
export default class McpServerAggregator {
  /**
   * @param {Object} options - 配置選項
   * @param {Array<Object>} options.servers - 服務器配置數組
   * @param {string} options.servers[].name - 服務器名稱
   * @param {string|string[]} options.servers[].cmd - 啟動命令
   * @param {number} [options.servers[].maxReconnectAttempts] - 最大重連次數
   * @param {number} [options.servers[].reconnectDelay] - 重連延遲(毫秒)
   */
  constructor(options = {}) {
    this.servers = options.servers || [];
    this.clients = new Map(); // name -> McpClient
    this.toolsMap = new Map(); // toolName -> { clientName, client, tool }
    this._pendingToolRequests = new Map();
    this._requestId = 0;
    this._initialized = false;
    this._initPromise = null;
    this._callbacks = {
      onclientinitialized: null,
      onallclientsready: null,
      onerror: null,
      ontoolregistered: null,
    };
  }

  /**
   * 初始化所有 McpClient
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInitialize();
    return this._initPromise;
  }

  /**
   * 實際初始化邏輯
   * @returns {Promise<void>}
   */
  async _doInitialize() {
    if (this.servers.length === 0) {
      log.warn("沒有配置任何服務器");
      this._initialized = true;
      return;
    }

    log.info(`開始初始化 ${this.servers.length} 個 MCP 服務器...`);

    // 創建並啟動所有客戶端
    const initPromises = this.servers.map((serverConfig) => {
      return this._createAndStartClient(serverConfig);
    });

    // 等待所有客戶端準備就緒
    await Promise.all(initPromises);

    this._initialized = true;
    log.info(`所有 MCP 服務器初始化完成，已註冊 ${this.toolsMap.size} 個工具`);

    if (this._callbacks.onallclientsready) {
      this._callbacks.onallclientsready(Array.from(this.clients.values()));
    }
  }

  /**
   * 創建並啟動單個 McpClient
   * @param {Object} serverConfig - 服務器配置
   * @returns {Promise<McpClient>}
   */
  async _createAndStartClient(serverConfig) {
    const { name, cmd } = serverConfig;
    const client = new McpClient(cmd);

    // 存入 clients Map
    this.clients.set(name, client);

    return new Promise((resolve, reject) => {
      // 監聽工具加載完成
      client.onToolsLoaded((tools) => {
        this._registerTools(name, client, tools);
        log.info(`客戶端 "${name}" 已加載 ${tools.length} 個工具`);

        if (this._callbacks.onclientinitialized) {
          this._callbacks.onclientinitialized(name, client, tools);
        }
      });

      // 監聽客戶端錯誤
      client.on("error", (err) => {
        log.error(`客戶端 "${name}" 發生錯誤: ${err.message}`);
        if (this._callbacks.onerror) {
          this._callbacks.onerror(name, err);
        }
      });

      // 監聽客戶端關閉
      client.on("close", (code) => {
        log.info(`客戶端 "${name}" 已關閉，退出碼: ${code}`);
        this._unregisterClient(name);
      });

      // 啟動客戶端
      client.start();

      // 發送初始化請求
      const sent = client.sendInitialize();
      if (!sent) {
        reject(new Error(`客戶端 "${name}" 啟動失敗`));
        return;
      }

      // 等待工具加載完成後 resolve
      const checkReady = setInterval(() => {
        if (client.tools.length > 0) {
          clearInterval(checkReady);
          resolve(client);
        }
      }, 100);

      // 超時處理
      setTimeout(() => {
        clearInterval(checkReady);
        if (client.tools.length === 0) {
          log.warn(`客戶端 "${name}" 初始化超時`);
          resolve(client); // 不阻塞其他客戶端
        }
      }, 30000);
    });
  }

  /**
   * 註冊工具到 toolsMap
   * @param {string} clientName - 客戶端名稱
   * @param {McpClient} client - McpClient 實例
   * @param {Array} tools - 工具數組
   */
  _registerTools(clientName, client, tools) {
    for (const tool of tools) {
      // tool 結構: { name, description, inputSchema, ... }
      if (tool.name) {
        this.toolsMap.set(tool.name, {
          clientName,
          client,
          tool,
        });

        if (this._callbacks.ontoolregistered) {
          this._callbacks.ontoolregistered(clientName, tool);
        }
      }
    }
  }

  /**
   * 取消註冊客戶端的工具
   * @param {string} clientName - 客戶端名稱
   */
  _unregisterClient(clientName) {
    for (const [toolName, info] of this.toolsMap.entries()) {
      if (info.clientName === clientName) {
        this.toolsMap.delete(toolName);
      }
    }
  }

  /**
   * 調用工具
   * @param {string} toolName - 工具名稱
   * @param {Object} arguments - 工具參數
   * @returns {Promise<Object>} 工具調用結果
   */
  async tool_call(toolName, args = {}) {
    const toolInfo = this.toolsMap.get(toolName);

    if (!toolInfo) {
      throw new Error(
        `未找到工具: ${toolName}。可用工具: ${Array.from(this.toolsMap.keys()).join(", ")}`,
      );
    }

    const { client, clientName } = toolInfo;
    log.info(`調用工具 "${toolName}" (客戶端: ${clientName})`);

    return new Promise((resolve, reject) => {
      const id = ++this._requestId;
      this._pendingToolRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      });

      // 監聽客戶端的輸出
      const handleOutput = (line) => {
        try {
          const response = JSON.parse(line);

          // 檢查是否是對當前請求的響應
          if (response.id === id) {
            client.off("stdout", handleOutput);
            this._pendingToolRequests.delete(id);

            if (response.error) {
              reject(
                new Error(`工具調用失敗: ${JSON.stringify(response.error)}`),
              );
            } else {
              resolve(response.result);
            }
          }
        } catch (e) {
          // 忽略解析錯誤
        }
      };

      client.on("stdout", handleOutput);

      if (!client.write(message)) {
        client.off("stdout", handleOutput);
        this._pendingToolRequests.delete(id);
        reject(new Error(`向客戶端 "${clientName}" 寫入消息失敗`));
      }

      // 設置超時
      setTimeout(() => {
        if (this._pendingToolRequests.has(id)) {
          client.off("stdout", handleOutput);
          this._pendingToolRequests.delete(id);
          reject(new Error(`工具 "${toolName}" 調用超時`));
        }
      }, 60000);
    });
  }

  /**
   * 獲取所有已註冊的工具
   * @returns {Array<Object>} 工具列表
   */
  getAllTools() {
    return Array.from(this.toolsMap.values()).map((info) => ({
      name: info.tool.name,
      description: info.tool.description,
      inputSchema: info.tool.inputSchema,
      clientName: info.clientName,
    }));
  }

  /**
   * 獲取工具的詳細信息
   * @param {string} toolName - 工具名稱
   * @returns {Object|null} 工具信息
   */
  getTool(toolName) {
    return this.toolsMap.get(toolName) || null;
  }

  /**
   * 獲取指定客戶端
   * @param {string} clientName - 客戶端名稱
   * @returns {McpClient|null}
   */
  getClient(clientName) {
    return this.clients.get(clientName) || null;
  }

  /**
   * 獲取所有客戶端名稱
   * @returns {string[]}
   */
  getClientNames() {
    return Array.from(this.clients.keys());
  }

  /**
   * 檢查工具是否存在
   * @param {string} toolName - 工具名稱
   * @returns {boolean}
   */
  hasTool(toolName) {
    return this.toolsMap.has(toolName);
  }

  /**
   * 停止所有客戶端
   */
  stopAll() {
    log.info("停止所有 MCP 客戶端...");
    for (const [name, client] of this.clients.entries()) {
      client.stop();
    }
    this.clients.clear();
    this.toolsMap.clear();
    this._initialized = false;
    this._initPromise = null;
  }

  /**
   * 重啟指定客戶端
   * @param {string} clientName - 客戶端名稱
   * @returns {Promise<void>}
   */
  async restartClient(clientName) {
    const client = this.clients.get(clientName);
    if (!client) {
      throw new Error(`客戶端 "${clientName}" 不存在`);
    }

    log.info(`重啟客戶端 "${clientName}"...`);
    client.stop();

    // 找到對應的配置
    const serverConfig = this.servers.find((s) => s.name === clientName);
    if (!serverConfig) {
      throw new Error(`找不到客戶端 "${clientName}" 的配置`);
    }

    // 等待一段時間讓進程完全退出
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 重新創建並啟動
    await this._createAndStartClient(serverConfig);
  }

  /**
   * 註冊事件回調
   * @param {'clientinitialized'|'allclientsready'|'error'|'toolregistered'} event - 事件名稱
   * @param {Function} callback - 回調函數
   */
  on(event, callback) {
    const validEvents = [
      "clientinitialized",
      "allclientsready",
      "error",
      "toolregistered",
    ];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = callback;
    }
  }

  /**
   * 移除事件回調
   * @param {'clientinitialized'|'allclientsready'|'error'|'toolregistered'} event - 事件名稱
   */
  off(event) {
    const validEvents = [
      "clientinitialized",
      "allclientsready",
      "error",
      "toolregistered",
    ];
    if (validEvents.includes(event)) {
      this._callbacks["on" + event] = null;
    }
  }

  /**
   * 獲取初始化狀態
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }
}
