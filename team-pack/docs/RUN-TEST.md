# Chạy thi — máy FRA (đã kiểm chứng với mtm-player 0.9.35-local)

## Đã cài sẵn trên máy này

| Thành phần | Vị trí / trạng thái |
|---|---|
| mtm-player 0.9.35-local | `D:\mtm\MTM-PLAYER\0.9.35-local\mtm-player.exe` (kèm `node.exe` 24), UI tại http://127.0.0.1:54321/manage |
| Team pack FRA 1.0.0 | TeamWorkspace `D:\mtm\FRA`; `check-distribution` READY; `mtm-player inspect-runtime` READY |
| Codex CLI | bản Codex desktop (`%LOCALAPPDATA%\OpenAI\Codex\bin`), mtm-player tự tìm thấy; đăng nhập ChatGPT ở `~\.codex`; `D:\mtm\FRA` đã được trust nên `mtm_minimal` enabled |
| PowerShell 7 | `C:\Program Files\PowerShell\7` |
| Node 24, Git, pnpm 10.12.3 | có trên PATH |
| PostgreSQL 16.15 (portable) | `D:\mtm\tools\pgsql16`, data `D:\mtm\pgdata16`, cổng 127.0.0.1:5433; start/stop bằng `D:\mtm\tools\pg-start.ps1` / `pg-stop.ps1` |
| Mật khẩu DB | `C:\Users\pc\.mtm\local-db.env` (không commit). Biến môi trường cấp user `MTM_DATABASE_URL`, `MTM_TEST_DATABASE_URL`, `MTM_AUTH_SECRET` để agent tạo `src/.env` |
| Đề luyện tập Solova (`mtm-fra`) | `doctor.ps1` READY; typecheck và build sạch; test baseline 11/12 (1 test cascade fail sẵn, nhiều khả năng là bug cài sẵn của đề) |

## Cách mtm-player chạy team pack (đọc từ source 0.9.35)

1. Mở `mtm-player.exe` (không tham số) → trang **Manage** → chọn workspace `D:\mtm\FRA` → **Init**.
2. Form Init hỏi: **Team ID** (`FRA`), **Match ID**, workspace, **Game Master base URL**, và **bootstrap secret** do BTC cấp. mtm-player gọi `POST /api/v1/game-player/teams` để lấy thông tin đội: tài khoản match, team API key, repo được giao.
3. mtm-player kiểm tra pack (byte-exact registration), ghi `ORCHESTRATOR_STARTED` vào `team-sdlc-pack\logs\<match>.progress.ndjson`, ghi khối assignment vào `D:\mtm\FRA\AGENTS.md`, rồi chạy `codex app-server` với `cwd = D:\mtm\FRA` và gửi prompt *"Read and follow .agents/skills/game-preparation/SKILL.md … PREPARE_GAME_V2 {…}"*.
4. Khi log có `ENVIRONMENT_READY`, mtm-player tự gọi Preparation Complete, chờ server báo `IN_PROGRESS`, rồi tiếp tục **cùng thread** với `START_GAME_V4`.
5. Dashboard live ở `http://127.0.0.1:54321/<matchId>`, bản snapshot ở `team-sdlc-pack\logs\<match>.dashboard.html`.
6. Khi pause hoặc end, mtm-player dừng cả cây agent. Nếu bị gián đoạn: Manage → Resume, hoặc `restart`.

Lưu ý: thư mục `D:\mtm\FRA\matches\` phải **trống** trước mỗi lần Init. Nếu không, mtm-player sẽ hỏi xin phép xóa.

## Trước mỗi buổi thi / trận thử

```powershell
& D:\mtm\tools\pg-start.ps1                                   # PostgreSQL 5433
Invoke-RestMethod http://127.0.0.1:54321/health               # LOCAL_APP_READY; nếu không chạy:
Start-Process D:\mtm\MTM-PLAYER\0.9.35-local\mtm-player.exe -WindowStyle Hidden
git ls-remote <repo được giao>                                 # không được hỏi mật khẩu
```

### Quota Codex (trận GECXSDJB thua vì hết quota ở phút 32)

- Mở https://chatgpt.com/settings/usage trước trận. Nếu hạn mức 5 giờ đã dùng quá nửa thì chờ reset rồi mới chơi.
- Không chạy các trận luyện tập liền nhau: một trận tốn khoảng 20–25 triệu token input (phần lớn được cache).
- `~\.codex\config.toml` không còn đặt `service_tier = "priority"` (chế độ nhanh tốn quota nhanh hơn). Muốn bật lại cho trận chính thức thì bỏ dấu `#` ở dòng đó.
- Hỏi BTC xem trận chính thức dùng tài khoản Codex nào và hạn mức bao nhiêu.

Kiểm tra một lần rằng Codex gọi được helper. Mình không được phép tự chạy bước này vì nó khởi chạy agent tự động, nên bạn chạy thủ công:

```powershell
cd D:\mtm\FRA
& "$((Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe | Sort-Object LastWriteTime -Desc | Select-Object -First 1).FullName)" exec --skip-git-repo-check "Call the MCP tool session_status on server mtm_minimal once and print its JSON. Do nothing else."
```

Kết quả mong đợi có `"phase":"NEW"`.

## Trận thử

1. Đăng nhập https://masterthemachine.tech bằng tài khoản Cuder, mở `/match` và chọn trận. Ghi lại **match code**, và kiểm tra **team code = FRA**.
2. Lấy **bootstrap secret** từ BTC.
3. Manage → workspace `D:\mtm\FRA` → Init → nhập Team ID `FRA`, Match ID, base URL `https://masterthemachine.tech/` (hoặc URL BTC chỉ định), bootstrap secret.
4. Theo dõi trên dashboard, hoặc: `Get-Content D:\mtm\FRA\team-sdlc-pack\logs\<MATCH>.progress.ndjson -Wait`
5. Sau trận: `node E:\MasterMachine\mtm-fra\team-pack\test\validate-log.mjs D:\mtm\FRA\team-sdlc-pack\logs\<MATCH>.progress.ndjson`

## Cập nhật pack

```powershell
cd E:\MasterMachine\mtm-fra\team-pack
.\build.ps1
.\install.ps1 -TeamWorkspace D:\mtm\FRA
node .\scripts\check-distribution.mjs --team-workspace D:\mtm\FRA
```

Chỉ cài lại khi không có trận đang chạy. Nếu đổi chỗ workspace, phải trust đường dẫn mới trong `~\.codex\config.toml`.

## Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Init báo `TEAM_RUNTIME_NOT_INSTALLED` / `INSTALLED_RUNTIME_TAMPERED` | Chạy lại `install.ps1` và checker |
| `mtm_minimal` không có trong `codex mcp list` (chạy trong `D:\mtm\FRA`) | Workspace chưa được trust: thêm `[projects.'d:\mtm\fra'] trust_level = "trusted"` vào `~\.codex\config.toml` |
| Blocker `POSTGRES_DOWN` | `& D:\mtm\tools\pg-start.ps1` |
| Blocker `DB_CREDENTIALS_MISSING` | Biến `MTM_*` chưa có trong môi trường của mtm-player: tắt rồi mở lại mtm-player sau khi đăng nhập lại Windows |
| `ASSIGNMENT_MISMATCH: team code differs` | Sửa `teamId` trong `team-pack-info.json`, rồi build và cài lại |
| `RECEIPT_MISSING` | Gửi log để chỉnh tên field receipt |
