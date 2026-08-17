import fs from 'fs';
import path from 'path';

// Helper: Remove Vietnamese tones for clean URL slug
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
  // Verify Cron Secret for security if provided
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized cron trigger.' });
  }

  const rootDir = process.cwd();
  const queuePath = path.join(rootDir, 'content-queue.json');

  if (!fs.existsSync(queuePath)) {
    return res.status(500).json({ error: 'content-queue.json not found' });
  }

  const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const queue = data.queue || [];
  const config = data.config || {};

  // Check if any draft needs auto-publishing after autoPublishHours
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

  // If a draft is ready for auto-publish, publish it!
  if (draftToPublish) {
    return await publishDraft(draftToPublish, data, queuePath, rootDir, res);
  }

  // Otherwise, find the next pending topic to generate
  const pendingTopic = queue.find(item => item.status === 'pending');
  if (!pendingTopic) {
    return res.status(200).json({ message: 'Tất cả 60 chủ đề trong Content Queue đã được xuất bản!' });
  }

  // Get already published articles for internal linking
  const publishedArticles = queue.filter(item => item.status === 'published');
  const slug = removeVietnameseTones(pendingTopic.primaryKeyword);

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback: Generate local template draft if GEMINI_API_KEY is not configured yet
      return await generateLocalDraft(pendingTopic, publishedArticles, slug, data, queuePath, rootDir, res);
    }

    // Call Gemini API to generate deep 900+ word SEO article
    const articleHtml = await generateArticleWithGemini(pendingTopic, publishedArticles, slug, apiKey);

    // Save as Draft
    const draftsDir = path.join(rootDir, 'cam-nang', 'drafts');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    const draftFilePath = path.join(draftsDir, `${slug}.html`);
    fs.writeFileSync(draftFilePath, articleHtml, 'utf8');

    // Update queue status
    pendingTopic.status = 'draft';
    pendingTopic.draftCreatedAt = new Date().toISOString();
    pendingTopic.draftSlug = `${slug}.html`;

    fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');

    // Send Webhook Notification (Telegram / Slack) if configured
    await sendNotificationWebhook(config, pendingTopic, slug);

    return res.status(200).json({
      success: true,
      message: `Đã sinh thành công bài viết nháp (Draft) cho chủ đề "${pendingTopic.topic}".`,
      previewUrl: `/cam-nang/drafts/${slug}.html`,
      autoPublishInHours: config.autoPublishHours || 12
    });

  } catch (err) {
    console.error('Error generating daily article:', err);
    return res.status(500).json({ error: err.message || 'Lỗi khi sinh bài viết tự động.' });
  }
}

