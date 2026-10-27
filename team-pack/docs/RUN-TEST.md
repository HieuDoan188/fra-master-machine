# Chạy test — từ máy local đến trận thử trên masterthemachine.tech

Đường dẫn ví dụ: TeamWorkspace `D:\mtm\FRA`. Workspace **không** được nằm trong `%TEMP%` (Codex từ chối tạo helper binary ở đó) và không được đi qua symlink hay junction.

## A. Test tại chỗ (không cần BTC, khoảng 1 phút)

```powershell
cd E:\MasterMachine\fra-master-machine\team-pack
node -v                                                   # cần >= 20
node --test test/brain.test.mjs test/e2e.test.mjs         # mong đợi: pass 16, fail 0
node test/simulate.mjs --capacity 2                       # so sánh planner EV và FIFO
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1   # → ..\dist\team-pack-FRA-1.0.0.zip
```

## B. Chuẩn bị máy thi (làm trước giờ thi, đồng hồ không dừng cho bước setup)

1. **Cài pack**
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -TeamWorkspace "D:\mtm\FRA"
   node .\scripts\check-distribution.mjs --team-workspace "D:\mtm\FRA"   # phải in READY
   ```

2. **Đăng nhập Codex cho workspace thi.** mtm-player chạy Codex với `CODEX_HOME=D:\mtm\FRA\.codex`, đây là một "nhà" riêng, chưa có đăng nhập.
   ```powershell
   $codex = (Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
   # (nếu cài CLI qua npm: npm i -g @openai/codex  →  $codex = "codex")
   $env:CODEX_HOME = "D:\mtm\FRA\.codex"
   & $codex login            # đăng nhập bằng tài khoản BTC cấp
   & $codex login status     # mong đợi: Logged in ...
   & $codex mcp list         # mong đợi: mtm_minimal ... enabled
   Remove-Item Env:CODEX_HOME
   ```
   Nếu `mtm_minimal` không xuất hiện, chạy lại `install.ps1` và kiểm tra lại `CODEX_HOME`.

3. **Kiểm tra Codex gọi được helper** (không cần trận):
   ```powershell
   $env:CODEX_HOME = "D:\mtm\FRA\.codex"; cd D:\mtm\FRA
   & $codex exec "Call the mtm_minimal session_status tool once and print its JSON result. Do nothing else."
   Remove-Item Env:CODEX_HOME
   ```
   Kết quả mong đợi có `"phase":"NEW"`. Tức là Codex đã nạp và gọi được MCP helper.

4. **Git**: tài khoản GitHub mà BTC đã add phải clone và push được repo bài thi mà không bị hỏi mật khẩu:
   ```powershell
   git ls-remote https://github.com/lqdung863/mtm-fra.git    # thay bằng repo được giao
   ```
   Nếu bị hỏi, đăng nhập Git Credential Manager trước, vì guide giao việc xác thực Git cho operator.

5. **Môi trường app Solova**, theo `mtm-fra/M0PPU0FA/env-require/README.md`: PostgreSQL ở port 5433, `db-setup.sql`, `src/.env`, `prepare-source.ps1`, `migrate deploy`, `db:seed`, rồi `doctor.ps1` phải báo `Environment status: READY`.

## C. Trận thử trên https://masterthemachine.tech/match

1. **Đọc thông tin trận**: đăng nhập https://masterthemachine.tech/login bằng tài khoản *Cuder* của đội, mở `/match`, chọn trận luyện tập. Ghi lại:
   - **match code** (8 ký tự), repository, branch, folder;
   - **team code** hiển thị. Nó **phải trùng** `teamId` trong `team-pack-info.json` (đang là `FRA`). Nếu khác, sửa `teamId`, rồi build và cài lại.
2. **mtm-player** (app của BTC): chọn workspace `D:\mtm\FRA` → *Load team pack* → kiểm tra identity FRA / FRA Master Machine → nhập team, match, quyền truy cập server, chọn model và cách duyệt (approval) → *Init*.
3. **Theo dõi preparation** ở một cửa sổ khác:
   ```powershell
   Get-Content D:\mtm\FRA\team-sdlc-pack\logs\<MATCH>.progress.ndjson -Wait
   ```
   Thứ tự mong đợi: `ORCHESTRATOR_STARTED` → `PREPARATION_STATUS` GIT_AUTH / REPOSITORY / ENVIRONMENT / BUILD → `MATCH_LOGIN COMPLETED` → `ENVIRONMENT_READY`. mtm-player chuyển sang PREPARED.
4. **Khi BTC bắt đầu trận** (START_GAME): `GAME_START_STATUS BACKLOG_SYNC` → `DISCOVERED` từng item → `START_WORK` → `IN_PROGRESS` → `BACKLOG_TESTS` RUNNING → PASSED → `COMPLETED` (gate duyệt) → `SUBMIT` → `SUBMITTED` kèm `receiptId`.
5. **Sau trận**:
   ```powershell
   node E:\MasterMachine\fra-master-machine\team-pack\test\validate-log.mjs D:\mtm\FRA\team-sdlc-pack\logs\<MATCH>.progress.ndjson
   git -C D:\mtm\FRA\matches\<MATCH> log --oneline -10
   ```
   Xem điểm trên trang match. Gửi file log cho đội dev để tinh chỉnh `estMinutes` và các ngưỡng của gate.

## D. Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `Not logged in` | Chưa chạy `codex login` với `CODEX_HOME=<TW>\.codex` (bước B2) |
| `mtm_minimal` không có trong `codex mcp list` | Sai `CODEX_HOME`, hoặc workspace bị đổi chỗ, cần cài lại |
| `LOGIN_FAILED` | Sai tài khoản Cuder, hoặc origin server không nằm trong allowlist mà mtm-player gửi |
| `ASSIGNMENT_MISMATCH: team code differs` | `teamId` trong pack khác team code trên trang match |
| `GATE_NOT_PASSED` | Agent submit trước khi gọi `report_verification`. Đây là hành vi đúng của gate |
| `REVISION_NOT_PUSHED` | Commit chưa push lên `origin/<branch>` |
| `RECEIPT_MISSING` blocker | Response của Submit dùng tên field receipt khác dự đoán. Gửi log về để sửa |
| Không bao giờ thấy `ENVIRONMENT_READY` | Build hoặc doctor chưa đạt. Xem các dòng `PREPARATION_STATUS ... FAILED` |

## E. Cần ghi lại sau trận thử (để hoàn thiện pack)

1. Tên field receipt trong response Submit (`RECEIPT_MISSING` có xuất hiện không).
2. mtm-player gửi START_GAME vào cùng session với PREPARE hay mở session mới (có `ORCHESTRATOR_STARTED` thứ hai không).
3. Thời gian thật của từng item (từ `IN_PROGRESS` đến `SUBMITTED`) để sửa `estMinutes`.
4. Điểm và kết quả chấm của từng item, để chỉnh ngưỡng gate.
