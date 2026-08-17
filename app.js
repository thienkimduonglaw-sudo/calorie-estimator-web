// CaloVision Vietnam - Client Application Engine

let currentTab = 'image';
let selectedImageBase64 = null;
let currentDailyTarget = 2000;
let currentAnalysisResult = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initDatePicker();
  loadTargetCalories();
  loadHistoryForSelectedDate();
  setupDragAndDrop();
  checkUrlQueryParams();
  setupModalListeners();
  setupEnterKeyTrigger();
});

// UX Enhancement: Trigger analysis on Enter key
function setupEnterKeyTrigger() {
  const textQuery = document.getElementById('text-query');
  if (textQuery) {
    textQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        estimateCalories();
      }
    });
  }

  const imageContext = document.getElementById('image-context');
  if (imageContext) {
    imageContext.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        estimateCalories();
      }
    });
  }
}

// Check URL query parameters for CTA deep-links (e.g. index.html?food=Phở%20bò)
function checkUrlQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const foodParam = params.get('food');
  if (foodParam) {
    switchTab('text');
    document.getElementById('text-query').value = foodParam;
    setTimeout(() => {
      estimateCalories();
    }, 400);
  }
}

// Tab Switching
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-image-btn').classList.toggle('active', tab === 'image');
  document.getElementById('tab-text-btn').classList.toggle('active', tab === 'text');
  document.getElementById('image-tab').style.display = tab === 'image' ? 'block' : 'none';
  document.getElementById('text-tab').style.display = tab === 'text' ? 'block' : 'none';
}

// File Inputs
function triggerFileInput(id) {
  document.getElementById(id).click();
}

document.getElementById('file-input')?.addEventListener('change', handleFileSelect);
document.getElementById('camera-input')?.addEventListener('change', handleFileSelect);

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showError('Vui lòng chỉ chọn tập tin hình ảnh (JPG, PNG, WEBP).');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    selectedImageBase64 = event.target.result;
    document.getElementById('image-preview').src = selectedImageBase64;
    document.getElementById('upload-prompt').style.display = 'none';
    document.getElementById('preview-container').style.display = 'block';
    hideError();
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  selectedImageBase64 = null;
  document.getElementById('image-preview').src = '';
  document.getElementById('preview-container').style.display = 'none';
  document.getElementById('upload-prompt').style.display = 'block';
  document.getElementById('file-input').value = '';
  document.getElementById('camera-input').value = '';
}

function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      document.getElementById('file-input').files = files;
      handleFileSelect({ target: { files } });
    }
  });
}

function quickSelect(foodText) {
  switchTab('text');
  document.getElementById('text-query').value = foodText;
  estimateCalories();
}

// Main Calorie Estimation Function
async function estimateCalories() {
  hideError();
  const textQuery = document.getElementById('text-query').value.trim();
  const imageContext = document.getElementById('image-context').value.trim();

  if (currentTab === 'image' && !selectedImageBase64) {
    showError('Vui lòng chọn hoặc chụp ảnh món ăn trước khi bấm phân tích.');
    return;
  }

  if (currentTab === 'text' && !textQuery) {
    showError('Vui lòng nhập tên hoặc mô tả món ăn bữa ăn của bạn.');
    return;
  }

  // Show Loading & Hide Old Result
  document.getElementById('result-loading').style.display = 'block';
  document.getElementById('result-card').style.display = 'none';
  document.getElementById('submit-btn').disabled = true;

  const customKey = localStorage.getItem('calovision_api_key') || '';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(customKey ? { 'x-api-key': customKey } : {})
      },
      body: JSON.stringify({
        imageBase64: currentTab === 'image' ? selectedImageBase64 : null,
        textQuery: currentTab === 'text' ? textQuery : null,
        imageContext: imageContext
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw new Error(errData.message || 'Bạn đã dùng hết 10 lượt phân tích miễn phí hôm nay.');
      }
      throw new Error(errData.error || 'Hệ thống gặp sự cố khi kết nối server phân tích.');
    }

    const data = await response.json();
    currentAnalysisResult = data;
    renderAnalysisResult(data);

  } catch (err) {
    console.error('Error analyzing calories:', err);
    showError(err.message || 'Không thể phân tích dữ liệu thực phẩm. Vui lòng thử lại.');
  } finally {
    document.getElementById('result-loading').style.display = 'none';
    document.getElementById('submit-btn').disabled = false;
  }
}

