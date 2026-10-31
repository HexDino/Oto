/**
 * Mau cau hinh. Copy file nay thanh config.local.js roi dien key vao.
 * config.local.js KHONG nen commit/chia se.
 */
self.ECO_CONFIG = {
  claude: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    apiVersion: '2023-06-01',
    maxTokens: 400,
    keys: ['sk-ant-...', 'sk-ant-...']
  }
};
