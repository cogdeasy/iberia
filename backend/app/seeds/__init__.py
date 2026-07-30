"""Seed package.

Each module here exposes ``seed(db) -> None`` and an integer ``ORDER`` used to sort
execution. ``python seed.py`` discovers and runs them all, so domains can ship their
own deterministic fixtures without touching a shared seeding script.
"""
