"""Deterministic database seeding.

Discovers every ``app/seeds/*.py`` module exposing ``seed(db)`` and runs them in
``ORDER`` sequence. Safe to run repeatedly: seeders must be idempotent.

    python seed.py
"""

import importlib
import pkgutil

import app.seeds
from app.db import SessionLocal, create_all


def main() -> None:
    create_all()
    modules = []
    for module_info in pkgutil.iter_modules(app.seeds.__path__):
        if module_info.name.startswith("_"):
            continue
        module = importlib.import_module(f"app.seeds.{module_info.name}")
        if hasattr(module, "seed"):
            modules.append((getattr(module, "ORDER", 100), module_info.name, module))

    db = SessionLocal()
    try:
        for _order, name, module in sorted(modules, key=lambda item: (item[0], item[1])):
            module.seed(db)
            print(f"seeded: {name}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
