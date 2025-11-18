import { createServer } from 'http';
import { URL } from 'url';

const PORT = 3000;
const AGENT_ID = 'dummy-agent';

const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            id: AGENT_ID,
            name: 'Dummy Agent',
            description: 'A dummy agent for testing A2A integration',
            capabilities: {
                streaming: false,
            },
            endpoints: {
                a2a: `http://localhost:${PORT}/a2a`,
            },
        }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/a2a') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const json = JSON.parse(body);
                console.log('Received request:', json);

                // Simple echo response
                const response = {
                    jsonrpc: '2.0',
                    id: json.id,
                    result: {
                        text: `Echo: ${json.params?.message || 'No message'}`,
                    },
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response));
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Dummy agent listening on port ${PORT}`);
});
