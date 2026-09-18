<#
.SYNOPSIS
    生成人工复核用的 TXT 样本书。

.DESCRIPTION
    这里是给**人工逐条复核**用的整本文件，不是自动化测试的夹具。测试那两条路各有各的
    做法：EPUB 由 tests/support/epubFixture.ts 当场拼，TXT 的边界由
    tests/unit/core/domain/textBook.test.ts 直接喂字符串。它们都进不了这里的场景 ——
    「导入 20MB 的文件能不能进书架、点开会不会被 16MB 闸门拦住」「50 万字挤在一行会不会
    把排版卡死」这类问题，只有真的拿一个整本文件丢进导入流程才验得到。

    样本清单见下面的 $Samples，每个样本都写明它服务哪几条复核条目；覆盖情况与结构正确性
    由 tests/unit/repo/makeFixtures.test.ts 守卫（它会真的跑一遍本脚本，再用 core 里
    真实的 splitTextIntoBlocks 复核块数与行尾归一化）。改动样本就要同步那份测试。

    样本一律写成**不带 BOM** 的 UTF-8。带 BOM 的文件在 decodeText 里走的是另一条分支
    （按 BOM 直接判 UTF-8），会把「没有 BOM 时怎么猜编码」整条路径绕过去。

.PARAMETER OutDir
    样本输出目录，默认落在 %TEMP% 下。刻意不放在仓库里：这些文件要喂给真实应用，
    留在仓库里既占地方又容易误提交。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-fixtures.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-fixtures.ps1 -OutDir D:\fixtures
