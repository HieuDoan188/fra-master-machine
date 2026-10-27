# Fra Master Machine

Repo của đội **FRA** cho cuộc thi **Master The Machine (MTM-26)**.

## Bố cục

```
fra-master-machine/
├── team-pack/   # ⭐ Bản nộp thi: team-sdlc-pack cho mtm-player + Codex
├── dist/        # ZIP + SHA256 do team-pack/build.ps1 tạo ra (gitignored)
└── legacy/      # Prototype cũ (Python brain + OpenHands), KHÔNG dùng trong trận
```

## Cuộc thi chạy như thế nào

BTC chọn **Codex** làm môi trường thi. **mtm-player**, app của BTC, spawn Codex CLI với agent `team_orchestrator` từ team pack của đội. Agent này:

1. **Preparation**: checkout repo được giao, dựng môi trường, build, đăng nhập vào match, rồi ghi `ENVIRONMENT_READY`.
2. **Game**: đọc backlog, gọi Start Work, sửa code, test, commit và push, rồi Submit (cần full SHA cùng `answers/<ID>/submit.json` và evidence trong cùng commit).
3. Báo mọi bước qua `<matchId>.progress.ndjson`. mtm-player chỉ biết trạng thái của đội qua file này.

Luật quan trọng: subagent chỉ được spawn bằng cơ chế native của Codex trong cùng session, **không được** chạy thêm CLI, app-server hay agent process nào khác. Vì luật này mà OpenHands trong `legacy/` không dùng được.

Xem [team-pack/README.md](team-pack/README.md) để biết cách cài, kiểm tra, build và cấu hình tài khoản Codex.

## Tài liệu BTC

- Team Orchestrator Technical Guide: https://masterthemachine.tech/team-pack/team-orchestrator-technical-guide.html
- Digital Cuder API: https://masterthemachine.tech/team-pack/digital-cuder-api.html
- Repo đề luyện tập: `mtm-fra` (`M0PPU0FA/`, app Solova: Next.js, tRPC, Prisma, PostgreSQL ở port 5433)

## Bảo mật

Không commit credential. Pack chỉ giữ password, bearer và cookie trong RAM của MCP helper. `.env`, `token.json`, `secrets/`, `*.pem`, `*.key` đều đã được gitignore.
