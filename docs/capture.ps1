Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UI {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr ins, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int b, int e);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static void Click(int x, int y) {
        SetCursorPos(x,y); System.Threading.Thread.Sleep(100);
        mouse_event(0x02,x,y,0,0); System.Threading.Thread.Sleep(80); mouse_event(0x04,x,y,0,0);
    }
    public static void ScrollDown(int x, int y, int clicks) {
        SetCursorPos(x, y); System.Threading.Thread.Sleep(50);
        mouse_event(0x0800, x, y, -clicks * 120, 0);
    }
}
"@
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$folder = "e:\xampp\htdocs\Backups\topten\APPLICATIONS\Google Ads Dashboard\V2\docs\screenshots"

function Snap($name) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bmp.Save("$folder\$name.png"); $g.Dispose(); $bmp.Dispose()
}

function FocusElectron {
    $proc = Get-Process | Where-Object { $_.Name -eq 'electron' -and $_.MainWindowTitle -like 'GAds*' } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($proc) {
        $hwnd = $proc.MainWindowHandle
        [UI]::ShowWindow($hwnd, 9) | Out-Null
        [UI]::SetWindowPos($hwnd, [UI]::HWND_TOPMOST, 0, 0, 0, 0, 0x0003) | Out-Null
        [UI]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 400
    }
}

# Minimize VSCode
$vsc = Get-Process | Where-Object { $_.Name -eq 'Code' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($vsc) { [UI]::ShowWindow($vsc.MainWindowHandle, 6) | Out-Null }

Start-Sleep -Milliseconds 600
FocusElectron

# 01 - Initial state
Snap "01_initial_state"
Start-Sleep -Milliseconds 300

# Click Campaign dropdown
[UI]::Click(505, 280)
Start-Sleep -Milliseconds 1400
Snap "02_campaign_dropdown_open"
Start-Sleep -Milliseconds 200

# Select first campaign option (likely at y~320 or so, let's try y=320)
[UI]::Click(505, 320)
Start-Sleep -Milliseconds 1200
Snap "03_campaign_selected"
Start-Sleep -Milliseconds 200

# Click Ad Group dropdown
[UI]::Click(862, 280)
Start-Sleep -Milliseconds 1400
Snap "04_adgroup_dropdown_open"
Start-Sleep -Milliseconds 200

# Select first ad group option
[UI]::Click(862, 320)
Start-Sleep -Milliseconds 1000
Snap "05_adgroup_selected"
Start-Sleep -Milliseconds 200

# Click Analyze Ad Group button
[UI]::Click(1147, 280)
Start-Sleep -Milliseconds 1200
Snap "06_loading_state"

# Wait for data to load (up to 20 seconds)
Start-Sleep -Milliseconds 8000
Snap "07_audit_results_top"

# Scroll down to see more
[UI]::ScrollDown(760, 500, 5)
Start-Sleep -Milliseconds 800
Snap "08_audit_headlines_table"

[UI]::ScrollDown(760, 500, 5)
Start-Sleep -Milliseconds 800
Snap "09_quality_score"

[UI]::ScrollDown(760, 500, 5)
Start-Sleep -Milliseconds 800
Snap "10_ai_actions"

[UI]::ScrollDown(760, 500, 5)
Start-Sleep -Milliseconds 800
Snap "11_intent_analysis"

[UI]::ScrollDown(760, 500, 5)
Start-Sleep -Milliseconds 800
Snap "12_landing_page"

# Scroll back to top
[UI]::ScrollDown(760, 500, -20)
Start-Sleep -Milliseconds 600

# Click Tab 2: Generate New RSA using AI
[UI]::Click(627, 362)
Start-Sleep -Milliseconds 800
Snap "13_tab2_generate_form"

# Done
"DONE" | Out-File "$folder\capture_done.txt"
