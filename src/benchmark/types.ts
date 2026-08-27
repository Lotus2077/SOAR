export type BenchmarkTrack = "research" | "coding";

export interface WorkloadManifest {
  id: string;
  track: BenchmarkTrack;
  source: {
    dataset: string;
    recordId: string;
    url: string;
    revision: string;
    provenanceUrl?: string;
  };
  task: {
    delivery: string;
    fixture: string;
  };
  evaluator: {
    kind:
      | "exact-answer"
      | "deterministic-tests"
      | "citation-and-rubric"
      | "benchmark-harness";
    commandOrProtocol: string;
  };
  tags: string[];
  notes?: string;
}

export interface SourceArtifact {
  path: string;
  url: string;
  sha256: string;
}

export interface SourceSuite {
  id: string;
  track: BenchmarkTrack;
  dataset: string;
  revision: string;
  config?: string;
  split?: string;
  selectorField: string;
  promptField?: string;
  agentVisibleFields: string[];
  evaluatorOnlyFields: string[];
  artifact?: SourceArtifact;
  evaluator?: {
    repository: string;
    url: string;
    revision: string;
  };
}

export interface SourceCatalog {
  schemaVersion: number;
  suites: SourceSuite[];
}

export interface PreparedAgentFixture {
  schemaVersion: 1;
  workload: {
    id: string;
    track: BenchmarkTrack;
    delivery: string;
  };
  source: {
    dataset: string;
    revision: string;
    recordId: string;
  };
  prompt: string;
  fields: Record<string, unknown>;
}

export interface PreparedEvaluatorOracle {
  schemaVersion: 1;
  workloadId: string;
  source: {
    dataset: string;
    revision: string;
    recordId: string;
  };
  selector: {
    field: string;
    value: string | number;
  };
  row: Record<string, unknown>;
}

export interface PreparedFixturePaths {
  workloadId: string;
  agentFixturePath: string;
  evaluatorOraclePath: string;
  promptPath: string;
}

export interface BenchmarkPreflight {
  workloadId: string;
  adapter: "livedrbench" | "swebench" | "synthetic";
  status: "ready" | "blocked";
  checks: Array<{
    id: string;
    ok: boolean;
    detail: string;
  }>;
}

export interface EvaluationOutcome {
  status: "completed" | "blocked" | "failed";
  adapter: string;
  score: null | {
    metric: string;
    value: number;
    resolved?: boolean;
  };
  evidence: Array<{
    kind: string;
    detail: string;
  }>;
  command?: {
    executable: string;
    args: string[];
    exitCode: number | null;
  };
}

export interface BenchmarkRunRecord {
  schemaVersion: 1;
  runId: string;
  workload: {
    id: string;
    track: BenchmarkTrack;
    dataset: string;
    revision: string;
    recordId: string;
    artifactSha256?: string;
    evaluatorRevision?: string;
  };
  policy: string;
  submission: {
    sha256: string;
    bytes: number;
  };
  trace?: {
    sha256: string;
    bytes: number;
    relativePath: string;
  };
  evaluation: EvaluationOutcome;
}
