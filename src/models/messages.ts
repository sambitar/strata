import type { PublishPlan, PublishResult } from "../models/workspace";
import type { StackFieldKey } from "../models/stack";

export type DashboardMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | {
      type: "state";
      payload: {
        name: string;
        environment: string;
        environmentLabel: string;
        environmentIcon: string;
        currentGoal: string;
        featureName: string | null;
        featureBranch: string | null;
        featureScope: string[];
        gitBranch: string;
        gitAhead: number;
        gitBehind: number;
        gitClean: boolean;
        changesFiles: number;
        aiLastActive: string;
        memoryFiles: string[];
        githubConnected: boolean;
        githubRepo: string | null;
        githubRemoteUrl: string | null;
        githubGhAvailable: boolean;
        githubGhAuthenticated: boolean;
        githubPrUrl: string | null;
        githubPrNumber: number | null;
        githubPrState: string | null;
        githubChecksState: string;
        githubChecksSummary: string;
        featurePrUrl: string | null;
        featureLastSyncedAt: string | null;
        branches: Array<{
          name: string;
          isCurrent: boolean;
          isRemote: boolean;
          isProtected: boolean;
        }>;
        activeWorkBranch: string | null;
        safetyWarning: string | null;
        trunkLocked: boolean;
        workHistory: Array<{
          name: string;
          branch: string;
          sourceBranch: string | null;
          status: string;
          prUrl: string | null;
        }>;
        activeRefresh: {
          title: string;
          phase: number;
          startedAt: string;
        } | null;
        activeRetro: {
          startedAt: string;
        } | null;
        activePreview: {
          focus: string;
          startedAt: string;
          targets: Array<{
            root: string;
            label: string;
            kind: string;
            fileCount: number;
          }>;
        } | null;
        activeCrew: {
          goal: string;
          phase: string;
          startedAt: string;
          lanes: Array<{
            id: string;
            title: string;
            role: string;
            root: string;
            status: string;
          }>;
        } | null;
        stack: Partial<Record<StackFieldKey, string | null>>;
        stackFields: Array<{
          key: StackFieldKey;
          label: string;
          placeholder: string;
          options: string[];
        }>;
        stackDetectionSources: string[];
        stackDetectedFromProject: boolean;
        stackAutoSaved: boolean;
        stackFieldSources: Partial<Record<StackFieldKey, "saved" | "detected">>;
        structure: {
          status: "draft" | "locked" | "none";
          layout: string;
          lockedAt: string | null;
          detectedAt: string | null;
          sources: string[];
          services: Array<{
            id: string;
            name: string;
            root: string;
            kind: string;
            expectedPaths: string[];
            conventions: string[];
            libraries: string[];
          }>;
          ciPaths: string[];
          notes: string;
          validationOk: boolean;
          validationSummary: string;
          drift: Array<{
            path: string;
            issue: string;
            message: string;
          }>;
          autoSaved: boolean;
        };
      };
    }
  | { type: "saveStack"; stack: Partial<Record<StackFieldKey, string>> }
  | { type: "detectStack"; overwrite?: boolean }
  | { type: "detectStructure"; overwrite?: boolean }
  | { type: "lockStructure" }
  | { type: "unlockStructure" }
  | { type: "testInDevMode" }
  | { type: "archivePreview" }
  | { type: "startMultiAgentCrew" }
  | { type: "archiveCrew" }
  | { type: "copyCrewLanePrompt"; laneId: string }
  | { type: "setCrewLaneStatus"; laneId: string; status: string }
  | { type: "copyCrewIntegratorPrompt" }
  | { type: "syncRules" }
  | { type: "newRefresh" }
  | { type: "archiveRefresh" }
  | { type: "runRetro" }
  | { type: "archiveRetro" }
  | { type: "resumeWork"; branch?: string }
  | { type: "archiveWork" }
  | { type: "openMemory"; file: string }
  | { type: "continueWork" }
  | { type: "openAiChat" }
  | { type: "publish" }
  | { type: "createFeature" }
  | { type: "connectRepo" }
  | {
      type: "startWorkFromBranch";
      sourceBranch: string;
      isRemote: boolean;
      remote: string;
    };

export type PublishWizardMessage =
  | { type: "ready" }
  | { type: "init"; payload: PublishPlan }
  | {
      type: "state";
      payload: {
        step: number;
        isClean: boolean;
        branch: string;
        remote: string;
        trunk: string;
        message: string;
        files: number;
        insertions: number;
        deletions: number;
        loading: boolean;
        error: string | null;
        result: PublishResult | null;
        createPr: boolean;
        sourceBranch: string | null;
        safeToPush: boolean;
        safetyMessage: string | null;
        remoteBranchExists: boolean;
      };
    }
  | { type: "setCreatePr"; createPr: boolean }
  | { type: "setMessage"; message: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "push" }
  | { type: "close" };
