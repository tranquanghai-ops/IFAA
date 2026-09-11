# Chuyển Firestore sang IFA-Activities

Công cụ sao chép toàn bộ collection, document và subcollection từ `ifahr-faf5d`
sang `ifa-activities`. Có thể chạy lại để cập nhật các tài liệu phát sinh trước lúc
chuyển chính thức. Công cụ không xóa hoặc thay đổi dữ liệu nguồn.

## Chạy trong Google Cloud Shell

```bash
git checkout firebase-migration
npm install
gcloud auth application-default login
npm run migrate:check
npm run migrate:firestore
```

Nếu Cloud Shell đã có Application Default Credentials hợp lệ thì có thể bỏ qua lệnh
`gcloud auth application-default login`.
