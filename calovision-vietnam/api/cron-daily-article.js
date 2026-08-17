import fs from 'fs';
import path from 'path';

const GITHUB_REPO = 'thienkimduonglaw-sudo/calorie-estimator-web';

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
  const queuePath = path.join(rootDir, 'content-queue.json');

  if (!fs.existsSync(queuePath)) {
    return res.status(500).json({ error: 'content-queue.json not found' });
  }

  const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  const queue = data.queue || [];
  const githubToken = process.env.GITHUB_TOKEN;

  // Find next pending topic
  const pendingTopic = queue.find(item => item.status === 'pending');
  if (!pendingTopic) {
    return res.status(200).json({
      success: true,
      message: 'Tất cả 60 chủ đề trong Content Queue đã được xuất bản!'
    });
  }

  const publishedArticles = queue.filter(item => item.status === 'published');
  const slug = removeVietnameseTones(pendingTopic.primaryKeyword);
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    // 1. Generate full SEO article content using Gemini API
    const articleHtml = apiKey 
      ? await generateArticleWithGemini(pendingTopic, publishedArticles, slug, apiKey)
      : generateLocalArticleContent(pendingTopic, slug);

    // 2. Commit newly generated article file directly to GitHub repo if GITHUB_TOKEN configured
    const filePath = `cam-nang/${slug}.html`;
    if (githubToken) {
      await commitFileToGitHub(filePath, articleHtml, `Tự động xuất bản bài mới: ${pendingTopic.topic}`, githubToken);
      pendingTopic.status = 'published';
      pendingTopic.publishedSlug = `${slug}.html`;
      pendingTopic.publishedAt = new Date().toISOString().split('T')[0];
      await commitFileToGitHub('content-queue.json', JSON.stringify(data, null, 2), `Update content queue status for ${pendingTopic.topic}`, githubToken);
    } else {
      pendingTopic.status = 'published';
      pendingTopic.publishedSlug = `${slug}.html`;
      pendingTopic.publishedAt = new Date().toISOString().split('T')[0];
    }

    // 3. Ping Google Sitemap
    await pingGoogleSitemap();

    return res.status(200).json({
      success: true,
      message: `Đã tự động tạo và xuất bản bài mới: "${pendingTopic.topic}"!`,
      topic: pendingTopic.topic,
      publishedUrl: `https://tinhcalo-vietnam.vercel.app/cam-nang/${slug}.html`,
      note: githubToken ? 'Bài viết đã được commit trực tiếp lên GitHub và Vercel đang tự động deploy!' : 'Thêm GITHUB_TOKEN vào Vercel Environment Variables để tự động commit bài mới vĩnh viễn lên GitHub.'
    });

  } catch (err) {
    console.error('Error in daily cron:', err);
    return res.status(500).json({ error: err.message || 'Lỗi khi xuất bản bài viết mới.' });
  }
}

async function generateArticleWithGemini(topicObj, publishedArticles, slug, apiKey) {
  const linksContext = publishedArticles.slice(0, 4).map(a => `- Tên bài: "${a.topic}", Link: "${a.publishedSlug}"`).join('\n');

  const prompt = `
Bạn là Chuyên gia Dinh dưỡng Y tế CaloVision.
Hãy viết một bài viết SEO chuẩn YMYL & E-E-A-T về món/chủ đề "${topicObj.topic}".
- Từ khóa chính: "${topicObj.primaryKeyword}"
- Các từ khóa phụ: ${JSON.stringify(topicObj.secondaryKeywords)}
- Bài viết liên quan để chèn Internal Link:
${linksContext}

QUY TẮC BẮT BUỘC:
1. Độ dài: 850-1200 từ.
2. MỖI ĐOẠN VĂN CHỈ 2-3 CÂU NGẮN (<20 từ/câu).
3. HEADING BẮT BUỘC:
   - H1: ${topicObj.topic} Bao Nhiêu Calo? [Chi Tiết Kcal] – CaloVision
   - H2: Bảng Dinh Dưỡng Chi Tiết ${topicObj.topic} (bảng 5-6 dòng thành phần g, kcal)
   - Khối CTA box dẫn link sang "../index.html?food=${encodeURIComponent(topicObj.topic)}" ngay sau bảng.
   - H2: Ăn ${topicObj.topic} Có Béo Không? Phân Tích Dinh Dưỡng (so sánh TDEE)
   - H2: Cách Ăn ${topicObj.topic} Healthy Hơn Không Lo Tăng Cân (4 mẹo)
   - H2: Câu Hỏi Thường Gặp Về ${topicObj.topic} (FAQ 5 câu)
   - H2: Bài Viết Liên Quan Trong Cụm Dinh Dưỡng
4. Trích nguồn Viện Dinh Dưỡng Quốc Gia Việt Nam và USDA.
5. Cuối bài: "Nội dung được kiểm duyệt bởi đội ngũ CaloVision, đối chiếu dữ liệu từ Viện Dinh Dưỡng VN và USDA."
6. Nhúng JSON-LD Article và FAQPage.

Hãy trả về mã HTML hoàn chỉnh 100% không bọc markdown block.
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

function generateLocalArticleContent(topicObj, slug) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${topicObj.topic} Bao Nhiêu Calo?</title></head><body><h1>${topicObj.topic} Bao Nhiêu Calo?</h1></body></html>`;
}

async function commitFileToGitHub(filePath, contentStr, commitMessage, token) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  
  let sha = null;
  const getRes = await fetch(url, {
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'CaloVision-Bot'
    }
  });

  if (getRes.ok) {
    const getJson = await getRes.json();
    sha = getJson.sha;
  }

  const body = {
    message: commitMessage,
    content: Buffer.from(contentStr, 'utf8').toString('base64'),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CaloVision-Bot'
    },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    console.error('GitHub API error:', errText);
  }
}

async function pingGoogleSitemap() {
  const pingUrl = `https://www.google.com/ping?sitemap=https://tinhcalo-vietnam.vercel.app/sitemap.xml`;
  await fetch(pingUrl).catch(() => {});
}
