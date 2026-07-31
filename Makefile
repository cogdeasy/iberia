# Iberia demo platform — developer and demo entrypoints.
#
#   make setup            install backend venv + frontend node_modules
#   make dev              backend + frontend together (Procfile order)
#   make observability-up Prometheus + Grafana + Loki
#   make demo-reset       drop the SQLite DB and reseed deterministically

SHELL := /bin/bash
BACKEND := backend
FRONTEND := frontend
VENV := $(BACKEND)/.venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
COMPOSE_FILE := ops/docker-compose.observability.yml
DB_FILE := $(BACKEND)/iberia.db

.DEFAULT_GOAL := help
.PHONY: help setup seed backend frontend dev lint test smoke observability-up observability-down demo-reset

help: ## show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## create the backend venv, install python + node dependencies
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r $(BACKEND)/requirements-dev.txt
	cd $(FRONTEND) && npm install

seed: ## (re)seed the SQLite database deterministically (idempotent)
	cd $(BACKEND) && .venv/bin/python seed.py

backend: ## run the API on :8000 with reload, teeing JSON logs to logs/backend.log
	mkdir -p logs
	cd $(BACKEND) && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | tee -a ../logs/backend.log

frontend: ## run the Angular dev server (ng serve) on :5173
	cd $(FRONTEND) && npm run dev

dev: ## run backend + frontend together
	./scripts/dev.sh

lint: ## ruff (backend) + ng lint (frontend)
	cd $(BACKEND) && .venv/bin/ruff check .
	cd $(FRONTEND) && npm run lint

test: ## pytest (backend) + ng build (frontend)
	cd $(BACKEND) && .venv/bin/pytest
	cd $(FRONTEND) && npm run build

smoke: ## curl-based smoke test against a running backend
	./scripts/smoke.sh

observability-up: ## start Prometheus, Grafana, Loki and Promtail
	mkdir -p logs
	docker compose -f $(COMPOSE_FILE) up -d
	@echo "Grafana  http://localhost:3000 (admin / iberia-demo)"
	@echo "Prometheus http://localhost:9090"

observability-down: ## stop the observability stack
	docker compose -f $(COMPOSE_FILE) down

demo-reset: ## drop the database, reseed, and clear captured logs
	rm -f $(DB_FILE) $(DB_FILE)-journal
	cd $(BACKEND) && .venv/bin/python seed.py
	rm -f logs/*.log
	@echo "demo state reset: database reseeded (SEED=42), logs cleared"
