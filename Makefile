# RAGnos Vault Development Commands
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show available commands
	@echo "RAGnos Vault Development Commands:"
	@echo "=================================="
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*?##/ { printf "  %-15s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

bootstrap: ## Set up .env file for development
	@[ -f .env ] || cp .env.example .env
	@echo "✅ Bootstrapped .env file"

# Docker Development Commands
build: ## Build Docker images
	docker-compose -f docker-compose.yml build

push: ## Push Docker images
	docker-compose -f docker-compose.yml push

dev: up-dev logs ## Start development environment and show logs

up-dev: ## Start development environment
	docker compose -f docker-compose.dev.yml up --build -d

up-dev-ldap: ## Start with LDAP profile
	docker compose -f docker-compose.dev.yml --profile ldap up --build

up-dev-metrics: ## Start with metrics profile
	docker compose -f docker-compose.dev.yml --profile metrics up --build

up-prod: ## Start production environment
	docker-compose -f docker-compose.prod.yml up --build

down: ## Stop all services and remove volumes
	docker compose -f docker-compose.dev.yml down -v

logs: ## Show logs from all services
	docker compose -f docker-compose.dev.yml logs -f --tail=200

status: ## Show status of all services
	docker compose -f docker-compose.dev.yml ps

health: ## Check health of running services
	@echo "Checking service health..."
	@curl -fsS http://localhost:8080/api/v1/status || echo "❌ Backend health check failed"
	@curl -fsS http://localhost:3000 || echo "❌ Frontend health check failed"
	@echo "✅ Health check complete"

clean: ## Clean up Docker resources and git artifacts
	docker compose -f docker-compose.dev.yml down -v --remove-orphans
	docker system prune -f

# Development Quality Commands
test: ## Run tests
	@echo "Running tests..."
	@cd frontend && npm test --if-present || echo "No frontend tests"
	@cd backend && npm test --if-present || echo "No backend tests"

reviewable-ui: ## Lint and type-check frontend
	cd frontend && \
	npm run lint:fix && \
	npm run type:check

reviewable-api: ## Lint and type-check backend
	cd backend && \
	npm run lint:fix && \
	npm run type:check

reviewable: reviewable-ui reviewable-api ## Lint and type-check all code

# Additional Profiles
up-dev-sso: ## Start with SSO profile
	docker compose -f docker-compose.dev.yml --profile sso up --build

.PHONY: help bootstrap build push dev up-dev up-dev-ldap up-dev-metrics up-prod down logs status health clean test reviewable-ui reviewable-api reviewable up-dev-sso
