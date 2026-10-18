# Threadmill Mate - à lancer sur l'ordinateur du tapis, via 2-PC-du-tapis.bat (sans droits administrateur :
# le lecteur V: doit appartenir à ta session). Connecte \\<PC>\VideosTapis en lecteur V: (reconnexion automatique)
# et dit en clair ce qui bloque si ça ne marche pas.
$share = 'VideosTapis'; $drive = 'V:'
function Etape($t){ Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Ok($t){ Write-Host "   OK  $t" -ForegroundColor Green }
function Ko($t){ Write-Host ''; Write-Host "   PROBLÈME : $t" -ForegroundColor Red }

Write-Host '=== Threadmill Mate : connexion au dossier des vidéos ===' -ForegroundColor White
$pc = Read-Host 'Nom du PC qui garde les vidéos [Entrée = IT11_BENOIT]'
if (-not $pc) { $pc = 'IT11_BENOIT' }

Etape "1/4 Recherche de $pc sur le réseau"
$target = $pc
try { $ip = ([System.Net.Dns]::GetHostAddresses($pc) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1).IPAddressToString } catch { $ip = $null }
if (-not $ip) {
  $ip = Read-Host "   $pc introuvable par son nom. Tape son adresse IP (affichée à la fin du script 1)"
  if (-not $ip) { Ko "PC introuvable."; return }
}
Ok "$pc = $ip"

Etape '2/4 Le partage répond-il ?'
$smb = Test-NetConnection -ComputerName $ip -Port 445 -WarningAction SilentlyContinue
if (-not $smb.TcpTestSucceeded) {
  if ($smb.PingSucceeded) { Ko "$pc répond mais refuse le partage de fichiers : lance (ou relance) 1-PC-des-videos.bat sur $pc. Un antivirus avec son propre pare-feu (Norton, McAfee, Avast, Kaspersky…) peut aussi le bloquer : autorise-y le partage de fichiers sur le réseau privé." }
  else { Ko "$pc ne répond pas : est-il allumé, réveillé, et sur la même box ? Sinon lance 1-PC-des-videos.bat sur $pc." }
  return
}
Ok 'Partage de fichiers joignable'
# par l'adresse IP, sauf si le nom marche aussi (le lecteur suivra le PC si son adresse change)
$byName = (Test-NetConnection -ComputerName $pc -Port 445 -WarningAction SilentlyContinue).TcpTestSucceeded
if ($byName) { $target = $pc } else { $target = $ip }

Etape '3/4 Connexion avec le compte « videos »'
$pw = Read-Host "Mot de passe du compte « videos » (choisi dans le script 1)" -AsSecureString
$plain = (New-Object System.Net.NetworkCredential('', $pw)).Password
# anciennes connexions et identifiants vers ce PC retirés (cause de l'erreur 1219)
& net use $drive /delete /y 2>$null | Out-Null
foreach ($t in @($pc, $ip) | Select-Object -Unique) {
  & net use "\\$t\IPC$" /delete /y 2>$null | Out-Null
  & net use "\\$t\$share" /delete /y 2>$null | Out-Null
  & cmdkey "/delete:$t" 2>$null | Out-Null
}
& cmdkey "/add:$target" "/user:$pc\videos" "/pass:$plain" | Out-Null
$out = & net use $drive "\\$target\$share" /persistent:yes 2>&1 | Out-String
$code = $LASTEXITCODE
if ($code -ne 0) {
  $num = if ($out -match '(?:syst\S*me|error)\s+(\d+)') { [int]$Matches[1] } else { 0 }   # « Erreur système 53 » / « System error 53 »
  $why = switch ($num) {
    53   { "chemin réseau introuvable : relance 1-PC-des-videos.bat sur $pc (pare-feu)." }
    67   { "le partage « $share » n'existe pas sur $pc : relance 1-PC-des-videos.bat sur $pc." }
    86   { 'mot de passe incorrect pour le compte « videos ».' }
    1326 { 'identifiant ou mot de passe incorrect (compte « videos » et mot de passe du script 1).' }
    1219 { 'une autre connexion à ce PC est ouverte avec un autre compte : redémarre cet ordinateur puis relance ce script.' }
    5    { "accès refusé : relance 1-PC-des-videos.bat sur $pc (droits du dossier)." }
    64   { "la connexion a été coupée par $pc : un antivirus avec pare-feu sur $pc bloque sans doute le partage." }
    1272 { "Windows refuse la connexion sans identification : relance 1-PC-des-videos.bat sur $pc." }
    default { 'erreur inattendue (voir le message ci-dessous).' }
  }
  Ko $why
  Write-Host ''; Write-Host "   Message de Windows : $($out.Trim())" -ForegroundColor DarkGray
  return
}
Ok "$drive = \\$target\$share (reconnexion automatique à chaque démarrage)"

Etape '4/4 Vérification'
$n = (Get-ChildItem "$drive\" -Recurse -Depth 3 -Include *.mp4, *.mov -File -ErrorAction SilentlyContinue | Measure-Object).Count
Ok "$n vidéo(s) visible(s) dans $drive"
Write-Host ''
Write-Host 'C''est prêt. Dans Threadmill Mate : lance la séance > « Choisir le dossier de tes vidéos (une seule fois) »' -ForegroundColor Green
Write-Host "> Ce PC > lecteur $drive > Sélectionner le dossier." -ForegroundColor Green