#>
[CmdletBinding()]
param(
    [string] $OutDir = (Join-Path $env:TEMP 'ebook-reader-review\books')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 不设这一句的话，中文在默认代码页的控制台上会输出成乱码，本机实测过。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# 中文句子池，循环拼接当填充正文。刻意不用随机数：样本必须字节可复现，否则复核清单里
# 记的字节数与 sha256 每跑一次就变一个，前后两轮根本没法比对。
$Prose = @(
    '山道拐过第三个弯才看见石阶，青苔把边角啃得发软。'
    '他把灯罩往下压了压，光落在纸面上，字迹比白天清楚。'
    '屋后那片竹林被风推着，一节一节地响，像有人在远处翻书。'
    '茶凉了，水面浮着一层薄薄的膜，晃一下就散开。'
    '旧木箱的搭扣锈住了，用力一掰，铁屑落在掌心里。'
    '窗外掠过一只白鹭，翅膀压得很低，几乎贴着水面。'
    '他把书翻回前一页，又觉得刚才那句其实不必重看。'
    '夜里起了雾，路灯只剩一圈毛边，走到哪儿都像隔着一层纱。'
)

function Get-Prose {
    param([int] $Length)

    $sb = New-Object System.Text.StringBuilder
    $i = 0
    while ($sb.Length -lt $Length) {
        [void] $sb.Append($Prose[$i % $Prose.Count])
        $i++
    }
    return $sb.ToString(0, $Length)
}

# 长文：6 个段落，段间空行分块。6 块正好对上 R25 的百分比序列
# 0% → 17% → 33% → 50% → 67% → 83%（块首 page=1 时比例项恒为 0），
# 而每段 8000 字又足够在 840×600 的窗口里翻上好几页，R24 才有「块中后段」可停。
$LongParagraphChars = 8000

function Get-LongBookText {
    $parts = @()
    for ($n = 1; $n -le 6; $n++) {
        $parts += (('第 {0} 段开头（第 {0} / 6 段）' -f $n) + (Get-Prose -Length $LongParagraphChars))
    }
    return ($parts -join "`n`n") + "`n"
}

# 超长单行：一行 50 万字符，超过 TEXT_BLOCK_MAX_CHARS（20 万），装块时会硬切成
# 20 万 + 20 万 + 10 万三块 —— 再加后面那个收尾段落，一共 4 块。这里用 ASCII 而不是
# 中文，是为了让「一行」本身就有 50 万字符，而不是只有十几万（一个汉字占 3 字节）。
$OverlongLineChars = 500000

function Get-OverlongBookText {
    $sb = New-Object System.Text.StringBuilder
    $chunk = 'R27-overlong-single-line-'
    while ($sb.Length -lt $OverlongLineChars) {
        [void] $sb.Append($chunk)
    }
    $line = $sb.ToString(0, $OverlongLineChars)
    return $line + "`n`n" + '翻到最后一页就该看到这一句；它没被前面那行吞掉，说明硬切之后收尾段落还在。' + "`n"
}

# 超大：目标 20 MiB，明显越过 MAX_TEXT_BYTES（16 MiB）那道闸门，但远低于书库的
# 512MB 上限 —— R21 要看的是「能导入进书架，点开才被拦」，两边都得过得去。
$HugeTargetBytes = 20 * 1MB

function Get-HugeBookText {
    param([int] $TargetBytes)

    # 逐块累加字节数，而不是每轮对整个字符串调一次 GetByteCount：后者是 O(n²)，
    # 20MB 这个量级下要多花好几秒。
    $sb = New-Object System.Text.StringBuilder
    $bytes = 0
    $n = 0
    while ($bytes -lt $TargetBytes) {
        $n++
        $chunk = (('第 {0} 段（超大样本）' -f $n) + (Get-Prose -Length 2000)) + "`n`n"
        [void] $sb.Append($chunk)
        $bytes += [System.Text.Encoding]::UTF8.GetByteCount($chunk)
    }
    return $sb.ToString()
}

function Get-ShortBookText {
    $parts = @()
    for ($n = 1; $n -le 3; $n++) {
        $parts += (('第 {0} 段（第 {0} / 3 段）' -f $n) + (Get-Prose -Length 300))
    }
    return ($parts -join "`n`n") + "`n"
}

# 纯空白：过得了「0 字节」那道闸门（那是 R22，在导入层就被拒），却在校验阶段被判空 ——
# 12 个字节全是空格、制表符与三种换行，splitTextIntoBlocks 返回 0 块。
$BlankOnly = "  `t`n`n`t  `r`n`r`n"

$LongLf = Get-LongBookText

# 三本内容相同、行尾不同。normalizeNewlines 之后必须逐字相同，而**原始字节必须互不
# 相同** —— 书库按 sha256 去重，字节一样的话后两本会被当成重复导入顶掉，R26 就无从比起了。
$LongCrlf = $LongLf -replace "`n", "`r`n"
$LongCr = $LongLf -replace "`n", "`r"

# 样本清单。Serves 是机器可读的：tests/unit/repo/makeFixtures.test.ts 拿它核对
# R21–R29 九条有没有被全覆盖，也拿它逐个复核文件和结构。
$Samples = @(
    @{ Name = 'R21-超大-20MB.txt';             Serves = @('R21');                      Build = { Get-HugeBookText -TargetBytes $HugeTargetBytes } }
    @{ Name = 'R22-空文件.txt';                Serves = @('R22');                      Build = { '' } }
    @{ Name = 'R23-纯空白.txt';                Serves = @('R23');                      Build = { $BlankOnly } }
    @{ Name = 'R24-R25-R26-R28-长文-LF.txt';   Serves = @('R24', 'R25', 'R26', 'R28'); Build = { $LongLf } }
    @{ Name = 'R24-R25-R26-R28-长文-CRLF.txt'; Serves = @('R26');                      Build = { $LongCrlf } }
    @{ Name = 'R24-R25-R26-R28-长文-CR.txt';   Serves = @('R26');                      Build = { $LongCr } }
    @{ Name = 'R27-超长单行.txt';              Serves = @('R27');                      Build = { Get-OverlongBookText } }
    @{ Name = 'R29-短文.txt';                  Serves = @('R29');                      Build = { Get-ShortBookText } }
)

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$width = 0
foreach ($sample in $Samples) {
    if ($sample.Name.Length -gt $width) { $width = $sample.Name.Length }
}

$manifest = @()
foreach ($sample in $Samples) {
    $text = & $sample.Build
    $path = Join-Path $OutDir $sample.Name
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))

    $bytes = (Get-Item -LiteralPath $path).Length
    $manifest += [ordered]@{
        name   = $sample.Name
        serves = @($sample.Serves)
        bytes  = [int] $bytes
    }

    $label = $sample.Name.PadRight($width)
    $serves = $sample.Serves -join ' '
    '  {0}  {1,10} 字节  服务 {2}' -f $label, $bytes, $serves
}

# 机器可读的清单，给上面的守卫测试用。它本身不是一本书：detectBookFormat 认不出 .json，
# 就算被一起选中也只会被判成「不支持的文件」。
$manifestPath = Join-Path $OutDir 'manifest.json'
$document = [ordered]@{
    generatedBy = 'tools/make-fixtures.ps1'
    outDir      = (Resolve-Path -LiteralPath $OutDir).Path
    samples     = $manifest
}
$json = ($document | ConvertTo-Json -Depth 4) + "`n"
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

''
'样本目录：' + (Resolve-Path -LiteralPath $OutDir).Path
'清单文件：' + $manifestPath
'共 {0} 个样本，覆盖 R21–R29。逐条判据见 README 第 11 章「人工复核样本」。' -f $Samples.Count
'结构自检（块数、行尾归一化、三本长文不被去重顶掉）跑：'
'  npx vitest run tests/unit/repo/makeFixtures.test.ts'
