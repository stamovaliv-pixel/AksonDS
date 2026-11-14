# AKSON DockSlot / Doxi 3.4 Ollama proxy - concurrent edition
# Windows PowerShell 5.1 compatible.
# Listens ONLY on 127.0.0.1:8787 and keeps the existing shared-secret check.
# Handles up to 8 HTTP requests concurrently; Ollama itself is configured for 2
# active generations and queues the remaining requests. The proxy exposes only a strict
# model allow-list and JSON output mode; arbitrary Ollama options are never forwarded.

$ErrorActionPreference = 'Stop'

$SecretPath = 'C:\cloudflared\secret.txt'
$ListenPrefix = 'http://127.0.0.1:8787/'
$OllamaEndpoint = 'http://127.0.0.1:11434/api/generate'
$OllamaTagsEndpoint = 'http://127.0.0.1:11434/api/tags'
$DefaultModel = 'qwen3.5:9b'
$AllowedModels = @('qwen3.5:9b')
$MaxBodyBytes = 65536
$MaxPromptChars = 24000
$MaxSystemChars = 10000
$MaxOutputTokens = 1200
$ContextTokens = 8192
$MaxProxyWorkers = 8
$MaxAcceptedInFlight = 24
$OllamaTimeoutMs = 600000

function Send-ProxyJson {
    param(
        [Parameter(Mandatory = $true)] $Response,
        [Parameter(Mandatory = $true)] [int] $StatusCode,
        [Parameter(Mandatory = $true)] $Data
    )
    $json = ConvertTo-Json -InputObject $Data -Depth 8 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $bytes.Length
    $Response.Headers['Cache-Control'] = 'no-store'
    $Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
    throw 'Secret file is missing. Expected C:\cloudflared\secret.txt.'
}
$Secret = (Get-Content -LiteralPath $SecretPath -Raw).Trim()
if ($Secret.Length -lt 32) {
    throw 'Secret is too short. Use a randomly generated secret of at least 32 characters.'
}

# .NET Framework defaults to a low per-host connection limit. Raise it so the
# proxy can keep several independent localhost requests open simultaneously.
[System.Net.ServicePointManager]::DefaultConnectionLimit = 32
[System.Net.ServicePointManager]::Expect100Continue = $false

$Config = @{
    Secret = $Secret
    OllamaEndpoint = $OllamaEndpoint
    OllamaTagsEndpoint = $OllamaTagsEndpoint
    DefaultModel = $DefaultModel
    AllowedModels = $AllowedModels
    MaxBodyBytes = $MaxBodyBytes
    MaxPromptChars = $MaxPromptChars
    MaxSystemChars = $MaxSystemChars
    MaxOutputTokens = $MaxOutputTokens
    ContextTokens = $ContextTokens
    OllamaTimeoutMs = $OllamaTimeoutMs
}

# Each request is handled in its own runspace from a bounded pool. This avoids
# sharing one PowerShell runspace between threads and preserves PS 5.1 support.
$WorkerScript = @'
param($Context, $Config)
$ErrorActionPreference = 'Stop'

