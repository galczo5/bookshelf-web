import { describe, it, expect } from "vitest";
import { composeFilename, sanitizeOriginalFilename } from "@/lib/drive/upload";

describe("composeFilename", () => {
  it("author + title only → Author - Title.epub", () => {
    expect(
      composeFilename({ author: "Frank Herbert", series: null, part: null, title: "Dune" })
    ).toBe("Frank Herbert - Dune.epub");
  });

  it("series only (no part) → Author - Series - Title.epub", () => {
    expect(
      composeFilename({ author: "Frank Herbert", series: "Dune Saga", part: null, title: "Dune" })
    ).toBe("Frank Herbert - Dune Saga - Dune.epub");
  });

  it("part only (no series) → Author - Part - Title.epub", () => {
    expect(
      composeFilename({ author: "Frank Herbert", series: null, part: "2", title: "Dune Messiah" })
    ).toBe("Frank Herbert - 2 - Dune Messiah.epub");
  });

  it("author + series + part + title → Author - Series - Part - Title.epub", () => {
    expect(
      composeFilename({
        author: "Frank Herbert",
        series: "Dune Saga",
        part: "2",
        title: "Dune Messiah",
      })
    ).toBe("Frank Herbert - Dune Saga - 2 - Dune Messiah.epub");
  });

  it("null author falls back to 'unknown'", () => {
    expect(composeFilename({ author: null, series: null, part: null, title: "Unknown Book" })).toBe(
      "unknown - Unknown Book.epub"
    );
  });

  it("empty string author falls back to 'unknown'", () => {
    expect(composeFilename({ author: "", series: null, part: null, title: "Some Title" })).toBe(
      "unknown - Some Title.epub"
    );
  });

  it("sanitizes illegal characters in all fields", () => {
    expect(
      composeFilename({
        author: "A/B\\C",
        series: "Se*ries",
        part: "1:2",
        title: "Ti?tle",
      })
    ).toBe("A_B_C - Se_ries - 1_2 - Ti_tle.epub");
  });

  it("empty string series is omitted", () => {
    expect(composeFilename({ author: "Author", series: "  ", part: null, title: "Title" })).toBe(
      "Author - Title.epub"
    );
  });

  it("empty string part is omitted", () => {
    expect(composeFilename({ author: "Author", series: null, part: "", title: "Title" })).toBe(
      "Author - Title.epub"
    );
  });
});

describe("sanitizeOriginalFilename", () => {
  it("preserves .epub extension and sanitizes base", () => {
    expect(sanitizeOriginalFilename("my book file.epub")).toBe("my book file.epub");
  });

  it("strips illegal characters from base", () => {
    expect(sanitizeOriginalFilename("my/book:file.epub")).toBe("my_book_file.epub");
  });

  it("handles missing extension by appending .epub", () => {
    expect(sanitizeOriginalFilename("somefile")).toBe("somefile.epub");
  });

  it("handles mixed-case .EPUB extension", () => {
    expect(sanitizeOriginalFilename("SomeBook.EPUB")).toBe("SomeBook.epub");
  });

  it("handles mixed-case .Epub extension", () => {
    expect(sanitizeOriginalFilename("Title.Epub")).toBe("Title.epub");
  });
});
