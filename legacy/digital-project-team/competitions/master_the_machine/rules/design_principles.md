# Design Principles — Phase 0 Deliverable 8

> Nguyên tắc thiết kế cho toàn bộ Digital Project Team OS.
> Mọi quyết định kiến trúc phải tuân theo các nguyên tắc này.

## 1. EV-first (Expected Value)

- Mọi quyết định phân bổ tài nguyên dựa trên `EV = score × success_rate × deadline_factor`.
- Không tối ưu số task hoàn thành — tối ưu tổng điểm match.
- Một submission đúng > hai task dở dang.

## 2. Reliability > Brilliance

- Hệ thống phải chạy được 40 phút liên tục không cần người.
- Agent chết phải được hồi sinh. Workflow treo phải được phát hiện.
- Code "đủ tốt và đúng" luôn thắng code "thông minh và rủi ro".

## 3. Separation of Concerns

- `core/` không phụ thuộc OpenHands — competition brain tách khỏi coding engine.
- `integrations/competition_platform/` là nơi duy nhất biết API cuộc thi.
- Agent không gọi API trực tiếp — chỉ qua service layer.
- Prompt không lẫn với code — tất cả prompt ở `prompts/`.

## 4. Single Source of Truth

- Mọi agent đọc cùng một Match State (blackboard).
- Không agent nào giữ trạng thái riêng của mình.
- Mọi sự kiện đi qua Event Bus — không gọi ngang hàng.

## 5. MVS là Minimum, không phải Đích

- Hidden grader tồn tại và có regression tests.
- Coverage phải ≥ 90% với happy path, boundary, negative, regression, permission.
- Test vượt MVS là bắt buộc trước mọi submission.

## 6. Submission là Bất Khả Hồi

- Không agent nào được submit trực tiếp.
- Chỉ Submission Authority có quyền submit, sau khi pass đủ gate.
- Sai sót ở cửa cuối đắt hơn mọi thứ — kiểm tra chậm 1 phút còn hơn fail.

## 7. Autonomy First

- Mục tiêu: 0 lần human intervention (-50 điểm / lần).
- Không hỏi người ngoài trừ khi hệ thống không thể tự quyết định.
- Mọi quyết định phải có lý do ghi lại trong decision memory.

## 8. Observability từ Ngày 1

- Agent dead, workflow stuck, submission pending, deadline risk phải nhìn thấy được.
- Log mọi thứ: quyết định, lý do, kết quả, evidence.
- Không có log = không có chuyện gì xảy ra.

## 9. Tách Cuộc Thi Khỏi Nền Tảng

- `competitions/master_the_machine/` chứa mọi thứ đặc thù cuộc thi.
- `core/`, `agents/`, `services/` tái sử dụng được cho Jira, GitHub Issues, Azure DevOps.
- Khi BTC đổi luật, chỉ sửa trong `competitions/` và `integrations/competition_platform/`.

## 10. Test Local Trước, Thi Thật Sau

- Mọi thứ phải chạy được trên simulator trước khi chạy match thật.
- Không bao giờ thử nghiệm trên cuộc thi thật.