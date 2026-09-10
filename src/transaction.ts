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

const activeLocks = new Set<string>();

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
  let boundaryExists = false;
  try {
    if ((await lstat(boundaryAbsolute)).isSymbolicLink()) throw new Error(`Refusing symlink ancestor: ${boundaryAbsolute} for ${path}`);
    boundaryExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let current = dirname(absolute);
  while (true) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink ancestor: ${current} for ${path} (boundary ${boundaryAbsolute})`);
      if (current === boundaryAbsolute || (!boundaryExists && !relative(current, boundaryAbsolute).startsWith("..") && !isAbsolute(relative(current, boundaryAbsolute)))) break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current === parse(current).root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function assertNoSymlinkPath(path: string, boundary: string): Promise<void> {
  await ensureNoSymlinkAncestors(path, boundary);
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

function assertExpectedHash(write: TransactionWrite, actual: string | null): void {
  if (write.expectedSha256 !== undefined && actual !== write.expectedSha256) {
    const expected = write.expectedSha256 === null ? "absent" : write.expectedSha256;
    throw new Error(`Destination changed before apply: ${write.path} (expected ${expected}, found ${actual ?? "absent"})`);
  }
  if (write.expectedSha256 === undefined && actual !== null && write.contents !== undefined) {
    const planned = sha256(write.contents);
    if (actual !== planned) throw new Error(`Refusing to overwrite unmanaged destination: ${write.path}`);
  }
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symlink recovery journal: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, JSON.stringify(journal, null, 2) + "\n", "utf8");
}

export async function recoverTransaction(journalPath: string): Promise<void> {
  let journalStat;
  try {
    journalStat = await lstat(journalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (journalStat.isSymbolicLink()) throw new Error(`Refusing symlink recovery journal: ${journalPath}`);
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  } catch (error) {
    throw new Error(`Recovery journal is unreadable: ${journalPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (await exists(journal.lockPath)) {
    if (activeLocks.has(journal.lockPath)) throw new Error(`Another agents.md operation is already running: ${journal.lockPath}`);
    try {
      const pid = Number.parseInt((await readFile(journal.lockPath, "utf8")).trim(), 10);
      if (Number.isInteger(pid) && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          throw new Error(`Another agents.md operation is already running: ${journal.lockPath}`);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("Another agents.md operation")) throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Another agents.md operation")) throw error;
    }
    await rm(journal.lockPath, { force: true });
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
  if (activeLocks.has(lockPath)) throw new Error(`Another agents.md operation is already running: ${lockPath}`);
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.close();
    activeLocks.add(lockPath);
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
  const boundaries = [options.boundary, ...(options.extraBoundaries ?? [])].map((value) => resolve(value));
  for (const statePath of [options.journalPath, options.lockPath]) {
    const stateBoundary = boundaries.find((candidate) => {
      const relation = relative(candidate, resolve(statePath));
      return !relation.startsWith("..") && !isAbsolute(relation);
    });
    if (!stateBoundary) throw new Error(`Transaction state path is outside allowed roots: ${statePath}`);
    await ensureNoSymlinkAncestors(statePath, stateBoundary);
  }
  await recoverTransaction(options.journalPath);
  await acquireLock(options.lockPath);
  try {
    await validateTransaction({ ...options, boundaries });

    const stageRoot = join(dirname(options.journalPath), `.transaction-${process.pid}-${Date.now()}`);
    try {
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
    } catch (error) {
      await rm(stageRoot, { recursive: true, force: true });
      await rm(options.journalPath, { force: true });
      throw error;
    }

    try {
      for (let index = 0; index < options.writes.length; index += 1) {
        const write = options.writes[index];
        const path = resolve(write.path);
        const actual = await currentHash(path);
        assertExpectedHash({ ...write, path }, actual);
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
    activeLocks.delete(options.lockPath);
    await rm(options.lockPath, { force: true });
  }
}

async function validateTransaction(options: {
  writes: TransactionWrite[];
  boundary: string;
  extraBoundaries?: string[];
  boundaries?: string[];
}): Promise<void> {
  const boundaries = options.boundaries ?? [options.boundary, ...(options.extraBoundaries ?? [])].map((value) => resolve(value));
  const paths = new Set<string>();
  for (const write of options.writes) {
    const path = resolve(write.path);
    const caseKey = path.toLowerCase();
    if (paths.has(caseKey)) throw new Error(`Transaction contains duplicate destination: ${path}`);
    paths.add(caseKey);
    const boundary = boundaries.find((candidate) => {
      const relation = relative(candidate, path);
      return !relation.startsWith("..") && !isAbsolute(relation);
    });
    if (!boundary) throw new Error(`Transaction destination is outside allowed roots: ${path}`);
    await ensureNoSymlinkAncestors(path, boundary);
    const actual = await currentHash(path);
    assertExpectedHash({ ...write, path }, actual);
  }
}

export async function validateTransactionPlan(options: {
  writes: TransactionWrite[];
  boundary: string;
  extraBoundaries?: string[];
}): Promise<void> {
  await validateTransaction(options);
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
