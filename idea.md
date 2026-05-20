# Bookshelf

## Problem

Managing ebook libraries is tedious. Metadata is often incomplete, files live in scattered directories, notes are disconnected from the books they reference, and getting an epub onto a Kobo device involves multiple manual steps. OS-level file management (folders, search) is the best most readers have today.

## Solution

A desktop application that acts as a personal ebook library manager — handling storage, metadata enrichment, note-taking, and Kobo sync from one place.

## Target user

A reader who collects epub files, takes notes while reading, and reads on a Kobo device. Comfortable with a desktop app; does not need a web interface.

## MVP features

**Library management**
- Import an epub file and automatically organize it into the correct directory on Google Drive
- Extract epub metadata (title, author, cover, ISBN) and fill gaps using web search + AI enrichment
- Tag ebooks with custom labels; browse and filter by tag

**Notes**
- Write and edit notes in Markdown, linked to a specific ebook
- View notes alongside book metadata

**Reading**
- Open an ebook in the system's default epub reader
- Search within an ebook's content

**Kobo sync**
- Convert epub to kepub format
- Upload the converted file to a connected Kobo device

## Planned post-MVP

- Web application (browser-based library access and note-taking)

## Out of scope for MVP

- PDF, MOBI, or other formats
- Sending books to devices via email
- Mobile interface
- Cloud sync beyond Google Drive storage
