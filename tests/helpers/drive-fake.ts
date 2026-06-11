import type { drive_v3 } from "googleapis";
import { Readable } from "stream";

export interface FakeDriveFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  contentBytes?: Buffer;
}

export interface DriveFake {
  client: drive_v3.Drive;
  files: ReadonlyMap<string, FakeDriveFile>;
  deleteCallCount: number;
  failNextCreate(err: Error): void;
  failNextDelete(err: Error): void;
  reset(): void;
}

async function collectStream(body: unknown): Promise<Buffer | undefined> {
  if (!body) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return undefined;
}

function parseQ(q: string): { name?: string; parent?: string } {
  const nameMatch = q.match(/name\s*=\s*'([^']*)'/);
  const parentMatch = q.match(/'([^']+)'\s+in\s+parents/);
  return {
    name: nameMatch?.[1],
    parent: parentMatch?.[1],
  };
}

export function createDriveFake(): DriveFake {
  const filesMap = new Map<string, FakeDriveFile>();
  let counter = 0;
  let nextCreateError: Error | undefined;
  let nextDeleteError: Error | undefined;
  let _deleteCallCount = 0;

  const notImplemented = (method: string) => {
    return () => {
      throw new Error(`Drive fake: '${method}' is not implemented`);
    };
  };

  const files = {
    async list(params: { q?: string; fields?: string; spaces?: string }) {
      const { name, parent } = parseQ(params.q ?? "");
      const matches = [...filesMap.values()].filter((f) => {
        if (name !== undefined && f.name !== name) return false;
        if (parent !== undefined && !f.parents.includes(parent)) return false;
        return true;
      });
      return { data: { files: matches.map((f) => ({ id: f.id, name: f.name })) } };
    },

    async create(params: {
      requestBody?: { name?: string; parents?: string[]; mimeType?: string };
      media?: { mimeType?: string; body?: unknown };
      fields?: string;
    }) {
      if (nextCreateError) {
        const err = nextCreateError;
        nextCreateError = undefined;
        throw err;
      }
      const id = `fake-drive-${++counter}`;
      const contentBytes = await collectStream(params.media?.body);
      filesMap.set(id, {
        id,
        name: params.requestBody?.name ?? "",
        parents: params.requestBody?.parents ?? [],
        mimeType:
          params.media?.mimeType ?? params.requestBody?.mimeType ?? "application/octet-stream",
        contentBytes,
      });
      return { data: { id } };
    },

    async delete(params: { fileId?: string }) {
      _deleteCallCount++;
      if (nextDeleteError) {
        const err = nextDeleteError;
        nextDeleteError = undefined;
        throw err;
      }
      if (params.fileId) {
        filesMap.delete(params.fileId);
      }
      return { data: {} };
    },

    async update(params: {
      fileId?: string;
      requestBody?: { name?: string; addParents?: string; removeParents?: string };
      fields?: string;
    }) {
      if (!params.fileId) throw new Error("Drive fake: files.update requires fileId");
      const file = filesMap.get(params.fileId);
      if (!file) {
        const err = new Error(`Drive fake: file not found: ${params.fileId}`);
        (err as unknown as { code: number }).code = 404;
        throw err;
      }
      if (params.requestBody?.name !== undefined) {
        file.name = params.requestBody.name;
      }
      if (params.requestBody?.addParents) {
        file.parents = [
          ...file.parents.filter((p) => p !== params.requestBody?.removeParents),
          params.requestBody.addParents,
        ];
      }
      return { data: { id: params.fileId } };
    },
    get: notImplemented("files.get"),
    copy: notImplemented("files.copy"),
    export: notImplemented("files.export"),
    generateIds: notImplemented("files.generateIds"),
    watch: notImplemented("files.watch"),
    emptyTrash: notImplemented("files.emptyTrash"),
  };

  const client = { files } as unknown as drive_v3.Drive;

  const fake: DriveFake = {
    client,
    get files() {
      return filesMap as ReadonlyMap<string, FakeDriveFile>;
    },
    get deleteCallCount() {
      return _deleteCallCount;
    },
    failNextCreate(err: Error) {
      nextCreateError = err;
    },
    failNextDelete(err: Error) {
      nextDeleteError = err;
    },
    reset() {
      filesMap.clear();
      counter = 0;
      nextCreateError = undefined;
      nextDeleteError = undefined;
      _deleteCallCount = 0;
    },
  };

  return fake;
}