function Send-ProxyJson {
    param($Response, [int] $StatusCode, $Data)
    $json = ConvertTo-Json -InputObject $Data -Depth 8 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $bytes.Length
    $Response.Headers['Cache-Control'] = 'no-store'
    $Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Test-ProxySecret {
    param([string] $Candidate, [string] $Expected)
    if ([string]::IsNullOrEmpty($Candidate) -or [string]::IsNullOrEmpty($Expected)) { return $false }
    $candidateBytes = [System.Text.Encoding]::UTF8.GetBytes($Candidate)
    $expectedBytes = [System.Text.Encoding]::UTF8.GetBytes($Expected)
    if ($candidateBytes.Length -ne $expectedBytes.Length) { return $false }
    $difference = 0
    for ($i = 0; $i -lt $candidateBytes.Length; $i++) {
        $difference = $difference -bor ($candidateBytes[$i] -bxor $expectedBytes[$i])
    }
    return ($difference -eq 0)
}

$response = $Context.Response
$response.KeepAlive = $false
$responseHandled = $false
try {
    $request = $Context.Request
    if (-not [System.Net.IPAddress]::IsLoopback($request.RemoteEndPoint.Address)) {
        Send-ProxyJson $response 403 @{ error = 'Forbidden' }; $responseHandled = $true; return
    }

    $requestPath = $request.Url.AbsolutePath
    $isHealth = ($request.HttpMethod -eq 'GET' -and $requestPath -eq '/health')
    $isGenerate = ($request.HttpMethod -eq 'POST' -and $requestPath -eq '/generate')
    if (-not ($isHealth -or $isGenerate)) {
        Send-ProxyJson $response 404 @{ error = 'Not found' }; $responseHandled = $true; return
    }
    if (-not (Test-ProxySecret -Candidate $request.Headers['X-Akson-Secret'] -Expected $Config.Secret)) {
        Send-ProxyJson $response 401 @{ error = 'Unauthorized' }; $responseHandled = $true; return
    }

    if ($isHealth) {
        try {
            $healthRequest = [System.Net.HttpWebRequest]::Create($Config.OllamaTagsEndpoint)
            $healthRequest.Method = 'GET'
            $healthRequest.Timeout = 5000
            $healthRequest.ReadWriteTimeout = 5000
            $healthRequest.KeepAlive = $false
            $healthResponse = $healthRequest.GetResponse()
            try {
                $healthReader = New-Object System.IO.StreamReader($healthResponse.GetResponseStream())
                try { $healthText = $healthReader.ReadToEnd() } finally { $healthReader.Dispose() }
            } finally { $healthResponse.Close() }
            $healthData = $healthText | ConvertFrom-Json -ErrorAction Stop
            $availableNames = @($healthData.models | ForEach-Object { if ($_.name) { [string]$_.name } elseif ($_.model) { [string]$_.model } })
            $baseModelAvailable = $availableNames -contains $Config.DefaultModel
            if (-not $baseModelAvailable) {
                Send-ProxyJson $response 503 @{ ok = $false; error = 'Default model unavailable' }
            } else {
                Send-ProxyJson $response 200 @{ ok = $true; base_model = $true; deep_model_routing = $false; deep_reasoning = $true }
            }
        } catch {
            Send-ProxyJson $response 503 @{ ok = $false; error = 'AI service unavailable' }
        }
        $responseHandled = $true
        return
    }

    if ($request.ContentType -notmatch '^\s*application/json(?:\s*;|$)') {
        Send-ProxyJson $response 415 @{ error = 'JSON required' }; $responseHandled = $true; return
    }
    if ($request.ContentLength64 -gt $Config.MaxBodyBytes) {
        Send-ProxyJson $response 413 @{ error = 'Request too large' }; $responseHandled = $true; return
    }

    $memory = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 4096
    $totalBytes = 0
    $tooLarge = $false
    try {
        while (($readCount = $request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if (($totalBytes + $readCount) -gt $Config.MaxBodyBytes) { $tooLarge = $true; break }
            $memory.Write($buffer, 0, $readCount)
            $totalBytes += $readCount
        }
        $bodyText = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
    } finally { $memory.Dispose() }
    if ($tooLarge) {
        Send-ProxyJson $response 413 @{ error = 'Request too large' }; $responseHandled = $true; return
    }

    try { $payload = $bodyText | ConvertFrom-Json -ErrorAction Stop }
    catch { Send-ProxyJson $response 400 @{ error = 'Invalid JSON' }; $responseHandled = $true; return }

    if ($null -eq $payload -or -not ($payload.prompt -is [string])) {
        Send-ProxyJson $response 400 @{ error = 'Prompt must be a string' }; $responseHandled = $true; return
    }
    $requestedModel = $Config.DefaultModel
    if ($null -ne $payload.model -and -not [string]::IsNullOrWhiteSpace([string]$payload.model)) {
        $requestedModel = [string]$payload.model
    }
    if ($Config.AllowedModels -notcontains $requestedModel) {
        Send-ProxyJson $response 400 @{ error = 'Model is not allowed' }; $responseHandled = $true; return
    }
    $format = $null
    if ($payload.PSObject.Properties.Name -contains 'format') {
        if ([string]$payload.format -ne 'json') {
            Send-ProxyJson $response 400 @{ error = 'Only JSON format is allowed' }; $responseHandled = $true; return
        }
        $format = 'json'
    }
    $requestedOutputTokens = $Config.MaxOutputTokens
    if ($payload.PSObject.Properties.Name -contains 'num_predict') {
        $parsedOutputTokens = 0
        if (-not [int]::TryParse([string]$payload.num_predict, [ref]$parsedOutputTokens) -or $parsedOutputTokens -lt 64 -or $parsedOutputTokens -gt $Config.MaxOutputTokens) {
            Send-ProxyJson $response 400 @{ error = 'num_predict is outside the allowed range' }; $responseHandled = $true; return
        }
        $requestedOutputTokens = $parsedOutputTokens
    }
    $prompt = [string]$payload.prompt
    if ([string]::IsNullOrWhiteSpace($prompt) -or $prompt.Length -gt $Config.MaxPromptChars) {
        Send-ProxyJson $response 400 @{ error = 'Prompt is empty or too long' }; $responseHandled = $true; return
    }
    $systemText = ''
    if ($null -ne $payload.system) {
        if (-not ($payload.system -is [string])) {
            Send-ProxyJson $response 400 @{ error = 'System prompt must be a string' }; $responseHandled = $true; return
        }
        $systemText = [string]$payload.system
        if ($systemText.Length -gt $Config.MaxSystemChars) {
            Send-ProxyJson $response 400 @{ error = 'System prompt is too long' }; $responseHandled = $true; return
        }
    }

    # Allow-list all parameters forwarded to Ollama. Never forward caller-supplied
    # URLs, tools, paths, options, templates or arbitrary server parameters.
    $temperature = 0.3
    if ($format -eq 'json') { $temperature = 0.1 }
    $ollamaPayload = @{
        model = $requestedModel
        prompt = $prompt
        stream = $false
        options = @{
            num_ctx = $Config.ContextTokens
            num_predict = $requestedOutputTokens
            temperature = $temperature
        }
    }
    if ($format -eq 'json') { $ollamaPayload.format = 'json' }
    if (-not [string]::IsNullOrEmpty($systemText)) { $ollamaPayload.system = $systemText }
    $ollamaJson = ConvertTo-Json -InputObject $ollamaPayload -Depth 8 -Compress
    $ollamaBytes = [System.Text.Encoding]::UTF8.GetBytes($ollamaJson)

    $ollamaRequest = [System.Net.HttpWebRequest]::Create($Config.OllamaEndpoint)
    $ollamaRequest.Method = 'POST'
    $ollamaRequest.ContentType = 'application/json; charset=utf-8'
    $ollamaRequest.ContentLength = $ollamaBytes.Length
    $ollamaRequest.Timeout = $Config.OllamaTimeoutMs
    $ollamaRequest.ReadWriteTimeout = $Config.OllamaTimeoutMs
    $ollamaRequest.KeepAlive = $false
    $ollamaStream = $ollamaRequest.GetRequestStream()
    try { $ollamaStream.Write($ollamaBytes, 0, $ollamaBytes.Length) } finally { $ollamaStream.Close() }

    $ollamaResponse = $ollamaRequest.GetResponse()
    try {
        $ollamaReader = New-Object System.IO.StreamReader($ollamaResponse.GetResponseStream())
        try { $ollamaResponseText = $ollamaReader.ReadToEnd() } finally { $ollamaReader.Dispose() }
    } finally { $ollamaResponse.Close() }

    try { $ollamaResult = $ollamaResponseText | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Ollama returned an invalid response.' }
    if ($null -eq $ollamaResult.response -or -not ($ollamaResult.response -is [string])) {
        throw 'Ollama response did not contain text.'
    }
    Send-ProxyJson $response 200 @{ response = [string]$ollamaResult.response }
    $responseHandled = $true
}
catch {
    # Do not expose upstream details or secrets to the caller.
    if (-not $responseHandled) {
        try { Send-ProxyJson $response 502 @{ error = 'AI service temporarily unavailable' }; $responseHandled = $true } catch { }
    }
}
finally {
    try { $response.Close() } catch { }
}
'@

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($ListenPrefix)
$runspacePool = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspacePool(1, $MaxProxyWorkers)
$runspacePool.Open()
$pending = New-Object System.Collections.ArrayList

try {
    $listener.Start()
    Write-Host 'AKSON Doxi concurrent proxy started on 127.0.0.1:8787' -ForegroundColor Green
    Write-Host ("HTTP workers: {0} | Ollama parallel generations: configured separately | accepted in-flight cap: {1}" -f $MaxProxyWorkers, $MaxAcceptedInFlight)
    Write-Host 'Allowed model: qwen3.5:9b | Context: 8192 | Output limit: 1200'
    Write-Host 'The proxy remains loopback-only. Shared-secret check is enabled. Press Ctrl+C to stop.'

    $acceptAsync = $listener.BeginGetContext($null, $null)
    while ($listener.IsListening) {
        $context = $listener.EndGetContext($acceptAsync)
        $acceptAsync = $listener.BeginGetContext($null, $null)

        # Reap completed request runspaces without blocking active requests.
        for ($i = $pending.Count - 1; $i -ge 0; $i--) {
            $entry = $pending[$i]
            if ($entry.Handle.IsCompleted) {
                try { $null = $entry.PowerShell.EndInvoke($entry.Handle) } catch { }
                $entry.PowerShell.Dispose()
                $pending.RemoveAt($i)
            }
        }

        if ($pending.Count -ge $MaxAcceptedInFlight) {
            try { Send-ProxyJson -Response $context.Response -StatusCode 503 -Data @{ error = 'Proxy is busy. Retry shortly.' } }
            catch { }
            try { $context.Response.Close() } catch { }
            continue
        }

        $ps = [System.Management.Automation.PowerShell]::Create()
        $ps.RunspacePool = $runspacePool
        [void]$ps.AddScript($WorkerScript).AddArgument($context).AddArgument($Config)
        $handle = $ps.BeginInvoke()
        [void]$pending.Add([pscustomobject]@{ PowerShell = $ps; Handle = $handle })
    }
}
catch [System.Net.HttpListenerException] {
    # Expected when the user stops the listener with Ctrl+C or closes it.
}
finally {
    try { if ($listener.IsListening) { $listener.Stop() } } catch { }
    try { $listener.Close() } catch { }
    $drainUntil = (Get-Date).AddMinutes(10)
    foreach ($entry in @($pending)) {
        try {
            $remaining = [int][Math]::Max(0, ($drainUntil - (Get-Date)).TotalMilliseconds)
            if ($remaining -gt 0) { $null = $entry.Handle.AsyncWaitHandle.WaitOne($remaining) }
            if ($entry.Handle.IsCompleted) { $null = $entry.PowerShell.EndInvoke($entry.Handle) }
        } catch { }
        try { $entry.PowerShell.Dispose() } catch { }
    }
    try { $runspacePool.Close() } catch { }
    try { $runspacePool.Dispose() } catch { }
}
