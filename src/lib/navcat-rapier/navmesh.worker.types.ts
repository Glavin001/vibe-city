export type NavMeshWorkerRequest = {
  id: number;
  type: "build";
  extraction: import("./extract").RapierExtractionResult;
  options: NavMeshWorkerOptions;
};

export type NavMeshWorkerOptions = Omit<import("./generate").NavMeshGenOptions, "cache">;

export type NavMeshWorkerSuccess = {
  id: number;
  type: "result";
  result: import("./generate").NavMeshGenerationResult | null;
};

export type NavMeshWorkerError = {
  id: number;
  type: "error";
  message: string;
  stack?: string;
};

export type NavMeshWorkerResponse = NavMeshWorkerSuccess | NavMeshWorkerError;