// Render Results & Ingredients Table
function renderAnalysisResult(data) {
  document.getElementById('result-food-name').innerText = data.foodName || 'Món Ăn Khai Báo';
  document.getElementById('result-confidence').innerText = `Phân tích: ${data.confidence || 'Đầy đủ'}`;
  document.getElementById('result-health-score').innerText = `${data.healthScore || 8}/10`;
  document.getElementById('result-calories').innerText = data.calories || 0;
  
  document.getElementById('result-protein').innerText = data.protein || 0;
  document.getElementById('result-carbs').innerText = data.carbs || 0;
  document.getElementById('result-fat').innerText = data.fat || 0;

  // Render SVG Donut Chart
  const totalMacro = (data.protein || 1) + (data.carbs || 1) + (data.fat || 1);
  const pPct = Math.round((data.protein / totalMacro) * 100);
  const cPct = Math.round((data.carbs / totalMacro) * 100);
  const fPct = 100 - pPct - cPct;

  const svgP = document.getElementById('svg-protein');
  const svgC = document.getElementById('svg-carbs');
  const svgF = document.getElementById('svg-fat');

  if (svgP && svgC && svgF) {
    svgP.setAttribute('stroke-dasharray', `${pPct}, 100`);
    svgC.setAttribute('stroke-dasharray', `${cPct}, 100`);
    svgC.setAttribute('stroke-dashoffset', `-${pPct}`);
    svgF.setAttribute('stroke-dasharray', `${fPct}, 100`);
    svgF.setAttribute('stroke-dashoffset', `-${pPct + cPct}`);
  }

  // Render Ingredients Table ALWAYS
  const tbody = document.getElementById('ingredients-table-body');
  tbody.innerHTML = '';

  let ingredients = data.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    ingredients = [
      { name: "Thành phần Tinh bột", mass: "180g", calories: Math.round(data.calories * 0.45) },
      { name: "Nguồn đạm chính", mass: "100g", calories: Math.round(data.calories * 0.35) },
      { name: "Nước dùng & gia vị chế biến", mass: "80g", calories: Math.round(data.calories * 0.15) },
      { name: "Rau củ & đồ ăn kèm", mass: "40g", calories: Math.round(data.calories * 0.05) }
    ];
  }

  ingredients.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(item.name || 'Thành phần')}</strong></td>
      <td>${escapeHtml(item.mass || '100g')}</td>
      <td><span style="color: var(--primary); font-weight: 700;">${item.calories || 0} kcal</span></td>
    `;
    tbody.appendChild(tr);
  });

  // Render Dynamic Medical Assessment & Suggestions
  document.getElementById('result-assessment').innerText = data.medicalAssessment || 
    `${data.foodName || 'Bữa ăn'} cung cấp nguồn năng lượng tiêu chuẩn từ tinh bột và chất đạm.`;

  const suggestionsUl = document.getElementById('result-suggestions');
  suggestionsUl.innerHTML = '';
  const suggestions = Array.isArray(data.healthSuggestions) && data.healthSuggestions.length > 0
    ? data.healthSuggestions
    : [
        'Nên ăn kèm nhiều rau xanh để bổ sung thêm chất xơ.',
        'Uống đủ nước sau khi hoàn thành bữa ăn.'
      ];

  suggestions.forEach(text => {
    const li = document.createElement('li');
    li.innerText = text;
    suggestionsUl.appendChild(li);
  });

  document.getElementById('result-card').style.display = 'block';
  document.getElementById('result-card').scrollIntoView({ behavior: 'smooth' });
}

// Error handling helpers
function showError(msg) {
  const errBanner = document.getElementById('error-banner');
  const errText = document.getElementById('error-message');
  if (errBanner && errText) {
    errText.innerText = msg;
    errBanner.style.display = 'block';
  }
}

function hideError() {
  const errBanner = document.getElementById('error-banner');
  if (errBanner) errBanner.style.display = 'none';
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// TDEE / BMR Calculation
function calculateTDEE() {
  const gender = document.querySelector('input[name="tdee-gender"]:checked').value;
  const age = parseFloat(document.getElementById('tdee-age').value) || 25;
  const weight = parseFloat(document.getElementById('tdee-weight').value) || 65;
  const height = parseFloat(document.getElementById('tdee-height').value) || 170;
  const activity = parseFloat(document.getElementById('tdee-activity').value) || 1.375;
  const goal = document.getElementById('tdee-goal').value;

  let bmr = (10 * weight) + (6.25 * height) - (5 * age);
  bmr = gender === 'male' ? bmr + 5 : bmr - 161;

  const tdee = bmr * activity;

  let target = tdee;
  if (goal === 'lose') target = tdee - 500;
  else if (goal === 'gain') target = tdee + 300;

  document.getElementById('bmr-val').innerText = Math.round(bmr);
  document.getElementById('tdee-val').innerText = Math.round(tdee);
  document.getElementById('target-val').innerText = Math.round(target);

  document.getElementById('tdee-result').style.display = 'block';
}

function applyCalculatedTarget() {
  const target = parseInt(document.getElementById('target-val').innerText) || 2000;
  currentDailyTarget = target;
  localStorage.setItem('calovision_target_calories', target);
  loadTargetCalories();
  alert(`Đã cài đặt ${target} kcal làm mục tiêu calo mỗi ngày của bạn!`);
}

function loadTargetCalories() {
  const saved = localStorage.getItem('calovision_target_calories');
  if (saved) currentDailyTarget = parseInt(saved);
  
  document.getElementById('target-calories-header').innerText = currentDailyTarget;
  document.getElementById('history-target-calories').innerText = currentDailyTarget;
}

// Date Picker Init
function initDatePicker() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('save-meal-date').value = today;
  document.getElementById('diary-date-select').value = today;
}

// Diary History Management
function saveToHistory() {
  if (!currentAnalysisResult) {
    alert('Vui lòng thực hiện phân tích món ăn trước khi lưu.');
    return;
  }

  const date = document.getElementById('save-meal-date').value;
  const mealType = document.getElementById('save-meal-type').value;

  const historyKey = `calovision_diary_${date}`;
  const existing = JSON.parse(localStorage.getItem(historyKey) || '{"sang":[], "trua":[], "toi":[], "phu":[]}');

  existing[mealType] = existing[mealType] || [];
  existing[mealType].push({
    id: Date.now(),
    name: currentAnalysisResult.foodName,
    calories: currentAnalysisResult.calories,
    protein: currentAnalysisResult.protein,
    carbs: currentAnalysisResult.carbs,
    fat: currentAnalysisResult.fat
  });

  localStorage.setItem(historyKey, JSON.stringify(existing));

  document.getElementById('diary-date-select').value = date;
  loadHistoryForSelectedDate();

  alert(`Đã lưu "${currentAnalysisResult.foodName}" vào nhật ký ngày ${date}!`);
}

function loadHistoryForSelectedDate() {
  const date = document.getElementById('diary-date-select').value;
  const historyKey = `calovision_diary_${date}`;
  const data = JSON.parse(localStorage.getItem(historyKey) || '{"sang":[], "trua":[], "toi":[], "phu":[]}');

  let totalCal = 0;

  ['sang', 'trua', 'toi', 'phu'].forEach(meal => {
    const listEl = document.getElementById(`list-${meal}`);
    const sumEl = document.getElementById(`sum-cal-${meal}`);
    listEl.innerHTML = '';

    let mealSum = 0;
    const items = data[meal] || [];

    items.forEach(item => {
      mealSum += item.calories;
      const row = document.createElement('div');
      row.className = 'meal-item-row';
      row.innerHTML = `
        <span>${escapeHtml(item.name)} (${item.calories} kcal)</span>
        <span class="delete-meal-item" onclick="deleteMealItem('${date}', '${meal}', ${item.id})">&times;</span>
      `;
      listEl.appendChild(row);
    });

    sumEl.innerText = mealSum;
    totalCal += mealSum;
  });

  document.getElementById('total-calories-header').innerText = totalCal;
  document.getElementById('history-total-calories').innerText = totalCal;

  const pct = Math.min(Math.round((totalCal / currentDailyTarget) * 100), 100);
  document.getElementById('history-percentage').innerText = `${pct}%`;
  document.getElementById('history-progress-fill').style.width = `${pct}%`;
}

function deleteMealItem(date, meal, itemId) {
  const historyKey = `calovision_diary_${date}`;
  const data = JSON.parse(localStorage.getItem(historyKey) || '{"sang":[], "trua":[], "toi":[], "phu":[]}');
  if (data[meal]) {
    data[meal] = data[meal].filter(i => i.id !== itemId);
    localStorage.setItem(historyKey, JSON.stringify(data));
    loadHistoryForSelectedDate();
  }
}

function clearHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa tất cả nhật ký dinh dưỡng ngày hôm nay?')) {
    const date = document.getElementById('diary-date-select').value;
    localStorage.removeItem(`calovision_diary_${date}`);
    loadHistoryForSelectedDate();
  }
}

// Modal Listeners
function setupModalListeners() {
  document.getElementById('open-settings')?.addEventListener('click', () => {
    document.getElementById('local-api-key').value = localStorage.getItem('calovision_api_key') || '';
    document.getElementById('settings-modal').style.display = 'flex';
  });
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

function saveApiKey() {
  const key = document.getElementById('local-api-key').value.trim();
  if (key) {
    localStorage.setItem('calovision_api_key', key);
    alert('Đã lưu Gemini API Key cá nhân thành công!');
  } else {
    localStorage.removeItem('calovision_api_key');
    alert('Đã xóa Gemini API Key cá nhân. Hệ thống sẽ dùng server miễn phí mặc định.');
  }
  closeSettings();
}

function clearApiKey() {
  localStorage.removeItem('calovision_api_key');
  document.getElementById('local-api-key').value = '';
  alert('Đã xóa cấu hình API Key!');
  closeSettings();
}

function toggleFaq(btn) {
  const answer = btn.nextElementSibling;
  const isVisible = answer.style.display === 'block';
  answer.style.display = isVisible ? 'none' : 'block';
  btn.querySelector('i').className = isVisible ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
}
