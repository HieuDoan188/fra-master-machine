# Competition Assumptions — Phase 0 Deliverable 9

> Danh sách giả định về cuộc thi Master The Machine.
> Mỗi giả định phải được xác nhận lại khi có thông tin mới từ BTC.
> Nếu giả định sai → sửa tại đây trước, rồi mới sửa code.

## A. Về trận đấu

| ID | Giả định | Nguồn | Trạng thái |
|----|----------|-------|------------|
| ASSUM-001 | Trận đấu kéo dài 40 phút | match_rules.yaml | Chưa xác nhận |
| ASSUM-002 | Hệ thống vận hành tự động hoàn toàn | match_rules.yaml | Chưa xác nhận |
| ASSUM-003 | Đồng hồ tính theo server_time, không phải local | match_rules.yaml | Chưa xác nhận |
| ASSUM-004 | Nguồn sự thật cuối cùng là game master | match_rules.yaml | Chưa xác nhận |

## B. Về item

| ID | Giả định | Nguồn | Trạng thái |
|----|----------|-------|------------|
| ASSUM-010 | Item phải Start Working trước khi submit | match_rules.yaml | Chưa xác nhận |
| ASSUM-011 | Không submit được trước khi Start Working | match_rules.yaml | Chưa xác nhận |
| ASSUM-012 | Mỗi item chỉ được submit tối đa 1 lần | match_rules.yaml | Chưa xác nhận |
| ASSUM-013 | Không resubmit sau khi đã accepted | match_rules.yaml | Chưa xác nhận |
| ASSUM-014 | Item đã đóng deadline không submit được nữa | match_rules.yaml | Chưa xác nhận |
| ASSUM-015 | Có 4 loại item: TASK, CR, BUG, PI | backlog_types.yaml | Chưa xác nhận |
| ASSUM-016 | BUG và CR có MVS; TASK không có MVS; PI chưa rõ | backlog_types.yaml | Chưa xác nhận |

## C. Về chấm điểm

| ID | Giả định | Nguồn | Trạng thái |
|----|----------|-------|------------|
| ASSUM-020 | MVS là bắt buộc để pass | match_rules.yaml | Chưa xác nhận |
| ASSUM-021 | Grader có hidden tests ngoài MVS | match_rules.yaml | Chưa xác nhận |
| ASSUM-022 | Nên test vượt qua MVS | match_rules.yaml | Chưa xác nhận |
| ASSUM-023 | PI tính điểm theo thứ tự: first=100, second=90, third=75, others=60, failed=0 | match_rules.yaml | Chưa xác nhận |
| ASSUM-024 | Human intervention bị phạt -50 điểm / lần | match_rules.yaml | Chưa xác nhận |

## D. Về môi trường

| ID | Giả định | Nguồn | Trạng thái |
|----|----------|-------|------------|
| ASSUM-030 | Có quyền truy cập shell, git, browser trong môi trường thi | Kiến trúc đề xuất | Chưa xác nhận |
| ASSUM-031 | Repo target có thể build và chạy test trong sandbox | Kiến trúc đề xuất | Chưa xác nhận |
| ASSUM-032 | API cuộc thi có endpoint: items, scoreboard, start_working, submit | Kiến trúc đề xuất | Chưa xác nhận |
| ASSUM-033 | Mỗi đội có thể chạy nhiều agent song song | Kiến trúc đề xuất | Chưa xác nhận |

## E. Quy trình xác nhận

1. Khi có tài liệu chính thức từ BTC → đối chiếu từng giả định, đổi trạng thái thành "Xác nhận" hoặc "Sai".
2. Giả định sai → cập nhật file trong `rules/` TRƯỚC, rồi lan truyền xuống code.
3. Giả định chưa xác nhận → thiết kế theo hướng an toàn nhất (fail-safe).