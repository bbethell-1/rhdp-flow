# RHDP-Scheduler → rhdp-flow Migration Guide

This guide helps you migrate from the old `rhpds-utils/RHDP-Scheduler` to the new standalone `rhdp-flow` repository.

## Quick Start

### Option 1: Automated Migration Script (Recommended)

If you're on macOS, use our automated migration script:

```bash
# Download and run the migration script
curl -fsSL https://raw.githubusercontent.com/rhjcd/rhdp-flow/main/migrate-rhdp-flow.sh -o migrate-rhdp-flow.sh
chmod +x migrate-rhdp-flow.sh
./migrate-rhdp-flow.sh
```

The script will:
- ✅ Clone the new `rhdp-flow` repository
- ✅ Set up Python virtual environment and dependencies
- ✅ Build the frontend
- ✅ Optionally remove the old `RHDP-Scheduler` directory
- ✅ Pull latest changes from `rhpds-utils`

### Option 2: Manual Migration

If you prefer manual setup or are not on macOS, follow these steps:

#### Step 1: Clone the new repository

```bash
# Navigate to your repos directory
cd ~/repos

# Clone the new rhdp-flow repository
git clone git@github.com:rhjcd/rhdp-flow.git

# Navigate into the new repo
cd rhdp-flow
```

#### Step 2: Set up the repository

```bash
# Python backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && npm run build && cd ..
```

#### Step 3: Clean up the old location (optional but recommended)

```bash
# Navigate to rhpds-utils
cd ~/repos/rhpds-utils

# Remove the old RHDP-Scheduler directory
rm -rf RHDP-Scheduler

# Pull the latest changes (includes the deletion commit)
git pull origin main
```

#### Step 4: Update any local references

**Check and update these common locations:**

- **Shell scripts/config files**: Search for `rhpds-utils/RHDP-Scheduler` and replace with `rhdp-flow`
- **IDE workspace settings**: Update project paths
- **Documentation**: Update any local docs that reference the old path
- **Aliases/shortcuts**: Update any command-line aliases

**Search command to find references:**
```bash
# Search for old path references in common config locations
grep -r "rhpds-utils/RHDP-Scheduler" ~/.bashrc ~/.zshrc ~/repos 2>/dev/null
```

#### Step 5: Update GitHub remote (if you had the old one forked)

If you had forked `rhpds-utils` and want to fork the new repo:

```bash
# Visit https://github.com/rhjcd/rhdp-flow and click "Fork"
# Then update your local remote:
cd ~/repos/rhdp-flow
git remote set-url origin git@github.com:YOUR_USERNAME/rhdp-flow.git
```

#### Step 6: Verify the setup

```bash
# Check git remote
cd ~/repos/rhdp-flow
git remote -v  # Should show git@github.com:rhjcd/rhdp-flow.git

# Check version
cat VERSION  # Should show current version

# Run a quick test
python3 -m pytest tests/ -v  # Should run tests successfully
```

## What Changed

| Old Location | New Location |
|-------------|--------------|
| `~/repos/rhpds-utils/RHDP-Scheduler` | `~/repos/rhdp-flow` |
| `git@github.com:rhpds/rhpds-utils.git` | `git@github.com:rhjcd/rhdp-flow.git` |

### Changes Summary

- **Repository name**: RHDP-Scheduler → rhdp-flow
- **Location**: Moved from subdirectory to standalone repo
- **Git remote**: New dedicated repository
- **Branding**: Updated to match project's actual "RHDP-Flow" branding
- **Functionality**: No changes - all features preserved

## Running the Application

### Production Mode (single server)

```bash
cd ~/repos/rhdp-flow
source .venv/bin/activate
cd frontend && npm run build && cd ..
python3 -m uvicorn api.server:app --host 127.0.0.1 --port 8000
```

Open **http://localhost:8000** in your browser.

### Development Mode (two terminals)

**Terminal 1 — API server** (port 8000):
```bash
cd ~/repos/rhdp-flow
source .venv/bin/activate
python3 -m uvicorn api.server:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — Frontend dev server** (port 5173):
```bash
cd ~/repos/rhdp-flow/frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

## Troubleshooting

### Old directory still exists

If you still have the old `RHDP-Scheduler` directory and want to remove it:

```bash
cd ~/repos/rhpds-utils
rm -rf RHDP-Scheduler
git pull origin main
```

### Git remote is wrong

If your git remote is still pointing to the old location:

```bash
cd ~/repos/rhdp-flow
git remote set-url origin git@github.com:rhjcd/rhdp-flow.git
git remote -v  # Verify the change
```

### Dependencies not installing

If you have issues with dependencies:

```bash
# Python dependencies
cd ~/repos/rhdp-flow
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend dependencies
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Tests failing

If tests are failing after migration:

```bash
cd ~/repos/rhdp-flow
source .venv/bin/activate
python3 -m pytest tests/ -v --tb=short
```

## Additional Resources

- **New Repository**: https://github.com/rhjcd/rhdp-flow
- **Documentation**: See README.md in the new repository
- **Issues**: Report issues in the new repository

## Support

If you encounter any issues during migration:

1. Check the troubleshooting section above
2. Review the main README.md in the new repository
3. Open an issue on the new repository: https://github.com/rhjcd/rhdp-flow/issues

---

**Note**: The new repository has full git history preserved, so any previous work and branches are still accessible. The migration is designed to be seamless with no loss of functionality or data.
