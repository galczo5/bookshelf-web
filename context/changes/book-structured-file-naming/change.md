---
change_id: book-structured-file-naming
title: Dual-copy import with structured file naming and series/part metadata
status: implemented
created: 2026-06-11
updated: 2026-06-11

archived_at: null
---

## Notes

When I import a book it should be saved in two places:

- As it is now
- In "Original files" directory in Bookshelf directory

Reason for this change is that I want the app to rename non "Original files" file copy. The file name must always be: "<Author> - <Series?> - <Part?> - <Title>.epub"

Change should introduce dir structure, series and part metadata fields and automatic file rename when any of the fields has changed
