import { readFileSync } from "fs";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dirname, "../fixtures");

export function loadFixtureEpub(name = "minimal"): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, `${name}.epub`));
}
