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

export interface PackageManifestV1 {
  schema: 1;
  name: string;
  description: string;
  canonical?: { source: string };
  files: PackageFile[];
}

export interface FragmentDeclaration {
  id: string;
  source: string;
  title: string;
}

export interface PackageManifestV2 {
  schema: 2;
  name: string;
  description: string;
  fragments: FragmentDeclaration[];
}

export type PackageManifest = PackageManifestV1 | PackageManifestV2;

export interface PackMemberDeclaration {
  id: string;
  source: string;
  ref?: string;
}

export interface PackOutputDeclaration {
  directory: string;
  use: string[];
  exclude: string[];
}

export interface PackManifest {
  version: 2;
  kind: "pack";
  name: string;
  packages: PackMemberDeclaration[];
  outputs: PackOutputDeclaration[];
}

export type SourceKind = "package" | "pack";

export interface SourceDescriptor {
  type: "git";
  /** Canonical repository URL or explicit local repository path. */
  url: string;
  /** POSIX path inside repository. `.` means repository root. */
  path: string;
}

export interface ResolvedPackage {
  root: string;
  source: SourceDescriptor;
  commit: string;
  manifest: PackageManifestV1;
  manifestBytes: Buffer;
  cleanup?: () => Promise<void>;
}

export interface ResolvedV2Source {
  root: string;
  repositoryRoot: string;
  source: SourceDescriptor;
  commit: string;
  requestedRef?: string;
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

export interface V2PackageSelection {
  id: string;
  source: string;
  ref?: string;
  compatibility?: "v1-canonical";
}

export interface V2PackSelection {
  id: string;
  source: string;
  ref?: string;
  directory: string;
  omitOutputs: string[];
}

export interface V2OutputConfig {
  directory: string;
  use: string[];
  exclude: string[];
  local: string[];
  adapters?: string[];
}

export interface ConsumerConfigV2 {
  version: 2;
  packages: V2PackageSelection[];
  packs: V2PackSelection[];
  outputs: V2OutputConfig[];
  agents?: string[];
}

export interface V2FragmentLock {
  id: string;
  source: string;
  title: string;
  sha256: string;
}

export interface V2PackageLock {
  id: string;
  source: SourceDescriptor;
  requestedRef: string | null;
  commit: string;
  manifestSha256: string;
  fragments: V2FragmentLock[];
  compatibility?: "v1-canonical";
}

export interface V2PackMemberLock {
  id: string;
  source: SourceDescriptor;
  requestedRef: string | null;
  commit: string;
  manifestSha256: string;
  fragments: V2FragmentLock[];
  recipeSource: string;
  recipeCommit: string;
  recipePath: string;
}

export interface V2PackOutputLock {
  directory: string;
  use: string[];
  exclude: string[];
}

export interface V2PackLock {
  id: string;
  directory: string;
  source: SourceDescriptor;
  requestedRef: string | null;
  commit: string;
  manifestSha256: string;
  recipeHash: string;
  members: V2PackMemberLock[];
  outputs: V2PackOutputLock[];
  omitOutputs: string[];
}

export interface V2GeneratedFileLock {
  sha256: string;
  owners: string[];
  kind: "agents" | "adapter";
}

export interface V2OutputLock {
  directory: string;
  use: string[];
  exclude: string[];
  local: string[];
  generated: string[];
  introducedBy?: string;
}

export interface V2LockFile {
  version: 2;
  rendererVersion: string;
  configSha256: string;
  selectionSha256?: string;
  packages: Record<string, V2PackageLock>;
  packs: Record<string, V2PackLock>;
  localFiles: Record<string, string>;
  generatedFiles: Record<string, V2GeneratedFileLock>;
  ownership: Record<string, string[]>;
  outputs: Record<string, V2OutputLock>;
}

export interface FragmentProvenance {
  identity: string;
  label: string;
  alias: string;
  fragmentId: string;
  title: string;
  source: SourceDescriptor;
  commit: string;
  body: Buffer;
}

export interface LocalFragment {
  path: string;
  body: Buffer;
}

export interface ComposeOutputInput {
  directory: string;
  fragments: FragmentProvenance[];
  local: LocalFragment[];
}

export interface ComposedOutput {
  directory: string;
  body: Buffer;
  fragmentOwners: string[];
}

export interface ComposeResult {
  outputs: ComposedOutput[];
  diagnostics: string[];
}

export interface PlannedFile {
  path: string;
  contents?: Buffer;
  kind: "managed" | "config" | "lock" | "local" | "backup";
}

export interface DetectionEvidence {
  technology: string;
  path: string;
  field: string;
  value: string;
}
