# Local Cloud Console

Local Cloud Console is a self-hosted EC2-style console for real Ubuntu VMs on a laptop or workstation. It uses React/Vite, Express, Prisma 7 with Neon PostgreSQL, Multipass, browser terminals, live metrics, SSH key delivery, and security groups.

## Prerequisites

- Ubuntu or another host that can run Multipass.
- Node.js 22.12 or newer and npm 10 or newer.
- Multipass installed on the host.
- A Neon PostgreSQL project and pooled or direct connection string.
- Native build tools for packages such as `node-pty`.

Install Node 22 with `nvm`:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
node --version
npm --version
```

Install Multipass on Ubuntu:

```bash
sudo snap install multipass
multipass version
multipass list
```

## Neon Setup

Create `.env` from the example and set `DATABASE_URL` to your Neon PostgreSQL connection string:

```bash
cp .env.example .env
```

The value should look like this shape:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
```

Do not commit `.env`, `.pem`, or private key files.

## Install And Migrate

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

`npm run prisma:migrate` connects to Neon through `DATABASE_URL`.

## Run Development Servers

```bash
npm run dev
```

The API binds to `0.0.0.0:5000`. Vite runs with `--host` on port `5173`.

Local browser:

```text
http://localhost:5173
```

Another device on the same LAN:

```text
http://<host-lan-ip>:5173
```

The browser derives API and WebSocket URLs from `window.location.hostname`, so LAN clients call `http://<host-lan-ip>:5000/api` and `ws://<host-lan-ip>:5000/api/ws/terminal/:id`.

Find the host LAN IP:

```bash
hostname -I
```

If another device cannot connect, check the host firewall for ports `5173` and `5000`.

## Safety Guarantees

- Host commands use `spawn`/PTY argument arrays, not shell strings.
- Launch cloud-init is sent to Multipass over stdin.
- Private SSH keys are returned once in the launch response and are not stored server-side.
- The database stores only public SSH key material and fingerprints.
- Security groups are allow-only; zero attached groups means unmanaged allow-all.
- Web terminal and instance management requests are checked against security groups.

## Validation

```bash
npm install --dry-run
npm run prisma:generate
npm run prisma:migrate
npm run typecheck
npm run lint
npm run test
npm run build
```

## Feature Checklist

| Requirement | Status | Notes |
| --- | --- | --- |
| FR-1 Launch a real instance | Implemented | Launches Ubuntu VMs through Multipass, polls IPv4, saves the control-plane record, and returns the one-time key. Verified on this host during development. |
| FR-2 Instance types | Implemented | Server-side catalog supports `t2.micro`, `t2.small`, and `t2.medium`; spoofed types are rejected. |
| FR-3 List instances | Implemented | Dashboard table shows Control-plane ID, name, Multipass VM name, type/specs, status, IPv4, description, created time, security groups, and key indicator. Existing Multipass VMs are adopted with no key material. |
| FR-4 Lifecycle | Implemented | Start, stop, terminate, per-row loading, terminate confirmation, IP refresh on start, and missing-VM terminate cleanup are implemented. |
| FR-5 Status indicator | Implemented | RUNNING and STOPPED badges are color-coded. |
| FR-6 SSH key-pair management | Implemented | RSA 2048 keys are generated per launch; private key is returned once and downloaded by the browser; only public key/fingerprint are stored. SSH acceptance depends on local Multipass networking and was not rerun in the final validation pass. |
| FR-7 Web terminal | Implemented | WebSocket + node-pty bridge runs `multipass exec <vm> -- bash -l`; resize and cleanup are implemented. Manual interactive verification is host-dependent. |
| FR-8 Monitoring | Implemented | Metrics endpoint and monitor modal poll every 2 seconds; CPU/memory/disk are derived from Multipass, network and disk I/O are bounded simulations. |
| FR-9 Security groups | Implemented | CRUD, rules, many-to-many attachments, allow-only union semantics, zero-group allow-all, fail-closed behavior, REST and WebSocket enforcement, and UI warnings are implemented. |
| FR-10 LAN access | Implemented | API binds to `0.0.0.0:5000`, Vite uses `--host`, and the browser derives REST/WebSocket hosts from `window.location.hostname`. |

## Environment Variables

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | none | Neon PostgreSQL connection string used by Prisma and the API. |
| `API_HOST` | No | `0.0.0.0` | API listen host. Keep `0.0.0.0` for LAN access. |
| `API_PORT` | No | `5000` | API listen port expected by the frontend. |
| `WEB_PORT` | No | `5173` | Documented Vite port; Vite uses its own CLI/config for serving. |

## Commands

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Apply migrations to Neon
npm run prisma:migrate

# Start API and web app
npm run dev

# Validate locally
npm run typecheck
npm run lint
npm run test
npm run build
```

## Known Limitations

- Launching, stopping, starting, and terminating use real Multipass resources and can take minutes.
- Existing Multipass VMs can be adopted into the control-plane list, but adopted VMs have no control-plane-issued private key and show `No key`.
- Other LAN devices can use the console, but they generally cannot directly route to Multipass private IPs such as `10.175.x.x`; terminal access is relayed through the backend.
- Network throughput and disk I/O charts are simulated because Multipass does not expose those counters.
- Security groups protect API and browser terminal access. They do not program host-level firewall rules inside Multipass or the guest OS.
- Real SSH acceptance requires the downloaded PEM, host routing to the Multipass network, and guest cloud-init completing successfully.
- Production auth, user accounts, audit logs, HTTPS termination, and role-based access control are outside this project scope.

## Manual Acceptance Testing

1. Start the app with `npm run dev`.
2. Open `http://localhost:5173`.
3. Launch a `t2.micro` instance and confirm a `.pem` file downloads once.
4. Confirm the instance reaches `RUNNING` and shows an IPv4 address.
5. Open the browser terminal and run `whoami`, `top`, `vim --version`, and `sudo true`.
6. Open monitoring and confirm charts update every 2 seconds.
7. Create a security group with SSH from My IP, attach it to the instance, and confirm terminal access still works.
8. Replace the rule with a blocked CIDR and confirm terminal or management calls return `Blocked by Security Group`.
9. Stop, start, and terminate the instance from the UI.
10. From another LAN device, open `http://<host-lan-ip>:5173` and repeat a list/monitor/terminal check.

Do not create real VMs for smoke testing unless you are ready for Multipass to allocate CPU, RAM, and disk on the host.

## Demo Script

1. Open `http://localhost:5173` and introduce Local Cloud Console as a local EC2-style control plane.
2. Show the instance catalog: `t2.micro`, `t2.small`, and `t2.medium`.
3. Launch a `t2.micro` instance with a short name and description.
4. Point out the one-time private key download and the warning modal.
5. Show the new row: Control-plane ID, Multipass VM name, status, IPv4, key badge, and action buttons.
6. Open Monitor and wait for two or three polling intervals so the charts move.
7. Open Connect and run `whoami`, `hostname`, `pwd`, and `sudo true`.
8. Stop the instance, show the STOPPED badge, then start it and show the refreshed IPv4.
9. Create a Security Group with the SSH preset and My IP source, attach it from the shield button, and confirm Connect still works.
10. Change the rules to a CIDR that does not include the current client IP and show that terminal or management access is rejected with `Blocked by Security Group`.
11. Remove the blocking group or restore the SSH rule.
12. Terminate the instance and confirm it disappears from both the UI and `multipass list`.
# AWS-Project
