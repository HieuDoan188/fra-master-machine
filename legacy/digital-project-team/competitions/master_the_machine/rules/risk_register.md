# Risk Register — Phase 0 Deliverable 7

> Mọi rủi ro phải có mitigation. Nếu không thể mitigate, phải có early warning.

## Rủi ro chiến lược

| ID | Rủi ro | Ảnh hưởng | Xác suất | Mitigation |
|----|--------|-----------|----------|------------|
| RISK-001 | Hiểu sai luật thi | Mất toàn bộ điểm | Thấp | Phase 0 hoàn chỉnh, simulator giả lập đúng rule |
| RISK-002 | Bỏ lỡ Start Working | Mất quyền truy cập MVS | Trung bình | Observer + Start Working Agent tự động, watchdog |
| RISK-003 | Bỏ lỡ deadline | Item bị đóng, mất điểm | Cao | Deadline monitor cảnh báo < 5 phút, planner ưu tiên EV |
| RISK-004 | Product Incident không xử lý kịp | Mất 100 điểm + ảnh hưởng hệ thống | Cao | PI override mọi thứ, PI Squad riêng, MTTR tối thiểu |
| RISK-005 | Human intervention | -50 điểm / lần | Trung bình | Autonomy-first, không hỏi người ngoài trừ khi bắt buộc |

## Rủi ro kỹ thuật

| ID | Rủi ro | Ảnh hưởng | Xác suất | Mitigation |
|----|--------|-----------|----------|------------|
| RISK-010 | Agent chết / process treo | Workflow dừng, deadline miss | Cao | Watchdog, restart, checkpointing |
| RISK-011 | Token hết giữa task | Submission dở dang | Trung bình | Token budget per task, compression, model routing |
| RISK-012 | Hidden test fail sau khi submit | 0 điểm item | Cao | Coverage ≥ 90%, test vượt MVS |
| RISK-013 | Submit sai lúc (trước khi ready) | Item fail | Trung bình | Submission Authority gate |
| RISK-014 | Repo không build/test được | Không verify được | Trung bình | Repo scanner Phase 3, sandbox chuẩn |
| RISK-015 | API cuộc thi đổi | Toàn bộ match flow hỏng | Thấp | Abstraction layer `integrations/competition_platform/` |

## Rủi ro vận hành

| ID | Rủi ro | Ảnh hưởng | Xác suất | Mitigation |
|----|--------|-----------|----------|------------|
| RISK-020 | Network / server_time lệch | Deadline tính sai | Thấp | Clock = server_time, không dùng clock local |
| RISK-021 | Nhiều agent sửa cùng file | Conflict, mất work | Trung bình | Scheduler lock, mỗi item 1 squad |
| RISK-022 | Evidence thiếu khi cần dispute | Mất điểm tranh chấp | Thấp | Evidence generator tự động lưu mọi thứ |

## Quy tắc xử lý rủi ro

1. Rủi ro nghiêm trọng (mất > 50 điểm) → escalate lên Director ngay.
2. Mọi quyết định ứng phó phải ưu tiên: containment → recovery → verification.
3. Sau mỗi match: review risk register, cập nhật xác suất thực tế.