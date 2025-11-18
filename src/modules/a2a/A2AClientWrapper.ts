import { Client } from '@a2a-js/sdk';
import { debugLog, debugLogError } from '#src/utils/debugUtils.js';

export interface A2AClientConfig {
    agentId: string;
    agentUrl: string;
}

export class A2AClientWrapper {
    private client: Client;
    private config: A2AClientConfig;

    constructor(config: A2AClientConfig) {
        this.config = config;
        this.client = new Client({
            agentId: config.agentId,
            agentUrl: config.agentUrl,
        });
    }

    async sendMessage(message: string): Promise<string> {
        debugLog(`Sending message to A2A agent ${this.config.agentId} at ${this.config.agentUrl}: ${message}`);
        try {
            const response = await this.client.send(message);
            debugLog(`Received response from A2A agent: ${JSON.stringify(response)}`);

            // Assuming response has a text field or similar. Adjust based on actual SDK response type.
            // The SDK documentation or types would be useful here, but for now assuming a simple structure.
            // If response is an object, we might need to extract the content.
            if (typeof response === 'string') {
                return response;
            } else if (response && typeof response === 'object' && 'text' in response) {
                return (response as any).text;
            } else {
                return JSON.stringify(response);
            }
        } catch (error) {
            debugLogError('Error sending message to A2A agent', error);
            throw error;
        }
    }
}
