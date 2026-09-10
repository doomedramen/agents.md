export type Scope = "project" | "global";

export type TargetMode = "direct" | "import" | "copy";

export interface PackageTarget {
  scope: Scope;
  agent?: string;
  path: string;
  mode: TargetMode;
  import?: string;
}

export interface PackageFile {
  source: string;
  targets: PackageTarget[];
}

export interface PackageManifest {
  schema: 1;
  name: string;
  description: string;
  canonical?: { source: string };
  files: PackageFile[];
}

export interface SourceDescriptor {
  type: "git";
  url: string;
  path: string;
}

export interface ResolvedPackage {
  root: string;
  source: SourceDescriptor;
  commit: string;
  manifest: PackageManifest;
  manifestBytes: Buffer;
  cleanup?: () => Promise<void>;
}

export interface PackageReference {
  id: string;
  source: SourceDescriptor;
  selector: string;
}

export interface StateFile {
  version: 1;
  indexes?: string[];
  packages: PackageReference[];
}

export interface LockTarget {
  scope: Scope;
  agent?: string;
  path: string;
  mode: TargetMode;
  import?: string;
  sha256: string;
}

export interface LockPackage {
  scope: Scope;
  source: SourceDescriptor;
  requested: string;
  commit: string;
  manifestSha256: string;
  files: LockTarget[];
}

export interface LockFile {
  version: 1;
  packages: Record<string, LockPackage>;
}
