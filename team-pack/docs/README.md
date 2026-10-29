# Thiết kế kỹ thuật

## Bố cục

| Đường dẫn | Vai trò |
|---|---|
| `agents/*.toml` | Bốn profile mà mtm-player yêu cầu. Tên file dùng gạch ngang, `name` dùng gạch dưới (`team-orchestrator.toml` → `team_orchestrator`) |
| `skills/team-orchestrator/` | Dispatch lifecycle và vòng lặp chính của trận |
| `skills/game-preparation/` | GIT_AUTH → REPOSITORY → ENVIRONMENT → BUILD → MATCH_LOGIN → ENVIRONMENT_READY |
| `skills/team-recovery/` | Resume, pause, end và các lỗi thường gặp |
| `config/codex.toml` | Đăng ký MCP `mtm_minimal`. Installer chỉ expand đường dẫn `args` |
| `bin/runtime-server.mjs` | MCP server: JSON-RPC theo từng dòng qua stdio |
| `src/runtime-session.mjs` | State, guardrail và các tool |
| `src/http-client.mjs` | Allowlist origin, chặn redirect, giới hạn timeout và kích thước response, cookie jar theo origin, redact secret |
| `src/progress-log.mjs` | Append NDJSON có validate schema, kèm hàng đợi retry có giới hạn |
| `src/schema.mjs` | Validator cho tập con JSON Schema mà contract dùng |
| `src/git.mjs` | Các truy vấn Git chỉ đọc để kiểm tra submission |
| `src/pack-layout.mjs` | Luật identity và layout, dùng chung cho installer và checker |
| `src/brain/rules.mjs` | Luật thi và các tham số tinh chỉnh (port từ `rules/*.yaml`) |
| `src/brain/state-machine.mjs` | Vòng đời item (port từ `item_state.py` và `lifecycle/controller.py`) |
| `src/brain/scoring.mjs` | Tính EV (port từ `ev_engine.py` và `priority_engine.py`), kèm cờ `feasible` |
| `src/brain/planner.mjs` | Portfolio planner (port từ `portfolio_planner.py`), squad → profile và workflow skill |
| `src/brain/authority.mjs` | Gate của Submission Authority (port từ `authority.py`, `review.py` và phần coverage) |
| `src/brain/match-brain.mjs` | Gộp MatchState, DeadlineService, IncidentService, Watchdog và cơ chế tự hiệu chỉnh tốc độ |
| `src/brain/repo-scanner.mjs` | Repo intelligence (port từ `scanner.py` và `impacted_files`), có alias tsconfig và duyệt ngược import |
| `skills/workflow-{pi,bug,cr,task}/` | Workflow theo loại backlog (port từ `workflows/*.yaml` và các squad) |
| `test/simulate.mjs` | Simulator trận 40 phút, so planner EV với FIFO (port từ `simulator/` và `benchmark.py`) |
| `contracts/progress-event.schema.json` | Schema chép nguyên văn từ guide v0.5.1 |

## Tools MCP

| Tool | Ghi chú |
|---|---|
| `configure_session` | Nhận `input` (nguyên văn tin nhắn có marker `*_V*` và `MTM_MODEL_POLICY_V1`) hoặc `descriptor`. Kiểm tra paths, scope, độ dài và SHA-256 của bearer, origins, API templates |
| `login_match` | `POST /api/v1/auth/login`, sau đó `GET /api/v1/match/<matchId>`. Đối chiếu team code, repo url/branch/folder, lấy match UUID |
| `refresh_match` | Lấy view hiện tại. Ghi DISCOVERED cho item mới; nếu cookie hết hạn thì tự đăng nhập lại. Báo item có `revisionNo` tăng |
| `start_work` | Start Work, tạo `answers/<ID>/submit.json` từ template và thư mục `evidence/`, ghi IN_PROGRESS và NOT_RUN |
| `submit_work` | Kiểm tra SHA đã nằm trên `origin/<branch>`, file answer trong commit trùng với `answer`, các file `evidence/*` có mặt. Giữ nguyên Idempotency-Key khi kết quả UNCERTAIN |
| `report_progress` | Event của agent, kèm guardrail chống báo sai |
| `wait_for_update` | Poll tuần tự, tối đa 55 giây, mỗi lần cách 5 đến 30 giây (10 giây sau khi lỗi) |
| `plan_next` | **Bộ não**: refresh, kiểm tra deadline (cảnh báo trước 5 phút, tự đóng item hết hạn), đề xuất plan theo EV (READY_TO_SUBMIT trước, PI chen ngang, giới hạn capacity, bỏ item không kịp làm), danh sách incident với MTTR, item bị kẹt, và hệ số tốc độ |
| `report_verification` | Gate của **Submission Authority**: tất cả MVS pass, coverage ≥ 90%, confidence ≥ 0.85, regressionRisk ≤ 0.10, correctness ≥ 0.8, có evidence. Ghi BACKLOG_TESTS với số liệu thật. Đạt thì chuyển sang READY_TO_SUBMIT, không đạt thì quay về IMPLEMENTING |
| `update_item` | `rework` hoặc `fail` (ghi BACKLOG_STATUS FAILED) |
| `scan_repo` | Tóm tắt stack, lệnh build và test, file test; tham số `impactOf` trả về danh sách file bị ảnh hưởng |
| `company_tool` | **Company MCP** của trận (`/api/v1/mcp/<matchId>`, bearer của đội): `kb_search` (chính sách công ty, `query:"index"` để liệt kê) và `get_test_data` (fixture và loader chính thức). Có ghi log `GAME_MASTER_API`, giữ `Mcp-Session-Id`, đọc được SSE |
| `session_status` | Ảnh chụp trạng thái kèm trạng thái của bộ não, không chứa secret |

