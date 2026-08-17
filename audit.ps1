$dir = "C:\Users\Admin\.gemini\antigravity\scratch\calovision-vietnam\cam-nang"
$files = Get-ChildItem "$dir\*.html"
foreach ($f in $files) {
    if ($f.Name -ne "index.html") {
        $raw = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
        $cleanText = $raw -replace '<[^>]+>', ' ' -replace '\s+', ' '
        $wordArray = $cleanText.Trim().Split(' ')
        $wCount = $wordArray.Length
        
        $internalLinks = ([regex]::Matches($raw, 'href="[a-z0-9\-]+\.html"')).Count
        $ctaLinks = ([regex]::Matches($raw, 'href="\.\./index\.html\?food=')).Count
        
        Write-Host "$($f.Name): $wCount words | Internal Article Links: $internalLinks | CTA Tools Links: $ctaLinks"
    }
}
