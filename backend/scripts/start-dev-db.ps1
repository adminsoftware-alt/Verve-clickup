# Starts the local development Postgres (port 5433) used by the v2 work hierarchy.
# It is a separate server from any Postgres already installed on port 5432.
# Run after a reboot:  powershell -ExecutionPolicy Bypass -File backend\scripts\start-dev-db.ps1
$bin  = "C:\Program Files\PostgreSQL\18\bin"
$data = "$env:LOCALAPPDATA\timetriq\pgdata"
$log  = "$env:LOCALAPPDATA\timetriq\postgres.log"

& "$bin\pg_isready.exe" -h localhost -p 5433 | Out-Null
if ($LASTEXITCODE -eq 0) { "Dev database is already running on port 5433."; exit 0 }

Start-Process -FilePath "$bin\pg_ctl.exe" -ArgumentList @("-D", "`"$data`"", "-l", "`"$log`"", "-o", "`"-p 5433`"", "start") -WindowStyle Hidden -Wait
& "$bin\pg_isready.exe" -h localhost -p 5433
