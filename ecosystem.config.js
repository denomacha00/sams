const path = require('path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'sams-api',
      script: path.join(root, 'packages/backend/bin/pm2-start.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3001,
      },
      // .env loaded first by packages/backend/bin/pm2-start.js (then loadEnv.ts as backup)
      error_file: '/var/log/sams/sams-api-error.log',
      out_file: '/var/log/sams/sams-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 8000,
      shutdown_with_message: true,
      // wait_ready caused crash loops on some PM2 builds; .env via pm2-start.js
      wait_ready: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
