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

/**
 * Configuration for an A2A (Agent-to-Agent) protocol agent.
 * @experimental A2A support is experimental and may change.
 * @see {@link https://a2a-protocol.org/}
 */
export interface A2AConfig {
  /** Unique identifier for the agent, used in tool naming */
  agentId: string;
  /** URL endpoint for the A2A agent */
  agentUrl: string;
}

export interface Provider {
  get: (config: ProviderConfig | null, id: string | undefined) => Promise<string | null>;
}
