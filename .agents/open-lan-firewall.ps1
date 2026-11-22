# Libera acesso via LAN para o Telinha do Botecão (dev server :3000 e sinalização :4000)
# Motivo: a regra "codex_sandbox_offline_block_inbound" bloqueia TODA entrada
# vinda de fora do loopback (qualquer porta/programa/perfil). O PC abre local,
# mas o celular na mesma rede nao consegue conectar.
# A regra e apenas RECEBIDA (nao bloqueada) para a subnet local 192.168.15.0/24;
# a internet continua bloqueada.

$ErrorActionPreference = 'Continue'
$log = 'C:\Users\Usuario\AppData\Local\Temp\telinha-firewall\resultado.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== execucao $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Set-Content $log

function Log($msg) { $msg | Add-Content $log }

# 1) Backup das regras envolvidas
$bk = 'C:\Users\Usuario\AppData\Local\Temp\telinha-firewall\backup-regras.txt'
netsh advfirewall firewall show rule name=all dir=in | Out-File -Encoding utf8 $bk
Log "backup: $bk"

# 2) Alargar (nao bloquear) a subnet local na regra do sandbox
#    faixa bloqueada passa a ser: 0.0.0.0-126.255.255.255 | 128.0.0.0-192.168.14.255 | 193.0.0.0-255.255.255.255
$remoteip = '0.0.0.0-126.255.255.255,128.0.0.0-192.168.14.255,193.0.0.0-255.255.255.255,::,::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'
netsh advfirewall firewall set rule name="codex_sandbox_offline_block_inbound" new remoteip="$remoteip" 2>&1 | Add-Content $log

# 3) Regras explicitas e apertadas para o node (programa + portas), em todos os perfis
foreach ($p in 3000, 4000) {
  $existing = (netsh advfirewall firewall show rule name="Telinha dev server ($p)" 2>$null | Out-String)
  if ($existing -notmatch 'Rule Name') {
    netsh advfirewall firewall add rule name="Telinha dev server ($p)" dir=in action=allow protocol=TCP localport=$p program="C:\nvm4w\nodejs\node.exe" profile=any 2>&1 | Add-Content $log
  } else {
    Log "regra Telinha dev server ($p) ja existe"
  }
}

# 4) Evidencia
Log "--- regra sandbox apos a mudanca ---"
netsh advfirewall firewall show rule name="codex_sandbox_offline_block_inbound" 2>&1 | Add-Content $log
Log "--- portas liberadas ---"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3000, 4000 } |
  ForEach-Object { Log "LISTEN $($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess)" } | Out-Null
Log "OK: concludedo"
