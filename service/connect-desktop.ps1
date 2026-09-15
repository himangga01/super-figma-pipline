param(
    [Parameter(Mandatory = $true)][string]$FigmaUrl,
    [string]$Workspace,
    [switch]$AllowModelData
)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & corepack enable --install-directory node_modules/.bin pnpm
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & corepack pnpm -r build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $connectArguments = @('packages/cli/dist/index.mjs', 'connect', '--url', $FigmaUrl, '--keep-open')
    if ($Workspace) { $connectArguments += @('--workspace', $Workspace) }
    if ($AllowModelData) { $connectArguments += '--allow-model-data' }
    & node @connectArguments
    exit $LASTEXITCODE
} finally { Pop-Location }
