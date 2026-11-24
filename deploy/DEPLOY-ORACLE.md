# Cold Post — Oracle Cloud Always Free deployment

Everything in this directory is ready to run on a single Ampere A1 instance.
Provisioning needs the account holder, because the OCI tenancy is not
accessible from the development machine and no credentials exist for it.

## Cost envelope (do not exceed)

| Resource | Value |
| --- | --- |
| Shape | `VM.Standard.A1.Flex` (Always Free Eligible) |
| OCPU / RAM | 2 OCPU / 12 GB (the whole tenancy allowance) |
| Image | Canonical Ubuntu 24.04, aarch64 |
| Boot volume | 50 GB (Always Free covers 200 GB total block storage) |
| Load balancer | none — Cloudflare Tunnel instead |
| Managed DB / OKE / backups | none — SQLite on the boot volume |

No resource outside the Always Free list is used, and the account must stay on
the Always Free tier (no Pay As You Go upgrade).

## 1. Create the instance (account holder, OCI Console)

Region: the tenancy's home region (Ampere capacity is per-Availability Domain).

Compute → Instances → Create instance:

- Image: Canonical Ubuntu 24.04 (aarch64)
- Shape: Ampere → `VM.Standard.A1.Flex`, 2 OCPUs, 12 GB memory
- Networking: create/choose a VCN with a public subnet, assign a public IPv4
- SSH: upload the public half of the deploy key
- Boot volume: 50 GB

If no Availability Domain offers A1 capacity, stop — do **not** substitute a
paid shape. Report the exact console error.

Add ingress for TCP 22 only. Port 4100 is never opened: Cloudflare Tunnel
connects outbound.

## 2. Bootstrap the VM

```bash
scp deploy/bootstrap.sh deploy/backup-db.sh deploy/restore-test.sh ubuntu@<ip>:/tmp/
ssh ubuntu@<ip> 'sudo install -m 755 /tmp/*.sh /usr/local/bin/ && sudo bash /tmp/bootstrap.sh'
```

This installs Docker + Compose, `sqlite3`, `cloudflared`, enables the daemon,
creates `/var/lib/coldpost/data` (uid 1000), generates
`/etc/coldpost/backup.key`, restricts the firewall to SSH and schedules the
daily backup cron entry.

## 3. Deploy the application

```bash
sudo mkdir -p /opt/coldpost && sudo chown ubuntu:ubuntu /opt/coldpost
# from the repository root
rsync -az --exclude node_modules --exclude data --exclude web/dist --exclude '.env*' \
  ./ ubuntu@<ip>:/opt/coldpost/
ssh ubuntu@<ip>
cd /opt/coldpost
cp .env.production.example .env.production && $EDITOR .env.production   # chmod 600
bash deploy/release.sh manual
```

The API binds `127.0.0.1:4100`, restarts on failure (`restart: unless-stopped`)
and restarts with the VM (Docker is enabled at boot).

## 4. Persistent data

`/var/lib/coldpost/data` is bind-mounted to `/app/data`, which is `DATA_DIR`:

- `coldpost.db` plus `-wal` / `-shm` (SQLite in WAL mode)
- `app_secret` (AES-256-GCM key for provider credentials — never regenerate)
- `uploads/`

Container rebuilds and recreation never touch this directory. To move the
existing local database, take a snapshot first:

```bash
sqlite3 data/coldpost.db ".backup 'cp-move.db'"     # safe with WAL active
scp cp-move.db ubuntu@<ip>:/tmp/coldpost.db
ssh ubuntu@<ip> 'sudo install -o 1000 -g 1000 -m 640 /tmp/coldpost.db /var/lib/coldpost/data/coldpost.db'
rsync -az data/uploads/ ubuntu@<ip>:/var/lib/coldpost/data/uploads/
```

Copy `app_secret` the same way *before* starting the container, otherwise new
provider credentials will be encrypted with a different key than the existing
rows.

## 5. Cloudflare Tunnel

Zero Trust → Networks → Tunnels → Create tunnel (`coldpost-api`, token-based):

- Public hostname: `api.coldpost.delivery` → `http://127.0.0.1:4100`
- Install on the VM: `sudo cloudflared service install <TOKEN>`
- Token file: `/etc/cloudflared/token` (mode 600), service `cloudflared`

`coldpost.delivery` keeps pointing at the existing Pages project — do not
touch its DNS or email records.

## 6. GitHub Actions secrets

| Secret | Value |
| --- | --- |
| `OCI_DEPLOY_HOST` | instance public IP |
| `OCI_DEPLOY_USER` | `ubuntu` |
| `OCI_DEPLOY_SSH_KEY` | private deploy key (PEM) |
| `OCI_DEPLOY_KNOWN_HOSTS` | `ssh-keyscan <ip>` output |
| `CLOUDFLARE_PAGES_DEPLOY_TOKEN` | Pages edit token (frontend publish) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

Repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` feed the
frontend build. The Supabase secret key is only ever in `.env.production` on
the VM.

## 7. Backups

`/etc/cron.d/coldpost-backup` runs `coldpost-backup.sh` daily at 03:15 UTC:
online `.backup` snapshot → `PRAGMA integrity_check` → AES-256-CBC (pbkdf2)
into `/var/backups/coldpost/{db,files,meta}`, 14-day retention.

Rehearse a restore at any time (non-destructive):

```bash
sudo bash deploy/restore-test.sh
```

Offsite copies need an `rclone` remote; set `BACKUP_RCLONE_REMOTE` in the cron
entry once one exists. The KV secret is `/etc/coldpost/backup.key` — store a
copy in a password manager, without it encrypted backups cannot be opened.
