/**
 * MCP MySQL Launcher — reads DATABASE_URL_JEWELRY_TRACKER from system env,
 * parses it into individual MYSQL_* vars (host, port, user, password, database),
 * and spawns the @nilsir/mcp-server-mysql with those vars.
 *
 * The raw password lives ONLY in the Windows system env var —
 * never written to any project file or logged to console.
 */
const { spawn } = require('child_process');
const path = require('path');

const rawUrl = process.env.DATABASE_URL_JEWELRY_TRACKER;

if (!rawUrl) {
    console.error('[mcp-launcher] DATABASE_URL_JEWELRY_TRACKER is not set');
    process.exit(1);
}

// Parse: mysql://user:password@host:port/database
// Use greedy (.+) before the LAST @ to handle passwords containing @
const match = rawUrl.match(/^mysql:\/\/([^:]+):(.+)@([^/:]+)(?::(\d+))?\/(.+)$/);
if (!match) {
    console.error('[mcp-launcher] Failed to parse DATABASE_URL_JEWELRY_TRACKER');
    process.exit(1);
}

const [, user, password, host, port, database] = match;

// Build env for the MCP MySQL server — it expects individual MYSQL_* vars
const env = {
    ...process.env,
    MYSQL_HOST: host,
    MYSQL_PORT: port || '3306',
    MYSQL_USER: user,
    MYSQL_PASSWORD: password,
    MYSQL_DATABASE: database,
};

// Strip the launcher-specific var so the child doesn't leak it
delete env.DATABASE_URL_JEWELRY_TRACKER;

const serverPath = path.resolve(__dirname, '..', 'node_modules', '@nilsir', 'mcp-server-mysql', 'dist', 'index.js');

const child = spawn('node', [serverPath], {
    env,
    stdio: 'inherit',
});

child.on('exit', (code) => {
    process.exit(code || 0);
});

child.on('error', (err) => {
    console.error('[mcp-launcher] Failed to spawn MCP server:', err.message);
    process.exit(1);
});
