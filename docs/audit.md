# Prompt 1 Environment Audit

Date: 2026-07-14

## Machine

- Working directory: `/home/imtiaz/EC2`
- OS: Ubuntu 24.04.2 LTS
- Kernel: Linux 6.17.0-35-generic x86_64
- Git repo: not initialized
- Node.js: `v18.19.1`
- npm: `9.2.0`
- Multipass: not installed (`multipass: command not found`)
- QEMU binary check: `qemu-system-x86_64` not found in PATH

## Build Constraints Found

- Prisma 7 cannot install on Node 18. The attempted install failed with Prisma's preinstall message requiring Node `20.19+`, `22.12+`, or `24.0+`.
- Current Vite and Vitest packages also require modern Node versions. The scaffold declares Node `>=22.0.0`, but Node `22.12+` is the safer target because Prisma and Vite both accept that line.
- Multipass must be installed on the host before any real VM lifecycle feature can be accepted.
- Native build tools will be needed later for `node-pty`.

## Next Host Setup

Install or switch to Node 22 LTS, preferably `22.12+`, then run:

```bash
npm install
npm run typecheck
npm run lint
npm run test
```

Install Multipass before real VM work:

```bash
sudo snap install multipass
multipass version
```

## Prompt 1 Validation Results

- `npm install`: failed because Prisma 7 refuses Node `v18.19.1`.
- `npm install --package-lock-only --ignore-scripts`: passed; wrote `package-lock.json` with engine warnings.
- `npm install --ignore-scripts`: passed; installed dependencies locally with engine warnings.
- `npm run typecheck`: passed after building the shared package first.
- `npm run lint`: passed.
- `npm run test`: blocked by Node 18; Vitest/Rolldown requires newer `node:util` APIs.
- `npm run build`: TypeScript build passed for all workspaces; Vite bundling blocked by Node 18.
- `npm run prisma:generate`: blocked by Node 18/Prisma 7 runtime incompatibility.

## Prompt 1 Revalidation After nvm Upgrade

The shell initially still resolved `/usr/bin/node` (`v18.19.1`). Loading nvm explicitly with `source ~/.nvm/nvm.sh && nvm use 26` switched validation to Node `v26.5.0` and npm `11.17.0`.

- `npm install`: passed on Node `v26.5.0`.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test`: passed; no test files exist yet.
- `npm run build`: passed, including Vite production build.
- `DATABASE_URL='postgresql://user:pass@example.neon.tech/db?sslmode=require' npm run prisma:generate`: passed.

Remaining setup:

- Add the real Neon connection string to `.env` as `DATABASE_URL`.
- Make nvm load automatically in new terminals, or run `source ~/.nvm/nvm.sh && nvm use 26` before project commands.
- Install Multipass before real VM lifecycle work.
