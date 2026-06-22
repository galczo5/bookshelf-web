---
change_id: db-backup
title: Daily DB backup to Google Drive with in-app restore
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

I want to introduce a backup feature. In settings there should be a section about every day (if there were any changes to db) db backup. It should dump library data, but no user or secrets, to text file, and keep these files in google drive. User should be able to restore db by selecting a backup file
