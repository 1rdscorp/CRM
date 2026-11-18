'use strict';

const path = require('node:path');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dbFile = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'rds.db');

// Set TRUST_PROXY=1 when the app sits behind a reverse proxy or a hosting
// platform that terminates HTTPS for you (Render, Fly.io, nginx, Caddy...).
const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false;

const app = createApp({ dbFile, trustProxy });

const server = app.listen(port, host, () => {
  console.log(`RDS Electronics CRM is running at http://localhost:${port}`);
  console.log(`Data is stored in ${dbFile}`);
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  // Don't wait forever for open browser connections.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
