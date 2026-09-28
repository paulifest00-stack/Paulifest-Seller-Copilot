param(
  [string]$NodePath = 'node',
  [ValidateRange(1024, 65535)][int]$Port = 55432,
  [switch]$DownloadPostgres
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.test-runtime'
$pgBin = Join-Path $runtimeDir 'pgsql\bin'
$pgData = Join-Path $runtimeDir 'pgdata'
$pgPasswordFile = Join-Path $runtimeDir 'postgres-password.local'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$previousDatabaseUrl = $env:DATABASE_URL
$previousPgPassword = $env:PGPASSWORD
$startedHere = $false
$testResult = 1

function Assert-NativeSuccess([string]$Action) {
  if ($LASTEXITCODE -ne 0) { throw "$Action falhou (exit $LASTEXITCODE)." }
}

Push-Location $projectRoot
try {
  $nodeCommand = Get-Command $NodePath -ErrorAction Stop
  $NodePath = $nodeCommand.Source
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  if (!(Test-Path -LiteralPath $pgCtl)) {
    if (!$DownloadPostgres) {
      throw 'PostgreSQL portátil ausente. Execute novamente com -DownloadPostgres para baixar da EDB oficial.'
    }
    $archive = Join-Path $runtimeDir 'postgresql-17.11-3.zip'
    Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip' -OutFile $archive
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
      foreach ($entry in $zip.Entries) {
        if ($entry.FullName -notmatch '^pgsql/(bin|lib|share)/' -or !$entry.Name) { continue }
        $targetPath = [IO.Path]::GetFullPath((Join-Path $runtimeDir $entry.FullName))
        if (!$targetPath.StartsWith([IO.Path]::GetFullPath($runtimeDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
          throw 'Caminho inesperado no arquivo PostgreSQL.'
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
      }
    } finally { $zip.Dispose() }
  }

  if (!(Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    $testPassword = [Guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($pgPasswordFile, $testPassword, [Text.UTF8Encoding]::new($false))
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U postgres --encoding=UTF8 --locale=C --auth=scram-sha-256 "--pwfile=$pgPasswordFile"
    Assert-NativeSuccess 'Inicialização do banco descartável'
    Add-Content -LiteralPath (Join-Path $pgData 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = $Port`n"
  }
  if (!(Test-Path -LiteralPath $pgPasswordFile)) { throw 'Senha do banco local ausente; nenhuma credencial de produção será usada.' }
  $env:PGPASSWORD = [IO.File]::ReadAllText($pgPasswordFile).Trim()
  & $pgCtl -D $pgData status *> $null
  if ($LASTEXITCODE -ne 0) {
    $startedHere = $true
    $pgStart = Start-Process -FilePath $pgCtl -ArgumentList @('-D', ('"' + $pgData + '"'), '-l', ('"' + (Join-Path $runtimeDir 'postgres.log') + '"'), '-w', '-t', '30', 'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'pg-start.log') -RedirectStandardError (Join-Path $runtimeDir 'pg-start-error.log')
    if (!$pgStart.WaitForExit(35000)) { throw 'Tempo limite ao iniciar PostgreSQL local.' }
    $pgStart.WaitForExit()
    if ($pgStart.ExitCode -ne 0 -and $null -ne $pgStart.ExitCode) { throw 'Início do PostgreSQL falhou. Consulte .test-runtime/pg-start-error.log.' }
  }

  # Comprova que a porta corresponde ao cluster descartável antes de qualquer teste destrutivo.
  $actualData = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $Port -w -U postgres -d postgres -Atc 'SHOW data_directory'
  Assert-NativeSuccess 'Verificação do cluster'
  if ([IO.Path]::GetFullPath($actualData.Trim()) -ne [IO.Path]::GetFullPath($pgData)) {
    throw 'A porta aponta para outro cluster. Testes cancelados.'
  }
  $exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $Port -w -U postgres -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'paulifest_test'"
  Assert-NativeSuccess 'Verificação do banco'
  if ($exists -ne '1') {
    & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $Port -w -U postgres paulifest_test
    Assert-NativeSuccess 'Criação do banco descartável'
  }

  $env:DATABASE_URL = 'postgresql://postgres:' + [Uri]::EscapeDataString($env:PGPASSWORD) + '@127.0.0.1:' + $Port + '/paulifest_test'
  & $NodePath node_modules/vite/bin/vite.js build --config vite.test.config.ts
  Assert-NativeSuccess 'Build dos testes'
  & $NodePath dist-test/test.mjs
  $testResult = $LASTEXITCODE
} finally {
  if ($startedHere) {
    & $pgCtl -D $pgData -m fast -w -t 30 stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Não foi possível encerrar o PostgreSQL local.'; $testResult = 1 }
  }
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:PGPASSWORD = $previousPgPassword
  Pop-Location
}
exit $testResult
