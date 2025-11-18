export interface ProviderConfig {
  username?: string;
  token?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface JiraLegacyConfig extends ProviderConfig {
  username: string;
  baseUrl: string;
  displayUrl?: string;
  token: string;
}

export interface JiraConfig extends ProviderConfig {
  cloudId: string;
  username: string;
  displayUrl?: string;
  token: string;
}

export interface A2AConfig {
  agentId: string;
  agentUrl: string;
}

export interface Provider {
  get: (config: ProviderConfig | null, id: string | undefined) => Promise<string | null>;
}
