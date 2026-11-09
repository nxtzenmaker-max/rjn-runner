# ⚡ RJN Runner (Cloud Execution Sandbox)

Dedicated remote command execution and Python runtime environment for **RJN AI**, hosted on **Railway**.

---

## 🚀 Endpoints

- `POST /execute` - Execute arbitrary bash / terminal commands (returns stdout, stderr, exitCode, duration).
- `POST /python` - Run Python 3 scripts in isolated runtime.
- `GET /health` - System health, CPU & memory stats.
- `GET /` - Public status.

## 🔐 Authentication

All execution endpoints require:
`Authorization: Bearer <RUNNER_SECRET_KEY>`
