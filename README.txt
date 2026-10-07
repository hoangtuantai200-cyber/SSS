VHG - Vẽ Hình Đoán Chữ

Chạy:
  npm install
  node server.js

Dữ liệu tài khoản nằm trong people.json.
- Tài khoản đã đăng ký không tự mất.
- Server không reset people.json.
- Nếu people.json bị lỗi, server dừng thay vì ghi đè để tránh mất tài khoản.
- Đăng ký tài khoản trùng tên sẽ bị từ chối (không phân biệt hoa/thường).
- Tên và mật khẩu không giới hạn độ dài/ký tự, chỉ không được để trống.
- Điểm của tài khoản được cập nhật vào đúng tài khoản.
- people.json.bak được tạo khi server ghi dữ liệu để có bản dự phòng.
