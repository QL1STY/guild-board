; Inno Setup recipe for Guild Board's installer. Run by build-installer.ps1 with /DAppVersion=<version>, after
; PyInstaller has filled build\package\dist\Guild Board.
;
; It installs for the one Windows user who runs it, with no administrator rights, into
; %LOCALAPPDATA%\Programs\Guild Board, and adds Guild Board to the Start menu and, if wanted, the desktop.
; The player's own data, %LOCALAPPDATA%\GuildBoard, is never touched: an update and an uninstall both leave it.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define Root ".."
#define Built Root + "\build\package\dist\Guild Board"

[Setup]
AppId={{6E0D3B2A-8C1F-4F5E-9B7A-3D2C1E0F9A84}
AppName=Guild Board
AppVersion={#AppVersion}
AppVerName=Guild Board {#AppVersion}
AppPublisher=Guild Board
LicenseFile={#Root}\LICENSE
DefaultDirName={localappdata}\Programs\Guild Board
DefaultGroupName=Guild Board
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupIconFile={#Root}\build\package\guildboard.ico
UninstallDisplayIcon={app}\guildboard-app.exe
UninstallDisplayName=Guild Board
OutputDir={#Root}\dist-installer
OutputBaseFilename=Guild Board Setup {#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Tasks]
Name: "desktop"; Description: "Put a Guild Board shortcut on the desktop"

[Files]
Source: "{#Built}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The licence, the notices of the software inside it and the privacy notice, where the player can find them beside the program.
Source: "{#Root}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\PRIVACY.md"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; An update replaces the whole program, so files an older version had and this one has not do not linger.
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{userprograms}\Guild Board"; Filename: "{app}\guildboard-app.exe"
Name: "{userdesktop}\Guild Board"; Filename: "{app}\guildboard-app.exe"; Tasks: desktop

[Registry]
; guildboard:// opens Guild Board, for an invite link. The current user's own classes, removed on uninstall. This is Guild
; Board's own key; nothing in the program itself touches the registry. The -- keeps whatever a link holds from being an option.
Root: HKCU; Subkey: "Software\Classes\guildboard"; ValueType: string; ValueName: ""; ValueData: "URL:Guild Board"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\guildboard"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\guildboard\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\guildboard-app.exe,0"
Root: HKCU; Subkey: "Software\Classes\guildboard\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\guildboard-app.exe"" -- ""%1"""

[Run]
Filename: "{app}\guildboard-app.exe"; Description: "Open Guild Board"; Flags: postinstall nowait

[Code]
// Start with Windows, if it was turned on in Guild Board's settings, goes with the program; a shortcut of the same
// name that starts another copy of Guild Board stays.
procedure RemoveStartupShortcut();
var
  Shell, Link: Variant;
  Path: String;
begin
  Path := ExpandConstant('{userstartup}\Guild Board.lnk');
  if not FileExists(Path) then
    exit;
  try
    Shell := CreateOleObject('WScript.Shell');
    Link := Shell.CreateShortcut(Path);
    if CompareText(ExtractFilePath(Link.TargetPath), AddBackslash(ExpandConstant('{app}'))) = 0 then
      DeleteFile(Path);
  except
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveStartupShortcut();
end;

// A running Guild Board is asked to quit before its files are replaced or removed; it waits until it has.
function QuitGuildBoard(Exe: String): Boolean;
var
  Code: Integer;
begin
  Result := True;
  if FileExists(Exe) then
    Result := Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not QuitGuildBoard(ExpandConstant('{app}\guildboard-app.exe')) then
    Result := 'Guild Board could not be closed. Quit it from its tray icon and run the setup again.';
end;

function InitializeUninstall(): Boolean;
begin
  QuitGuildBoard(ExpandConstant('{app}\guildboard-app.exe'));
  Result := True;  // the uninstall goes ahead: a Guild Board still running keeps only the files it holds
end;
