export interface Project {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  settings: ProjectSettings;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  defaultChunkStrategy: "semantic" | "recursive" | "fixed" | "sentence";
  defaultChunkMaxTokens: number;
  defaultChunkOverlap: number;
  embeddingDimensions: number;
  qdrantCollectionName: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  settings?: Partial<ProjectSettings>;
}
