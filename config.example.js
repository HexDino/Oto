/**
 * Mau cau hinh. Copy file nay thanh config.local.js roi dien key vao.
 * config.local.js KHONG nen commit/chia se.
 */
self.ECO_CONFIG = {
  claude: {
    baseUrl: 'https://api.anthropic.com',
    apiVersion: '2023-06-01',
    maxTokens: 900,
    models: {
      fast: 'claude-haiku-5-5', // câu hỏi chữ, rẻ
      smart: 'claude-sonnet-5-5' // có ảnh biển báo / cần suy luận sâu
    },
    keys: ['sk-ant-...', 'sk-ant-...']
  }
};