// Generate Article via Google Gemini API
async function generateArticleWithGemini(topicObj, publishedArticles, slug, apiKey) {
  const linksContext = publishedArticles.slice(0, 4).map(a => `- Tên bài: "${a.topic}", Link: "${a.publishedSlug}"`).join('\n');

  const prompt = `
Bạn là Chuyên gia Dinh dưỡng Y tế hàng đầu của CaloVision Vietnam.
Hãy viết một bài viết SEO chuẩn YMYL & E-E-A-T với thông tin sau:
- Chủ đề: "${topicObj.topic}"
- Từ khóa chính: "${topicObj.primaryKeyword}"
- Các từ khóa phụ: ${JSON.stringify(topicObj.secondaryKeywords)}
- Danh sách các bài đã xuất bản để tự động chèn Internal Link tự nhiên:
${linksContext}

QUY TẮC BẮT BUỘC VỀ VĂN PHONG VÀ ĐỘ DÀI:
1. Độ dài bài viết: 850 - 1200 từ.
2. TẤT CẢ ĐOẠN VĂN: Chỉ dài từ 2 đến 3 câu ngắn (tối đa 25 từ/câu). Tuyệt đối không viết đoạn văn dài ù lì.
3. CẤU TRÚC HEADING BẮT BUỘC:
   - H1: ${topicObj.topic} Bao Nhiêu Calo? [Chi Tiết Kcal] – Phân Tích Dinh Dưỡng
   - H2: Bảng Dinh Dưỡng Chi Tiết ${topicObj.topic} (bảng 5-6 dòng thành phần, khối lượng g, calo riêng)
   - Đặt ngay sau bảng một khối CTA box dẫn link sang công cụ "../index.html?food=${encodeURIComponent(topicObj.topic)}"
   - H2: Ăn ${topicObj.topic} Có Béo Không? Phân Tích Dinh Dưỡng (>150 từ, so sánh TDEE 500-600 kcal)
   - H2: Cách Ăn ${topicObj.topic} Healthy Hơn Không Lo Tăng Cân (4 mẹo thực tế cụ thể)
   - H2: Câu Hỏi Thường Gặp Về ${topicObj.topic} (FAQ - 5 câu hỏi, mỗi trả lời >40 từ)
   - H2: Bài Viết Liên Quan Trong Cụm Dinh Dưỡng
4. TỰ ĐỘNG CHÈN 2-3 INTERNAL LINK TỰ NHIÊN TRONG ĐOẠN VĂN SỬ DỤNG DANH SÁCH BÀI ĐÃ XUẤT BẢN.
5. TRÍCH NGUỒN: "Viện Dinh Dưỡng Quốc Gia Việt Nam" và "USDA".
6. CUỐI BÀI: Dòng kiểm duyệt y khoa "Nội dung được kiểm duyệt bởi đội ngũ CaloVision, đối chiếu dữ liệu từ Viện Dinh Dưỡng VN và USDA."
7. SCHEMA MARKUP: Nhúng đủ JSON-LD Article và FAQPage (5 câu hỏi).

Hãy trả về mã HTML hoàn chỉnh chuẩn 100% không bọc markdown wrapper.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const resData = await response.json();
  let text = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  text = text.replace(/^```html\s*/i, '').replace(/```$/i, '').trim();

  return text;
}

// Fallback Local Generator if GEMINI_API_KEY is pending
async function generateLocalDraft(topicObj, publishedArticles, slug, data, queuePath, rootDir, res) {
  const draftTitle = `${topicObj.topic} Bao Nhiêu Calo? [Chi Tiết Kcal] – CaloVision`;
  const articleHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>${draftTitle}</title>
  <meta name="description" content="${topicObj.primaryKeyword} bao nhiêu calo? Bảng dinh dưỡng chi tiết theo Viện Dinh Dưỡng Quốc Gia.">
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <div class="main-layout-container">
    <h1>${draftTitle}</h1>
    <p>Bài viết nháp tự động cho chủ đề "${topicObj.topic}".</p>
  </div>
</body>
</html>`;

  const draftsDir = path.join(rootDir, 'cam-nang', 'drafts');
  if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });
  fs.writeFileSync(path.join(draftsDir, `${slug}.html`), articleHtml, 'utf8');

  topicObj.status = 'draft';
  topicObj.draftCreatedAt = new Date().toISOString();
  topicObj.draftSlug = `${slug}.html`;

  fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');

  return res.status(200).json({
    success: true,
    message: `Đã tạo bài viết nháp (Draft) cho "${topicObj.topic}".`,
    previewUrl: `/cam-nang/drafts/${slug}.html`,
    note: 'Thêm GEMINI_API_KEY vào biến môi trường Vercel để kích hoạt AI viết tự động 100%.'
  });
}

// Publish Draft Function
async function publishDraft(draftItem, data, queuePath, rootDir, res) {
  const slug = removeVietnameseTones(draftItem.primaryKeyword);
  const draftFile = path.join(rootDir, 'cam-nang', 'drafts', `${slug}.html`);
  const publishedFile = path.join(rootDir, 'cam-nang', `${slug}.html`);

  if (fs.existsSync(draftFile)) {
    const htmlContent = fs.readFileSync(draftFile, 'utf8');
    fs.writeFileSync(publishedFile, htmlContent, 'utf8');
  }

  draftItem.status = 'published';
  draftItem.publishedSlug = `${slug}.html`;
  draftItem.publishedAt = new Date().toISOString().split('T')[0];

  fs.writeFileSync(queuePath, JSON.stringify(data, null, 2), 'utf8');

  // Auto-Update Sitemap & Google Indexing Ping
  await updateSitemapAndPingGoogle(publishedFile, slug, rootDir);

  return res.status(200).json({
    success: true,
    message: `Đã tự động chuyển bài "${draftItem.topic}" từ Draft sang Published sau 12h!`,
    publishedUrl: `/cam-nang/${slug}.html`
  });
}

// Send Webhook Notification (Telegram/Slack)
async function sendNotificationWebhook(config, topicObj, slug) {
  if (config.telegramWebhookUrl) {
    const text = `📢 *CaloVision Draft Mới*: ${topicObj.topic}\n🔗 Preview: https://tinhcalo-vietnam.vercel.app/cam-nang/drafts/${slug}.html\n⏱ Sẽ tự động publish sau ${config.autoPublishHours || 12}h.`;
    await fetch(config.telegramWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, parse_mode: 'Markdown' })
    }).catch(() => {});
  }
}

// Update Sitemap & Ping Google
async function updateSitemapAndPingGoogle(publishedFile, slug, rootDir) {
  const sitemapPath = path.join(rootDir, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    let sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const newUrlEntry = `  <url>\n    <loc>https://tinhcalo-vietnam.vercel.app/cam-nang/${slug}.html</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`;
    
    if (!sitemap.includes(`${slug}.html`)) {
      sitemap = sitemap.replace('</urlset>', newUrlEntry);
      fs.writeFileSync(sitemapPath, sitemap, 'utf8');
    }
  }

  // Ping Google Sitemap
  const pingUrl = `https://www.google.com/ping?sitemap=https://tinhcalo-vietnam.vercel.app/sitemap.xml`;
  await fetch(pingUrl).catch(() => {});
}
