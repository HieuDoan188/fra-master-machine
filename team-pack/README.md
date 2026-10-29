# team-sdlc-pack — [FHM] FRAIO (FRA)

Đây là team pack của đội **FRA** cho Master The Machine (MTM-26). Nó được dựng theo *MTM Team Orchestrator Technical Guide v0.5.1* và *Digital Cuder API*.

- Package name: `team-sdlc-pack`. Đây là tên bắt buộc, không đổi thành tên đội.
- Provider: `codex`. Root agent: `team_orchestrator`.
- Identity nằm trong `team-pack-info.json` (`FRA` / `[FHM] FRAIO`). Khi đổi version, sửa cả `package.json` và `team-runtime.json`.

## Cách pack hoạt động

```
mtm-player ──spawn──► Codex CLI (agent team_orchestrator)
                         │ native subagents: team_repo_scout, team_feature_worker, team_quality_checker
                         │ MCP stdio
                         ▼
                 mtm_minimal (bin/runtime-server.mjs, chỉ dùng Node built-ins)
                   ├─ POST /api/v1/auth/login       (cookie, giữ trong RAM)
                   ├─ GET  /api/v1/match/<matchId>  (backlog, repo, match UUID)
                   ├─ POST /api/v1/matches/<uuid>/backlogs/start   (Bearer)
                   ├─ POST /api/v1/matches/<uuid>/submissions      (Bearer + Idempotency-Key)
                   └─ append <TeamWorkspace>/team-sdlc-pack/logs/<matchId>.progress.ndjson ──► mtm-player
```

Helper tự ghi mọi event bắt buộc gắn với API: ORCHESTRATOR_STARTED/RESTARTED/ENDED, GAME_MASTER_API, MATCH_LOGIN, BACKLOG_SYNC, DISCOVERED, IN_PROGRESS, BACKLOG_TESTS NOT_RUN và SUBMITTED kèm receipt thật. Agent chỉ báo những gì nó tự làm: chuẩn bị môi trường, build, kết quả test thật, blocker. Helper từ chối các event sai luật, ví dụ PASSED khi không chạy test, SUBMITTED khi chưa có receipt, hay PREPARE_COMPLETE.

## Cài đặt (operator)

```powershell
# 1. Cài vào TeamWorkspace (đường dẫn tuyệt đối, không đi qua symlink/junction)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -TeamWorkspace "D:\mtm\FRA"

# 2. Kiểm tra: phải in ra READY
node .\scripts\check-distribution.mjs --team-workspace "D:\mtm\FRA"

# 3. Trong mtm-player: chọn workspace D:\mtm\FRA → Load team pack → kiểm tra identity FRA → Init
```

Cài lại cùng một version là idempotent. Bản nâng cấp chỉ thay file của pack, không đụng `matches/` và `team-sdlc-pack/logs/`. Nếu đổi chỗ workspace, chạy lại `install.ps1` để cập nhật đường dẫn MCP, rồi reload session.

## Build bản nộp

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
# → ..\dist\team-pack-FRA-1.0.0.zip và .zip.sha256
```

`build.ps1` chạy smoke test với mock server, cài vào workspace sạch hai lần (mỗi lần đều chạy checker), quét chuỗi giống credential, rồi đóng ZIP và tính SHA256.

## Tài khoản Codex

mtm-player 0.9.35 chạy `codex app-server` với `cwd = <TeamWorkspace>` và **`CODEX_HOME` mặc định** (`~\.codex`), tức là dùng đúng tài khoản Codex đang đăng nhập trên máy (`codex login status`). Codex chỉ nạp `<TeamWorkspace>\.codex\config.toml` (MCP `mtm_minimal`) khi workspace đã được **trust**:

```toml
# ~\.codex\config.toml
[projects.'d:\mtm\fra']
trust_level = "trusted"
```

Kiểm tra bằng cách chạy `codex mcp list` trong `D:\mtm\FRA`: phải thấy `mtm_minimal … enabled`. Xem đầy đủ ở [docs/RUN-TEST.md](docs/RUN-TEST.md).

- Không pin `model` trong agent profile. Model lấy từ `allowedModels` trong `MTM_MODEL_POLICY_V1` do mtm-player gửi.
- Quyền GitHub (clone/push repo được giao) là **Git credential của operator**, khác với tài khoản Codex. Pack không bao giờ lưu token Git.

## Kiểm thử

```powershell
node --test test/brain.test.mjs test/e2e.test.mjs
node test/simulate.mjs
```

Test dùng mock server ở loopback (`test/mock-server.mjs`) và chỉ bật HTTP loopback khi có `MTM_PACK_ALLOW_LOOPBACK=1`. Production chỉ chấp nhận origin HTTPS nằm trong allowlist.

Chi tiết thiết kế xem [docs/README.md](docs/README.md). Các bước chạy test và trận thử xem [docs/RUN-TEST.md](docs/RUN-TEST.md).
