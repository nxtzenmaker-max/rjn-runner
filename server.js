const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.RUNNER_SECRET_KEY || 'rjn_live_runner_9a8b7c6d5e4f3a2b1';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Auth middleware for execution endpoints
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.query.key || '');
  if (!SECRET_KEY || token === SECRET_KEY) {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: 'Unauthorized. Invalid or missing secret key.'
  });
}

// Public Health & Status
app.get('/', (req, res) => {
  res.json({
    name: 'RJN Cloud Execution Engine',
    status: 'online',
    version: '1.0.0',
    platform: `${os.type()} ${os.arch()} (${os.release()})`,
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSec: process.uptime(),
    memory: process.memoryUsage(),
    systemMemory: {
      free: os.freemem(),
      total: os.totalmem()
    },
    cpus: os.cpus().length
  });
});

// Command Execution Endpoint
app.post('/execute', authenticate, (req, res) => {
  const { command, timeout = 30000, cwd = '/app' } = req.body;

  if (!command || typeof command !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing command string in request body'
    });
  }

  const startTime = Date.now();
  console.log(`[EXECUTE] command: "${command}" (timeout: ${timeout}ms)`);

  exec(
    command,
    {
      shell: '/bin/bash',
      timeout: Math.min(Number(timeout) || 30000, 120000),
      maxBuffer: 10 * 1024 * 1024,
      cwd: fs.existsSync(cwd) ? cwd : '/app',
      env: {
        ...process.env,
        PATH: process.env.PATH + ':/usr/local/bin:/usr/bin:/bin'
      }
    },
    (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = error ? (error.code ?? 1) : 0;

      res.json({
        success: !error || exitCode === 0,
        command,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        exitCode,
        durationMs,
        killed: error ? Boolean(error.killed) : false
      });
    }
  );
});

// Python Script Execution Endpoint
app.post('/python', authenticate, (req, res) => {
  const { code, timeout = 30000 } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing python code string'
    });
  }

  const tempFile = path.join(os.tmpdir(), `script_${Date.now()}_${Math.random().toString(36).substring(7)}.py`);
  fs.writeFileSync(tempFile, code, 'utf-8');

  const startTime = Date.now();
  exec(
    `python3 "${tempFile}"`,
    {
      shell: '/bin/bash',
      timeout: Math.min(Number(timeout) || 30000, 120000),
      maxBuffer: 10 * 1024 * 1024
    },
    (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      try { fs.unlinkSync(tempFile); } catch (e) {}

      res.json({
        success: !error,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        exitCode: error ? (error.code ?? 1) : 0,
        durationMs
      });
    }
  );
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RJN Runner listening on 0.0.0.0:${PORT}`);
});
