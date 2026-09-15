param(
    [string]$FigmaUrl,
    [string]$OutputDirectory,
    [switch]$UiOnly
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
    & corepack pnpm --filter '@sfp/cli' build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $inspectArguments = @('packages/cli/dist/index.mjs', 'chrome-inspect')
    if ($FigmaUrl) { $inspectArguments += @('--url', $FigmaUrl) }
    if ($OutputDirectory) { $inspectArguments += @('--out', $OutputDirectory) }
    if ($UiOnly) { $inspectArguments += '--ui-only' }
    & node @inspectArguments
    exit $LASTEXITCODE
} finally { Pop-Location }
