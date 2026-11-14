const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
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
    version: '2.0.0',
    platform: `${os.type()} ${os.arch()} (${os.release()})`,
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
    features: ['buffered_execute', 'stream_execute', 'task_daemon', 'python_runner']
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

// 1. Buffered Command Execution Endpoint
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
      timeout: Math.min(Number(timeout) || 30000, 180000),
      maxBuffer: 20 * 1024 * 1024,
      cwd: fs.existsSync(cwd) ? cwd : '/app',
      env: {
        ...process.env,
        PATH: process.env.PATH + ':/usr/local/bin:/usr/bin:/bin',
        PYTHONUNBUFFERED: '1'
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

// 2. Real-Time Streaming Command Execution Endpoint (Chunked Live Output)
app.post('/execute/stream', authenticate, (req, res) => {
  const { command, timeout = 60000, cwd = '/app' } = req.body;

  if (!command || typeof command !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing command string in request body'
    });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const startTime = Date.now();
  console.log(`[EXECUTE STREAM] command: "${command}" (timeout: ${timeout}ms)`);

  const child = spawn('/bin/bash', ['-c', command], {
    cwd: fs.existsSync(cwd) ? cwd : '/app',
    env: {
      ...process.env,
      PATH: process.env.PATH + ':/usr/local/bin:/usr/bin:/bin',
      FORCE_COLOR: '0',
      TERM: 'dumb',
      PYTHONUNBUFFERED: '1'
    }
  });

  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
      res.write(`\n[!] Command timed out after ${timeout}ms\n`);
    } catch(e) {}
  }, Math.min(Number(timeout) || 60000, 300000));

  child.stdout.on('data', chunk => {
    res.write(chunk);
  });

  child.stderr.on('data', chunk => {
    res.write(chunk);
  });

  child.on('error', err => {
    clearTimeout(timer);
    res.write(`\n[Execution Error]: ${err.message}\n`);
    res.end();
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const exitMsg = signal 
      ? `\n[Process terminated by signal: ${signal}] (took ${duration}s)` 
      : `\n✓ Exit ${code ?? 0} (${duration}s)`;
    res.write(`${exitMsg}\n`);
    res.end();
  });
});

// 3. Autonomous Task Trigger Endpoint
app.post('/tasks/run', authenticate, (req, res) => {
  const { taskId, instruction = '' } = req.body;
  if (!taskId) {
    return res.status(400).json({ success: false, error: 'Missing taskId' });
  }

  console.log(`[TASK TRIGGER] Starting task ${taskId}: "${instruction}"`);
  const executorScript = fs.existsSync('/app/task_executor.py') 
    ? '/app/task_executor.py' 
    : path.join(__dirname, 'task_executor.py');

  const child = spawn('python3', [executorScript, 'run', taskId, instruction], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  res.json({
    success: true,
    taskId,
    status: 'triggered',
    message: 'Task runner launched immediately in background.'
  });
});

// 4. Python Script Execution Endpoint
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

// Launch Background Autonomous Task Daemon
function startTaskDaemon() {
  const daemonPath = fs.existsSync('/app/task_executor.py')
    ? '/app/task_executor.py'
    : path.join(__dirname, 'task_executor.py');

  if (fs.existsSync(daemonPath)) {
    console.log(`🤖 Spawning RJN Autonomous Task Daemon from ${daemonPath}...`);
    const daemon = spawn('python3', [daemonPath, 'daemon'], {
      stdio: 'inherit'
    });
    daemon.on('exit', code => {
      console.warn(`[DAEMON] Exited with code ${code}, restarting in 5s...`);
      setTimeout(startTaskDaemon, 5000);
    });
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 RJN Runner listening on 0.0.0.0:${PORT}`);
  startTaskDaemon();
});
