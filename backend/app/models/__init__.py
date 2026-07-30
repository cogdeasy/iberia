"""Model package.

Every module dropped into ``app/models/`` is imported automatically so that its
SQLAlchemy tables are registered on ``Base.metadata``. Domain teams add a new
module here instead of editing a shared file.
"""

import importlib
import pkgutil

__all__: list[str] = []

for _module in pkgutil.iter_modules(__path__):
    if _module.name.startswith("_"):
        continue
    importlib.import_module(f"{__name__}.{_module.name}")
    __all__.append(_module.name)
