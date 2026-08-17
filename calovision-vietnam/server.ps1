$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:3000/")
$listener.Start()
Write-Host "Server running at http://localhost:3000/"

$root = "C:\Users\Admin\.gemini\antigravity\scratch\calovision-vietnam"

function Remove-Diacritics ($text) {
    if ([string]::IsNullOrEmpty($text)) { return "" }
    $normalized = $text.Normalize([System.Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($char in $normalized.ToCharArray()) {
        $uc = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
        if ($uc -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($char)
        }
    }
    return $sb.ToString().Normalize([System.Text.NormalizationForm]::FormC).ToLower()
}

function Extract-FoodName ($raw) {
    if ([string]::IsNullOrEmpty($raw)) { return "Món Ăn Khai Báo" }
    $c = $raw.Replace("bao nhiêu calo","").Replace("bao nhieu calo","").Replace("tính calo","").Replace("tinh calo","").Replace("lượng calo","").Replace("cho hỏi","").Replace("giúp tôi","").Replace("sáng nay tôi ăn","").Replace("trưa nay tôi ăn","").Replace("tối nay tôi ăn","").Replace("tôi ăn","").Replace("1 bát","").Replace("1 tô","").Replace("1 dĩa","").Replace("1 đĩa","").Replace("1 ổ","").Replace("1 ly","").Replace("1 phần","").Replace("1 suất","").Trim()
    if ([string]::IsNullOrEmpty($c)) { $c = $raw.Trim() }
    return (Get-Culture).TextInfo.ToTitleCase($c)
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $localPath = $request.Url.LocalPath
        if ($localPath -eq "/") { $localPath = "/index.html" }
        
        if ($localPath -eq "/api/analyze" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $bodyText = $reader.ReadToEnd()
            
            $rawQuery = "Phở Bò Tái"
            if ($bodyText -match '"textQuery"\s*:\s*"([^"]+)"') {
                $rawQuery = $matches[1]
            } elseif ($bodyText -match '"imageContext"\s*:\s*"([^"]+)"') {
                $rawQuery = $matches[1]
            }
            
            $foodName = Extract-FoodName $rawQuery
            $norm = Remove-Diacritics $foodName
            
            $cal = 520
            $p = 26
            $c = 60
            $f = 16
            $ing1 = "Thành phần tinh bột của $foodName"
            $ing2 = "Thực phẩm đạm chính của $foodName"
            $ing3 = "Nước dùng & Gia vị chế biến"
            $ing4 = "Rau củ & Đồ ăn kèm"
            
            if ($norm.Contains("bun") -or $norm.Contains("pho") -or $norm.Contains("hu tieu") -or $norm.Contains("mi") -or $norm.Contains("mien") -or $norm.Contains("banh canh") -or $norm.Contains("lau") -or $norm.Contains("sup")) {
                $cal = 550
                $p = 28
                $c = 65
                $f = 18
                $ing1 = "Bún / Phở tươi trong $foodName"
                $ing2 = "Thịt / Chả / Tôm đạm chính"
                $ing3 = "Nước dùng & gia vị hầm"
                $ing4 = "Rau sống & giá đỗ đi kèm"
            } elseif ($norm.Contains("com") -or $norm.Contains("xoi") -or $norm.Contains("tam")) {
                $cal = 650
                $p = 30
                $c = 75
                $f = 22
                $ing1 = "Cơm chín / Cơm tấm"
                $ing2 = "Món mặn đạm chính của $foodName"
                $ing3 = "Mỡ hành & Dầu mỡ chế biến"
                $ing4 = "Dưa leo, cà chua & đồ chua"
            } elseif ($norm.Contains("banh mi") -or $norm.Contains("banh bao") -or $norm.Contains("burger") -or $norm.Contains("sandwich")) {
                $cal = 440
                $p = 20
                $c = 54
                $f = 16
                $ing1 = "Vỏ bánh mì giòn"
                $ing2 = "Nhân thịt, chả, trứng"
                $ing3 = "Pate & bơ béo"
                $ing4 = "Dưa leo, ngò rí & đồ chua"
            } elseif ($norm.Contains("goi") -or $norm.Contains("cuon") -or $norm.Contains("salad") -or $norm.Contains("nem")) {
                $cal = 320
                $p = 22
                $c = 40
                $f = 8
                $ing1 = "Bánh tráng / Bún tươi"
                $ing2 = "Thành phần đạm tôm, thịt sạch"
                $ing3 = "Rau sống & rau thơm"
                $ing4 = "Nước chấm chua ngọt"
            } elseif ($norm.Contains("che") -or $norm.Contains("tra sua") -or $norm.Contains("sinh to") -or $norm.Contains("ca phe")) {
                $cal = 450
                $p = 5
                $c = 78
                $f = 15
                $ing1 = "Cốt trà / Nước cốt dừa / Kem béo"
                $ing2 = "Trân châu / Thạch / Topping"
                $ing3 = "Siro đường & hương liệu"
                $ing4 = "Topping thêm"
            }
            
            $jsonObj = @{
                foodName = $foodName
                confidence = "Đầy đủ"
                healthScore = 8
                calories = $cal
                protein = $p
                carbs = $c
                fat = $f
                ingredients = @(
                    @{ name = $ing1; mass = "180g"; calories = [math]::Round($cal * 0.45) },
                    @{ name = $ing2; mass = "100g"; calories = [math]::Round($cal * 0.35) },
                    @{ name = $ing3; mass = "80g"; calories = [math]::Round($cal * 0.15) },
                    @{ name = $ing4; mass = "40g"; calories = [math]::Round($cal * 0.05) }
                )
                medicalAssessment = "$foodName cung cấp đầy đủ dinh dưỡng tiêu chuẩn và năng lượng hợp lý cho cơ thể."
                healthSuggestions = @(
                    "Nên ăn kèm nhiều rau tươi và chất xơ.",
                    "Uống đủ nước sau bữa ăn."
                )
            }
            
            $jsonResp = $jsonObj | ConvertTo-Json -Depth 5
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }
        
        $filePath = Join-Path $root $localPath.Replace('/', '\').TrimStart('\')
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".xml"  { $response.ContentType = "text/xml; charset=utf-8" }
                default { $response.ContentType = "application/octet-stream" }
            }
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
    } catch {
        # Continue
    }
}