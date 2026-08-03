#!/bin/bash
# RHDP-Flow Web UI Launcher
# Starts both the FastAPI backend and React frontend

cd /home/bbethell/RHDP-FLOW/rhpds-utils/RHDP-Scheduler

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting RHDP-Flow Web UI...${NC}"
echo ""

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${BLUE}Starting FastAPI backend on port 8000...${NC}"
uvicorn api.server:app --port 8000 --reload > /tmp/rhdp-backend.log 2>&1 &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend
echo -e "${BLUE}Starting React frontend...${NC}"
cd frontend
npm run dev > /tmp/rhdp-frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to be ready
sleep 3

echo ""
echo -e "${GREEN}✅ RHDP-Flow is running!${NC}"
echo ""

# Detect frontend port from vite output
sleep 1
FRONTEND_PORT=$(grep -oP "http://localhost:\K\d+" /tmp/rhdp-frontend.log 2>/dev/null | head -1)
FRONTEND_PORT=${FRONTEND_PORT:-5173}

echo -e "  ${BLUE}Frontend:${NC} http://localhost:${FRONTEND_PORT}"
echo -e "  ${BLUE}Backend:${NC}  http://localhost:8000"
echo -e "  ${BLUE}API Docs:${NC} http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo ""

# Keep script running and wait for interrupt
wait
