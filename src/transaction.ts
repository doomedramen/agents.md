import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

export interface TransactionWrite {
  path: string;
  contents?: Buffer;
  /** Existing hash expected immediately before application. `null` means absent. */
  expectedSha256?: string | null;
}

interface JournalRecord {
  path: string;
  existed: boolean;
  backup: string;
}

interface Journal {
  lockPath: string;
  stageRoot: string;
  records: JournalRecord[];
}

export function sha256(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureNoSymlinkAncestors(path: string, boundary: string): Promise<void> {
  const absolute = resolve(path);
  const boundaryAbsolute = resolve(boundary);
  const relation = relative(boundaryAbsolute, absolute);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error(`Path escapes allowed destination root: ${path}`);
  }
  let current = dirname(absolute);
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink ancestor: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current === boundaryAbsolute || current === parse(current).root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function currentHash(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink target: ${path}`);
    if (!stat.isFile()) throw new Error(`Destination is not a regular file: ${path}`);
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(journal, null, 2) + "\n", "utf8");
}

export async function recoverTransaction(journalPath: string): Promise<void> {
  if (!(await exists(journalPath))) return;
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  } catch (error) {
    throw new Error(`Recovery journal is unreadable: ${journalPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const record of [...journal.records].reverse()) {
    if (record.existed && (await exists(record.backup))) {
      await mkdir(dirname(record.path), { recursive: true });
      await rm(record.path, { force: true });
      await copyFile(record.backup, record.path);
    } else if (!record.existed) {
      await rm(record.path, { force: true });
    }
  }
  await rm(journal.stageRoot, { recursive: true, force: true });
  await rm(journalPath, { force: true });
  await rm(journal.lockPath, { force: true });
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another agents.md operation is already running: ${lockPath}`);
    }
    throw error;
  }
}

export async function applyTransaction(options: {
  writes: TransactionWrite[];
  lockPath: string;
  journalPath: string;
  boundary: string;
  extraBoundaries?: string[];
}): Promise<void> {
  await recoverTransaction(options.journalPath);
  await acquireLock(options.lockPath);
  const boundaries = [options.boundary, ...(options.extraBoundaries ?? [])].map((value) => resolve(value));
  const paths = new Set<string>();
  try {
    for (const write of options.writes) {
      const path = resolve(write.path);
      if (paths.has(path)) throw new Error(`Transaction contains duplicate destination: ${path}`);
      paths.add(path);
      const boundary = boundaries.find((candidate) => {
        const relation = relative(candidate, path);
        return !relation.startsWith("..") && !isAbsolute(relation);
      });
      if (!boundary) throw new Error(`Transaction destination is outside allowed roots: ${path}`);
      await ensureNoSymlinkAncestors(path, boundary);
      const actual = await currentHash(path);
      if (write.expectedSha256 !== undefined && actual !== write.expectedSha256) {
        const expected = write.expectedSha256 === null ? "absent" : write.expectedSha256;
        throw new Error(`Destination changed before apply: ${path} (expected ${expected}, found ${actual ?? "absent"})`);
      }
      if (write.expectedSha256 === undefined && actual !== null && write.contents !== undefined) {
        const planned = sha256(write.contents);
        if (actual !== planned) throw new Error(`Refusing to overwrite unmanaged destination: ${path}`);
      }
    }

    const stageRoot = join(dirname(options.journalPath), `.transaction-${process.pid}-${Date.now()}`);
    await mkdir(stageRoot, { recursive: true });
    const records: JournalRecord[] = [];
    for (let index = 0; index < options.writes.length; index += 1) {
      const write = options.writes[index];
      const path = resolve(write.path);
      const backup = join(stageRoot, "backup", String(index));
      const existed = (await currentHash(path)) !== null;
      if (existed) {
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(path, backup);
      }
      if (write.contents !== undefined) {
        const staged = join(stageRoot, "staged", String(index));
        await mkdir(dirname(staged), { recursive: true });
        await writeFile(staged, write.contents);
      }
      records.push({ path, existed, backup });
    }
    const journal: Journal = { lockPath: options.lockPath, stageRoot, records };
    await writeJournal(options.journalPath, journal);

    try {
      for (let index = 0; index < options.writes.length; index += 1) {
        const write = options.writes[index];
        const path = resolve(write.path);
        await mkdir(dirname(path), { recursive: true });
        await ensureNoSymlinkAncestors(path, boundaries.find((candidate) => {
          const relation = relative(candidate, path);
          return !relation.startsWith("..") && !isAbsolute(relation);
        }) ?? options.boundary);
        await rm(path, { force: true });
        if (write.contents !== undefined) {
          await renameOrCopy(join(stageRoot, "staged", String(index)), path);
        }
      }
      await rm(options.journalPath, { force: true });
      await rm(stageRoot, { recursive: true, force: true });
    } catch (error) {
      await recoverTransaction(options.journalPath);
      throw error;
    }
  } finally {
    await rm(options.lockPath, { force: true });
  }
}

async function renameOrCopy(source: string, destination: string): Promise<void> {
  try {
    await renameFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(source, destination);
    await rm(source, { force: true });
  }
}

async function renameFile(source: string, destination: string): Promise<void> {
  const { rename } = await import("node:fs/promises");
  await rename(source, destination);
}
