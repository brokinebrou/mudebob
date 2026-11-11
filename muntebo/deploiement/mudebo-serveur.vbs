' Lance le serveur MUDEBO sans fenetre (utilise au demarrage de la session Windows)
Set sh = CreateObject("WScript.Shell")
dossier = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & dossier & "\serveur.bat""", 0, False
