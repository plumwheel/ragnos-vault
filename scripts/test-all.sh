#!/bin/bash

# RAGnos Vault - Complete Test Suite
# Runs all tests: unit, integration, and end-to-end

set -e

echo "🧪 RAGnos Vault - Complete Test Suite"
echo "====================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -e "${BLUE}Running: ${test_name}${NC}"
    echo "Command: $test_command"
    echo
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ PASSED: ${test_name}${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAILED: ${test_name}${NC}"
        ((TESTS_FAILED++))
    fi
    echo
}

# Ensure we're in the right directory
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)
echo "Project root: $PROJECT_ROOT"
echo

# Check dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"
if command -v node >/dev/null 2>&1; then
    echo "Node.js: $(node --version)"
else
    echo -e "${RED}Error: Node.js is required${NC}"
    exit 1
fi

if command -v npm >/dev/null 2>&1; then
    echo "npm: $(npm --version)"
else
    echo -e "${RED}Error: npm is required${NC}"
    exit 1
fi

if command -v tsx >/dev/null 2>&1; then
    echo "tsx: $(tsx --version 2>/dev/null || echo 'installed')"
else
    echo -e "${YELLOW}Installing tsx globally...${NC}"
    npm install -g tsx
fi
echo

# Install project dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing project dependencies...${NC}"
    npm install
fi

# 1. Linting and Code Quality
run_test "ESLint (Frontend)" "cd frontend && npm run lint --silent"
run_test "ESLint (Backend)" "cd backend && npm run lint --silent"

# 2. TypeScript Compilation
run_test "TypeScript Compilation (Frontend)" "cd frontend && npx tsc --noEmit"
run_test "TypeScript Compilation (Backend)" "cd backend && npx tsc --noEmit"

# 3. Unit Tests
run_test "Unit Tests (Frontend)" "cd frontend && npm test -- --watchAll=false --coverage=false"
run_test "Unit Tests (Backend)" "cd backend && npm test -- --watchAll=false --coverage=false"

# 4. Build Tests
run_test "Frontend Build" "cd frontend && npm run build"
run_test "Backend Build" "cd backend && npm run build"

# 5. Security Scans
if command -v audit-ci >/dev/null 2>&1; then
    run_test "Security Audit" "audit-ci --config audit-ci.json"
else
    run_test "NPM Security Audit" "npm audit --audit-level=high"
fi

# 6. Database Schema Validation
run_test "Database Schema Validation" "cd backend && npx knex migrate:validate"

# 7. Vault Bootstrap Test
run_test "Vault Bootstrap Script" "tsx scripts/vault-bootstrap.ts > /dev/null"

# 8. CLI Tool Test
echo -e "${BLUE}Testing CLI tool functionality...${NC}"
if [ -z "$VAULT_TOKEN" ] || [ -z "$WORKSPACE_ID" ]; then
    echo -e "${YELLOW}Skipping CLI tests - VAULT_TOKEN and WORKSPACE_ID not set${NC}"
    echo "To run CLI tests, set these environment variables:"
    echo "export VAULT_TOKEN='vt_your_token_here'"
    echo "export WORKSPACE_ID='your-workspace-uuid-here'"
else
    run_test "CLI Help Command" "tsx scripts/vault-cli.ts --help > /dev/null"
    run_test "CLI List Secrets" "tsx scripts/vault-cli.ts list --limit 1 > /dev/null"
fi

# 9. Integration Tests (if services are running)
if curl -s "http://localhost:4000/api/v1/health" >/dev/null 2>&1; then
    run_test "Integration Tests" "tsx scripts/integration-test.ts"
else
    echo -e "${YELLOW}Skipping integration tests - API server not running${NC}"
    echo "To run integration tests, start the API server:"
    echo "cd backend && npm run dev"
fi

# 10. Docker Build Tests (if Docker is available)
if command -v docker >/dev/null 2>&1; then
    run_test "Docker Build (Frontend)" "docker build -f frontend/Dockerfile -t ragnos-vault-frontend:test ."
    run_test "Docker Build (Backend)" "docker build -f backend/Dockerfile -t ragnos-vault-backend:test ."
    
    # Clean up test images
    docker rmi ragnos-vault-frontend:test ragnos-vault-backend:test >/dev/null 2>&1 || true
else
    echo -e "${YELLOW}Skipping Docker build tests - Docker not available${NC}"
fi

# Summary
echo
echo "=========================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo "=========================================="

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! RAGnos Vault is ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Please review and fix the issues above.${NC}"
    exit 1
fi