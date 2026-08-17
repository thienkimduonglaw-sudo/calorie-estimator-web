import fs from 'fs';
import path from 'path';
import os from 'os';

export default async function handler(req, res) {
  const rootDir = process.cwd();
  const tmpDir = os.tmpdir();
  const tmpQueuePath = path.join(tmpDir, 'content-queue.json');
  const rootQueuePath = path.join(rootDir, 'content-queue.json');

  let queuePath = rootQueuePath;
  if (fs.existsSync(tmpQueuePath)) {
    queuePath = tmpQueuePath;
  } else if (fs.existsSync(rootQueuePath)) {
    try {
      fs.copyFileSync(rootQueuePath, tmpQueuePath);
      queuePath = tmpQueuePath;
    } catch (e) {
      queuePath = rootQueuePath;
    }
  }

  if (!fs.existsSync(queuePath)) {
    return res.status(500).json({ error: 'content-queue.json not found' });
  }

  const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const config = data.config || {};
  const queue = data.queue || [];

  if (req.method === 'GET') {
    return res.status(200).json({
      config,
      totalTopics: queue.length,
      publishedCount: queue.filter(i => i.status === 'published').length,
      draftCount: queue.filter(i => i.status === 'draft').length,
      pendingCount: queue.filter(i => i.status === 'pending').length,
      queue
    });
  }

  if (req.method === 'POST') {
    const { action, topicId, autoPublishEnabled, autoPublishHours } = req.body || {};

    if (action === 'toggle-config') {
      if (typeof autoPublishEnabled === 'boolean') config.autoPublishEnabled = autoPublishEnabled;
      if (typeof autoPublishHours === 'number') config.autoPublishHours = autoPublishHours;

      try {
        fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        fs.writeFileSync(tmpQueuePath, JSON.stringify(data, null, 2), 'utf8');
      }

      return res.status(200).json({
        success: true,
        message: `Đã cập nhật cấu hình: Auto-Publish = ${config.autoPublishEnabled}, Thời gian chờ = ${config.autoPublishHours}h.`,
        config
      });
    }

    if (action === 'approve' && topicId) {
      const item = queue.find(i => i.id === topicId);
      if (!item) return res.status(404).json({ error: 'Chủ đề không tồn tại' });

      item.status = 'published';
      item.publishedAt = new Date().toISOString().split('T')[0];

      try {
        fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        fs.writeFileSync(tmpQueuePath, JSON.stringify(data, null, 2), 'utf8');
      }

      return res.status(200).json({
        success: true,
        message: `Đã phê duyệt thủ công bài viết "${item.topic}".`,
        item
      });
    }

    if (action === 'reject' && topicId) {
      const item = queue.find(i => i.id === topicId);
      if (!item) return res.status(404).json({ error: 'Chủ đề không tồn tại' });

      item.status = 'pending';
      delete item.draftCreatedAt;
      delete item.draftSlug;

      try {
        fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {
        fs.writeFileSync(tmpQueuePath, JSON.stringify(data, null, 2), 'utf8');
      }

      return res.status(200).json({
        success: true,
        message: `Đã từ chối bản nháp "${item.topic}".`,
        item
      });
    }

    return res.status(400).json({ error: 'Hành động không hợp lệ' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
