# Threadmill Mate - à lancer sur le PC qui garde les vidéos (IT11_BENOIT), via 1-PC-des-videos.bat (administrateur).
# Règle tout d'un coup : réseau privé, pare-feu (partage de fichiers et découverte), compte « videos »,
# partage « VideosTapis » en lecture seule (droits du partage + droits du dossier).
$ErrorActionPreference = 'Stop'
$share = 'VideosTapis'
function Etape($t){ Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Ok($t){ Write-Host "   OK  $t" -ForegroundColor Green }
function Avert($t){ Write-Host "   !   $t" -ForegroundColor Yellow }

Write-Host '=== Threadmill Mate : partage du dossier des vidéos ===' -ForegroundColor White

Etape '1/6 Choix du dossier des vidéos'
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Choisis le dossier qui contient tes vidéos GoPro'
if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Avert 'Annulé.'; return }
$path = $dlg.SelectedPath
Ok $path

Etape '2/6 Réseau en « privé »'
try {
  Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object {
    Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private }
  Ok ((Get-NetConnectionProfile | ForEach-Object { "$($_.Name) : $($_.NetworkCategory)" }) -join ', ')
} catch { Avert "Impossible de changer le profil réseau : $($_.Exception.Message)" }

Etape '3/6 Pare-feu et services (partage de fichiers, découverte du réseau)'
# groupes désignés par leur identifiant (indépendant de la langue de Windows)
foreach ($g in '@FirewallAPI.dll,-28502', '@FirewallAPI.dll,-32752') {
  Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue |
    Where-Object { $_.Profile -match 'Private|Any' } | Enable-NetFirewallRule
}
foreach ($s in 'LanmanServer', 'FDResPub', 'SSDPSRV', 'upnphost') {
  try { Set-Service $s -StartupType Automatic; Start-Service $s } catch { Avert "Service $s : $($_.Exception.Message)" }
}
Ok 'Partage de fichiers et découverte du réseau ouverts sur le réseau privé'

Etape '4/6 Compte « videos » (sert uniquement à lire les vidéos depuis le réseau)'
$pw = Read-Host 'Choisis un mot de passe pour le compte « videos »' -AsSecureString
if ((New-Object System.Net.NetworkCredential('', $pw)).Password.Length -lt 4) { Avert 'Mot de passe trop court (4 caractères au moins). Relance le script.'; return }
if (Get-LocalUser -Name videos -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name videos -Password $pw -PasswordNeverExpires $true
  Enable-LocalUser -Name videos
} else {
  New-LocalUser -Name videos -Password $pw -PasswordNeverExpires -AccountNeverExpires -Description 'Lecture des vidéos Threadmill Mate' | Out-Null
}
try { Add-LocalGroupMember -SID 'S-1-5-32-545' -Member videos -ErrorAction Stop } catch { }   # groupe « Utilisateurs »
# compte masqué sur l'écran de connexion de Windows
$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name videos -Value 0 -PropertyType DWord -Force | Out-Null
Ok 'Compte prêt (masqué sur l''écran de connexion)'

Etape '5/6 Partage « VideosTapis » en lecture seule'
# anciens partages de ce dossier retirés (dont un éventuel « Tout le monde » en lecture/écriture)
Get-SmbShare | Where-Object { $_.Path -eq $path -or $_.Name -eq $share } | ForEach-Object { Remove-SmbShare -Name $_.Name -Force }
New-SmbShare -Name $share -Path $path -ReadAccess "$env:COMPUTERNAME\videos" | Out-Null
# droits du dossier lui-même (sinon le partage s'ouvre mais le dossier refuse la lecture)
& icacls "$path" /grant "$($env:COMPUTERNAME)\videos:(OI)(CI)RX" | Out-Null
# partage protégé par mot de passe (connexion avec le compte « videos »)
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' -Name everyoneincludesanonymous -Value 0
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' -Name restrictnullsessaccess -Value 1
Ok "\\$env:COMPUTERNAME\$share  ->  $path"

Etape '6/6 À noter pour l''ordinateur du tapis'
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress -join ', '
Write-Host ''
Write-Host "   Nom de ce PC      : $env:COMPUTERNAME" -ForegroundColor White
Write-Host "   Adresse(s) IP     : $ips" -ForegroundColor White
Write-Host "   Compte            : videos (mot de passe choisi à l'étape 4)" -ForegroundColor White
Write-Host ''
Write-Host 'Terminé. Lance maintenant 2-PC-du-tapis.bat sur l''ordinateur du tapis.' -ForegroundColor Green
Write-Host 'Ce PC doit rester allumé (et pas en veille) pendant tes séances.' -ForegroundColor Green
