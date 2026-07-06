export type PreviewSurfaceKind =
  | "web"
  | "mobile"
  | "backend"
  | "extension"
  | "shared"
  | "unknown";

export interface PreviewTarget {
  root: string;
  label: string;
  kind: PreviewSurfaceKind;
  changedFiles: string[];
  reason: string;
}

export interface PreviewSurfaceCandidate {
  root: string;
  label: string;
  kind: PreviewSurfaceKind;
  changedFiles: string[];
  score: number;
  reasons: string[];
}

export interface PreviewWorkset {
  changedFiles: string[];
  openFiles: string[];
  featureScope: string[];
  surfaces: PreviewSurfaceCandidate[];
  suggestedTargets: PreviewTarget[];
}
