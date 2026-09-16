#!/bin/bash

# RHDP-Scheduler to rhdp-flow Migration Script
# This script helps migrate from the old rhpds-utils/RHDP-Scheduler to the new standalone rhdp-flow repository

set -e  # Exit on error

echo "=========================================="
echo "RHDP-Scheduler → rhdp-flow Migration Script"
echo "=========================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default paths - can be overridden
REPOS_DIR="${REPOS_DIR:-$HOME/repos}"
OLD_REPO_PATH="$REPOS_DIR/rhpds-utils/RHDP-Scheduler"
NEW_REPO_PATH="$REPOS_DIR/rhdp-flow"
NEW_REPO_URL="git@github.com:rhjcd/rhdp-flow.git"

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_warning "This script is optimized for macOS. You're running on $OSTYPE."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if repos directory exists
if [ ! -d "$REPOS_DIR" ]; then
    print_error "Repos directory not found: $REPOS_DIR"
    echo "Please create it first: mkdir -p $REPOS_DIR"
    exit 1
fi

print_success "Found repos directory: $REPOS_DIR"

# Step 1: Check if old location exists
if [ -d "$OLD_REPO_PATH" ]; then
    print_warning "Found old RHDP-Scheduler at: $OLD_REPO_PATH"
    read -p "Do you want to remove it after cloning the new repo? (y/n) " -n 1 -r
    echo
    REMOVE_OLD=$REPLY
else
    print_warning "Old RHDP-Scheduler not found at: $OLD_REPO_PATH"
    print_warning "You may have already migrated or used a different path."
    REMOVE_OLD="n"
fi

# Step 2: Clone new repository
echo ""
echo "Step 1: Cloning new rhdp-flow repository..."
if [ -d "$NEW_REPO_PATH" ]; then
    print_warning "rhdp-flow already exists at: $NEW_REPO_PATH"
    read -p "Do you want to re-clone it? This will replace the existing directory. (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$NEW_REPO_PATH"
        git clone "$NEW_REPO_URL" "$NEW_REPO_PATH"
        print_success "Cloned rhdp-flow to: $NEW_REPO_PATH"
    else
        print_success "Using existing rhdp-flow directory"
    fi
else
    git clone "$NEW_REPO_URL" "$NEW_REPO_PATH"
    print_success "Cloned rhdp-flow to: $NEW_REPO_PATH"
fi

# Step 3: Set up Python environment
echo ""
echo "Step 2: Setting up Python environment..."
cd "$NEW_REPO_PATH"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    print_success "Created Python virtual environment"
else
    print_warning "Virtual environment already exists"
fi

source .venv/bin/activate
pip install -r requirements.txt --quiet
print_success "Installed Python dependencies"

# Step 4: Set up frontend
echo ""
echo "Step 3: Setting up frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install --quiet
    print_success "Installed npm dependencies"
else
    print_warning "node_modules already exists"
fi

npm run build --quiet
print_success "Built frontend"
cd ..

# Step 5: Remove old location if requested
if [[ $REMOVE_OLD =~ ^[Yy]$ ]] && [ -d "$OLD_REPO_PATH" ]; then
    echo ""
    echo "Step 4: Cleaning up old RHDP-Scheduler..."
    cd "$REPOS_DIR/rhpds-utils"
    if [ -d ".git" ]; then
        git pull origin main --quiet 2>/dev/null || git pull origin master --quiet 2>/dev/null || true
        print_success "Pulled latest changes from rhpds-utils"
    fi
    rm -rf "$OLD_REPO_PATH"
    print_success "Removed old RHDP-Scheduler directory"
fi

# Step 6: Summary
echo ""
echo "=========================================="
echo "Migration Complete!"
echo "=========================================="
echo ""
echo "New location: $NEW_REPO_PATH"
echo "Git remote: $NEW_REPO_URL"
echo ""
echo "Next steps:"
echo "1. cd $NEW_REPO_PATH"
echo "2. source .venv/bin/activate"
echo "3. python3 -m uvicorn api.server:app --host 127.0.0.1 --port 8000"
echo ""
echo "Or for development mode:"
echo "1. Terminal 1: cd $NEW_REPO_PATH && source .venv/bin/activate && python3 -m uvicorn api.server:app --port 8000"
echo "2. Terminal 2: cd $NEW_REPO_PATH/frontend && npm run dev"
echo ""
print_success "Migration completed successfully!"
