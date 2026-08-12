# Task attachment HTTP surface

Attachment upload uses a raw request body at
`POST /api/v1/plugins/tasks/http/attachments/upload`. Raw bytes are the
simplest supported format, but local-auth non-GET plugin routes require JSON,
so upload uses plugin-token auth. Pass the token in `x-bb-plugin-token` (or the
`token` query parameter).

Upload metadata may use query parameters (`taskId` or `commentId`, `fileName`,
and `mime`) or the corresponding `x-task-id`, `x-comment-id`, `x-file-name`,
and `x-mime-type` headers. Exactly one owner is required. The response is
`{ attachmentId, url }`.

The returned local-auth frontend URL is
`GET /api/v1/plugins/tasks/http/attachments/download?attachmentId=...`.
Deletion is
`DELETE /api/v1/plugins/tasks/http/attachments/delete?attachmentId=...` and,
because it is a local-auth non-GET request, must use `Content-Type:
application/json`.
