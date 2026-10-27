# legacy/ — không dùng trong trận

Đây là prototype trước khi BTC công bố guide chính thức. Phần này được giữ lại để tham khảo ý tưởng.

| Thư mục | Vì sao không dùng được |
|---|---|
| `openhands-fork/` | Chạy OpenHands thành một server hoặc process riêng. Guide **cấm** khởi chạy app-server hay CLI độc lập để làm việc trong trận |
| `digital-project-team/` | Brain viết bằng Python, gọi các endpoint giả định (`/items`, `/scoreboard`, MVS) không tồn tại, và không ghi progress NDJSON |
| `target-repositories/` | Các repo FastAPI dùng cho thí nghiệm |

## Phần đã được port sang team-pack (`team-pack/src/brain/`)

| Legacy | team-pack |
|---|---|
| `core/scoring/{ev_engine,priority_engine}.py` | `src/brain/scoring.mjs` |
| `core/scheduler/portfolio_planner.py` | `src/brain/planner.mjs` → tool `plan_next` |
| `core/state_machine/item_state.py`, `core/lifecycle/controller.py` | `src/brain/state-machine.mjs` |
| `agents/submission/authority.py`, `agents/review/review.py`, coverage trong `testing_service` | `src/brain/authority.mjs` → tool `report_verification` và gate trong `submit_work` |
| `services/{deadline,incident}_service`, `observability/watchdog.py`, `core/state_machine/match_state.py` | `src/brain/match-brain.mjs` |
| `knowledge/scanner.py`, `memory/repository_memory` | `src/brain/repo-scanner.mjs` → tool `scan_repo` |
| `workflows/*.yaml`, `agents/*_squad` | `skills/workflow-{pi,bug,cr,task}/SKILL.md` cùng các subagent profile |
| `competitions/master_the_machine/rules/*.yaml` | `src/brain/rules.mjs` |
| `simulator/`, `scripts/benchmark.py`, `tests/unit/*` | `test/simulate.mjs`, `test/brain.test.mjs` |

Phần không port: OpenHands (đã có Codex thay thế), event bus (đã có progress log NDJSON và các tool đồng bộ), và `match_memory`/`task_memory` dạng file (guide chỉ cho ghi vào log, nên khi resume sẽ khôi phục từ log).
