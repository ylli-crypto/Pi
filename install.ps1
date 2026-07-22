# Pi Setup installer for Windows PowerShell.
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "node is required. Install Node.js 20 or newer, then run this installer again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required. Install Node.js 20 or newer, then run this installer again."
}

try {
  $nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
} catch {
  Fail "Node.js could not be started. Install Node.js 20 or newer, then run this installer again."
}

if ($nodeMajor -lt 20) {
  Fail "Node.js 20 or newer is required. Found $(& node --version)."
}

$root = Split-Path -Parent $PSCommandPath
Write-Output "Installing Pi Setup from: $root"
& node (Join-Path $root "install.mjs") --replace
exit $LASTEXITCODE
