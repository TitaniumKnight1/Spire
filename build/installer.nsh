; Inbound firewall for WebTorrent (matches main process ensureFirewallRules names).
; Rule names are unique per TCP/UDP (Windows rejects duplicate display names).

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Spire Audiobook Player - App TCP" dir=in action=allow program="$INSTDIR\Spire.exe" protocol=TCP enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Spire Audiobook Player - App UDP" dir=in action=allow program="$INSTDIR\Spire.exe" protocol=UDP enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Spire Audiobook Player - Ports TCP" dir=in action=allow protocol=TCP localport=6881-6889 enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Spire Audiobook Player - Ports UDP" dir=in action=allow protocol=UDP localport=6881-6889 enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Spire Audiobook Player - App TCP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Spire Audiobook Player - App UDP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Spire Audiobook Player - Ports TCP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Spire Audiobook Player - Ports UDP"'
!macroend
