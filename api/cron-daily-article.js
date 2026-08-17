import fs from 'fs';
import path from 'path';
import os from 'os';

function removeVietnameseTones(str) {
  if (!str) return '';
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
  str = str.replace(/đ/g, 'd');
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
  str = str.replace(/Đ/g, 'D');
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export default async function handler(req, res) {
  const rootDir = process.cwd();
  const tmpDir = os.tmpdir();
  const tmpQueuePath = path.join(tmpDir, 'content-queue.json');
  const rootQueuePath = path.join(rootDir, 'content-queue.json');

  // Copy seed queue to /tmp if not already there
  let queuePath = rootQueuePath;
  if (!fs.existsSync(tmpQueuePath) && fs.existsSync(rootQueuePath)) {
    try {
      fs.copyFileSync(rootQueuePath, tmpQueuePath);
      queuePath = tmpQueuePath;
    } catch (e) {
      queuePath = rootQueuePath;
    }
  } else if (fs.existsSync(tmpQueuePath)) {
    queuePath = tmpQueuePath;
  }

  if (!fs.existsSync(queuePath)) {
    return res.status(500).json({ error: 'content-queue.json not found' });
  }

  const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const queue = data.queue || [];
  const config = data.config || {};

  // Check auto-publish draft after X hours
  const now = new Date();
  let draftToPublish = null;

  for (const item of queue) {
    if (item.status === 'draft' && item.draftCreatedAt && config.autoPublishEnabled) {
      const createdAt = new Date(item.draftCreatedAt);
      const hoursDiff = (now - createdAt) / (1000 * 60 * 60);
      if (hoursDiff >= (config.autoPublishHours || 12)) {
        draftToPublish = item;
        break;
      }
    }
  }

  if (draftToPublish) {
    return await publishDraft(draftToPublish, data, queuePath, tmpDir, rootDir, res);
  }

  const pendingTopic = queue.find(item => item.status === 'pending');
  if (!pendingTopic) {
    return res.status(200).json({ message: 'Tất cả chủ đề trong Content Queue đã được xử lý!' });
  }

  const publishedArticles = queue.filter(item => item.status === 'published');
  const slug = removeVietnameseTones(pendingTopic.primaryKeyword);

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const articleHtml = apiKey 
      ? await generateArticleWithGemini(pendingTopic, publishedArticles, slug, apiKey)
      : generateLocalDraftContent(pendingTopic, slug);

    // Save draft safely in /tmp/drafts
    const draftsDir = path.join(tmpDir, 'drafts');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    const draftFilePath = path.join(draftsDir, `${slug}.html`);
    fs.writeFileSync(draftFilePath, articleHtml, 'utf8');

    // Update queue
    pendingTopic.status = 'draft';
    pendingTopic.draftCreatedAt = new Date().toISOString();
    pendingTopic.draftSlug = `${slug}.html`;

    try {
      fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      // Fallback save to /tmp
      fs.writeFileSync(tmpQueuePath, JSON.stringify(data, null, 2), 'utf8');
    }

    return res.status(200).json({
      success: true,
      message: `Đã sinh bài viết cho chủ đề "${pendingTopic.topic}".`,
      topic: pendingTopic.topic,
      primaryKeyword: pendingTopic.primaryKeyword,
      status: pendingTopic.status,
      autoPublishInHours: config.autoPublishHours || 12,
      note: apiKey ? 'Đã dùng Gemini API sinh nội dung AI chuẩn 100%!' : 'Chưa cài GEMINI_API_KEY trên Vercel.'
    });

  } catch (err) {
    console.error('Error generating daily article:', err);
    return res.status(500).json({ error: err.message || 'Lỗi khi sinh bài viết.' });
  }
}

async function generateArticleWithGemini(topicObj, publishedArticles, slug, apiKey) {
  const prompt = `
Bạn là Chuyên gia Dinh dưỡng Y tế CaloVision.
Hãy viết một bài viết SEO chuẩn y khoa về món/chủ đề "${topicObj.topic}".
Từ khóa chính: "${topicObj.primaryKeyword}"
Từ khóa phụ: ${JSON.stringify(topicObj.secondaryKeywords)}

QUY TẮC BẮT BUỘC:
1. Độ dài: 850-1200 từ.
2. Mỗi đoạn văn CHỈ 2-3 CÂU NGẮN, mỗi câu <25 từ.
3. Có H1, H2 Bảng Dinh Dưỡng Chi Tiết, H2 Ăn Có Béo Không, H2 Mẹo Ăn Healthy, H2 FAQ (5 câu).
4. Trích nguồn Viện Dinh Dưỡng Quốc Gia Việt Nam và USDA.
5. Dòng kiểm duyệt: "Nội dung được kiểm duyệt bởi đội ngũ CaloVision, đối chiếu dữ liệu từ Viện Dinh Dưỡng VN và USDA."
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  const resData = await response.json();
  let text = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.replace(/^```html\s*/i, '').replace(/```$/i, '').trim();
}

function generateLocalDraftContent(topicObj, slug) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${topicObj.topic} Bao Nhiêu Calo?</title></head><body><h1>${topicObj.topic} Bao Nhiêu Calo?</h1></body></html>`;
}

async function publishDraft(draftItem, data, queuePath, tmpDir, rootDir, res) {
  draftItem.status = 'published';
  draftItem.publishedSlug = `${removeVietnameseTones(draftItem.primaryKeyword)}.html`;
  draftItem.publishedAt = new Date().toISOString().split('T')[0];

  try {
    fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}

  return res.status(200).json({
    success: true,
    message: `Đã tự động xuất bản bài viết "${draftItem.topic}".`,
    publishedSlug: draftItem.publishedSlug
  });
}