`submit_work` từ chối mọi item chưa qua gate. Bộ não chạy bằng code thuần, không tốn token.

### Kết quả simulator (`node test/simulate.mjs`, kịch bản giả, điểm tối đa 390)

| Cấu hình | Planner EV | FIFO |
|---|---|---|
| capacity 1 | **250** | 40 |
| capacity 2 | **320** | 220 |
| capacity 2, seed 3 | **350** | 220 |
| capacity 2, chậm hơn ước tính 30% | 120 | 120 |
| capacity 2, nhanh hơn 20% | 320 | 320 |
| capacity 3 | 320 | 320 |

Hai cải tiến đến từ simulator: (1) chừa `submitMarginSec` cho bước commit, push và submit; (2) **tự hiệu chỉnh tốc độ**, tức là đo thời gian thật trên các item đã nộp để điều chỉnh `estMinutes`. Trước khi có (2), planner EV thua FIFO khi đội làm chậm hơn ước tính. Sau mỗi trận luyện tập, hãy sửa `estMinutes` trong `rules.mjs` theo thời gian thực tế.

## Codex và mtm-player (đọc từ source 0.9.35)

- mtm-player chạy `codex app-server` với `cwd = TeamWorkspace`, `CODEX_HOME` mặc định, sandbox `danger-full-access`, `approvalPolicy: on-request`.
- Prompt mỗi phase yêu cầu agent đọc `.agents/skills/{game-preparation|team-orchestrator|team-recovery}/SKILL.md`. Đó là lý do skill là phần điều khiển chính.
- mtm-player tự ghi `ORCHESTRATOR_STARTED` khi khởi tạo log. Helper đọc log trước nên không ghi lặp.
- `.codex/config.toml` của workspace chỉ được nạp khi workspace đã được trust trong `~\.codex\config.toml`.
- mtm-player kiểm tra byte-exact `.codex/agents/team-orchestrator.toml` và `.mtm/team-{runtime,pack-info}.json` so với `team-sdlc-pack/runtime/`.

Vì sao đọc match qua `GET /api/v1/match/<matchId>`: trang `/match/<id>` render ở phía client và chính nó gọi endpoint này với cookie đăng nhập, nên đọc JSON trực tiếp là cùng dữ liệu, chỉ bớt bước parse HTML. Endpoint này được suy ra từ JS công khai của trang. Nếu BTC đổi endpoint, refresh sẽ trả lỗi và agent sẽ mở blocker.

## Guardrails đã cài cứng trong helper

- Credential chỉ nằm trong RAM. Mọi output của tool đều qua redact. Bearer chỉ gửi tới Start/Submit; cookie chỉ gửi tới origin của match.
- `checkoutRoot` phải nằm trong `<TeamWorkspace>/matches`, `matchRoot = checkoutRoot/<folder>`, không đi qua symlink hay junction, và `progressLogFile` phải nằm trong `team-sdlc-pack/logs`.
- Chỉ nhận HTTPS (HTTP loopback chỉ bật trong test mode). Không đi theo redirect. Response giới hạn 2 MB.
- Không force-push, không đổi remote. Helper không push; nó chỉ kiểm tra commit đã được push.
- Tool không chạy chồng lên nhau, trừ `configure_session`: lệnh pause/end có hiệu lực ngay cả khi đang có poll.

## Những gì chưa xác định được (cần hỏi BTC hoặc kiểm tra ở trận thử)

1. Tên field receipt trong response Submit. Helper chấp nhận `receiptId`, `receipt.id`, `submission.receiptId`, `submissionId`, `id`.
2. mtm-player có chạy PREPARE và START trong cùng một Codex session không. Nếu START đến ở process mới thì helper không có password để đăng nhập lại; khi đó nó vẫn suy ra repo từ view nhưng sẽ báo `ACCOUNT_UNAVAILABLE`.
3. Tên scope: guide ghi `submissions:create`, API doc ghi `submission:create`. Helper không chặn theo tên scope.
4. Quy ước tên file profile phụ: section 2 của guide dùng `team_developer.toml`, section 5 dùng `team-orchestrator.toml`. Pack theo section 5, vì đó là bảng MUST.

## Gộp từ bản của Tin (nhánh `team-pack` của mtm-fra), dựa trên kinh nghiệm trận luyện tập

- `company_tool` (Company MCP: KB và fixture). `plan_next` nhắc tra KB nếu chưa tra.
- Annotation `readOnlyHint` cho các tool chỉ đọc, để AI duyệt (`auto_review`) của mtm-player không chặn login hay refresh.
- Tên đội đúng: `[FHM] FRAIO`.
- Submit: chỉ khi trận `IN_PROGRESS`; kiểm tra đã push bằng `git ls-remote`; receipt đọc từ `submission.id` khi `submission.status = ACCEPTED`.
- `wait_for_update` chờ tới 600 giây (poll mỗi 5 giây trong Node, không tốn token) khi mọi item đều đã kết thúc. `tool_timeout_sec = 660`.
- Capacity mặc định là 1: làm xong và nộp từng item một (PI vẫn chen ngang).
- Skill và profile: tra KB trước, chạy check runner và loader chính thức, kiểm tra schema answer, sửa test cũ khi trái với KB hoặc migration, dùng Playwright cho evidence giao diện, quy tắc tiết kiệm token, xử lý CRLF.
- Skill `solova-reference`: bản đồ module. **Không** chép các đáp án cứng của item luyện tập.
