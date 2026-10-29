"""Standalone companion web process for Render or local hosting."""

import os

from aiohttp import web

from cogs.companion import Companion


def create_app(db_path: str | None = None, asset_root: str | None = None) -> web.Application:
    from functions.config import companion_assets, companion_db
    return Companion(bot=None, db_path=db_path or companion_db,
                     asset_root=asset_root or companion_assets).create_web_app()


if __name__ == "__main__":
    web.run_app(
        create_app(),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8080")),
        access_log_format='%a "%r" %s %Tf',
    )
