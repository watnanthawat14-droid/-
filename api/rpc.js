const { handlers } = require('../lib/core');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = String(body.fn || ''), args = Array.isArray(body.args) ? body.args : [];
    if (!Object.prototype.hasOwnProperty.call(handlers, fn)) { res.status(400).json({ error: 'ไม่พบคำสั่งนี้' }); return; }
    const result = await handlers[fn](...args);
    res.status(200).json({ result });
  } catch (e) {
    if (e && e.user) { res.status(400).json({ error: e.message }); return; }
    console.error(e);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์ กรุณาลองใหม่' });
  }
};
