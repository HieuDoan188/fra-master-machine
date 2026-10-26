# Phase 0 Architecture — Phase 0 Deliverable 10

> Kiến trúc tham chiếu của Digital Project Team OS.
> Đây là kiến trúc đích — mỗi phase triển khai sẽ hiện thực hóa một phần.

## 1. Kiến trúc tổng thể

```
                    ┌─────────────────────┐
                    │   Competition API   │
                    │   (game master)     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Match Observer     │  ← agent đầu tiên phải build
                    │  (poll + detect)    │
                    └──────────┬──────────┘
                               │ events
                               ▼
                    ┌─────────────────────┐
                    │    Event Bus        │
                    │  (ITEM_VISIBLE,     │
                    │   PI_CREATED, ...)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
     │  Match State │  │   Planner    │  │  Director    │
     │  (blackboard)│  │  (EV engine) │  │ (allocate)   │
     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              │ assignment
                              ▼
     ┌──────────────────────────────────────────────┐
     │              SDLC Squads                     │
     │  Task Squad │ Bug Squad │ CR Squad │ PI Squad │
     └──────────────────────┬───────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────┐
     │           OpenHands Adapter                  │
     │  (integrations/openhands/)                   │
     └──────────────────────┬───────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────┐
     │           OpenHands Runtime                  │
     │  (coding engine: shell, git, browser, repo)  │
     └──────────────────────┬───────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────┐
     │         Verification Layer                   │
     │  MVS Runner → Coverage → Review → Evidence   │
     └──────────────────────┬───────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────┐
     │         Submission Authority                 │
     │  (final gate — only one allowed to submit)   │
     └──────────────────────────────────────────────┘

     ──────────────────────────────────────────────
     Cross-cutting: Memory (vector/graph/incident/
     decision/task/match) + Observability (metrics,
     health, alerts) + Knowledge (architecture,
     call graphs, api catalog)
```

## 2. Data flow chính

### 2.1 Item mới xuất hiện

```
Observer poll → phát hiện BUG-03 → EventBus.emit(ITEM_VISIBLE)
  → MatchState.update(items)
  → Planner nhận event → tính EV → chọn squad
  → Director allocate → squad Start Working
```

### 2.2 Product Incident

```
Observer phát hiện PI → EventBus.emit(PI_CREATED)
  → Planner: PI override mọi thứ (priority 100)
  → PI Squad: commander → investigator → root_cause → validator
  → Fix → Verification → Submission Authority
```

### 2.3 Deadline risk

```
DeadlineMonitor: deadline < 5m → EventBus.emit(DEADLINE_WARNING)
  → Planner re-evaluate portfolio → ưu tiên item sắp hết hạn
```

## 3. Layer & trách nhiệm

| Layer | Trách nhiệm | Cấm làm |
|-------|-------------|---------|
| Observer | Poll API, phát hiện thay đổi, emit event | Quyết định, viết code |
| Director | Phân bổ tài nguyên, ưu tiên, escalate | Viết code, viết test |
| Planner | Tính EV, chọn item, lên portfolio | Viết code |
| Squads | Thực thi SDLC theo workflow | Tự ý đổi ưu tiên |
| OpenHands Adapter | Gọi coding engine | Biết luật cuộc thi |
| Verification | Chạy MVS, coverage, review | Submit |
| Submission Authority | Gate cuối, submit | Sửa code |

## 4. Nguyên tắc kết nối

1. Agent → Service (business logic) → Integration (external).
2. Agent không gọi agent trực tiếp — qua Event Bus.
3. Agent không giữ state — mọi state ở Match State / Memory.
4. Mọi thay đổi trạng thái đi qua State Machine.
5. Competition API chỉ được gọi qua `integrations/competition_platform/`.

## 5. Exit criteria Phase 0

- [x] Rule Engine Documented (match_rules.yaml)
- [x] Backlog Types Defined (backlog_types.yaml)
- [x] State Machine Defined (lifecycle_state_machine.yaml)
- [x] Event Catalog Defined (event_catalog.yaml)
- [x] Score Framework Defined (scoring_framework.yaml)
- [x] Hidden Test Strategy Defined (hidden_test_strategy.yaml)
- [x] Risk Register Defined (risk_register.md)
- [x] Design Principles Defined (design_principles.md)
- [x] Competition Assumptions Defined (competition_assumptions.md)
- [x] Architecture Defined (phase0_architecture.md)

→ Đủ điều kiện sang Phase 1 (Foundation: fork OpenHands + adapter).