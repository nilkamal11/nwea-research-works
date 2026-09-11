"""Serve the D3 interface with Python-computed views on localhost."""

from __future__ import annotations

import argparse
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .analytics import ROOT, QueryError, ResearchAnalytics


def create_app(dataset: dict | None = None, web_root: Path | None = None) -> Flask:
    analytics = ResearchAnalytics(dataset)
    web_root = (web_root or ROOT / "python-d3").resolve()
    app = Flask(__name__, static_folder=None)
    app.config.update(JSON_SORT_KEYS=False, MAX_CONTENT_LENGTH=1024)
    app.json.sort_keys = False

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(QueryError)
    def query_error(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.get("/")
    def root():
        return redirect("/python-d3/")

    @app.get("/python-d3/")
    def index():
        path = web_root / "index.html"
        if not path.is_file():
            return jsonify(error="The dashboard page is unavailable"), 404
        page = path.read_text(encoding="utf-8").replace('data-mode="static"', 'data-mode="api"', 1)
        return Response(page, content_type="text/html; charset=utf-8")

    @app.get("/python-d3/api/bootstrap")
    def bootstrap():
        if request.args:
            raise QueryError("The bootstrap endpoint does not accept filters")
        return jsonify(analytics.bootstrap())

    @app.get("/python-d3/api/view")
    def view():
        return jsonify(analytics.query(request.args))

    @app.get("/python-d3/<path:filename>")
    def asset(filename):
        # Static assets have a dedicated folder. Dot paths, symlinks outside it,
        # and repository files cannot be served through this route.
        if "\\" in filename or "\x00" in filename or any(part.startswith(".") for part in filename.split("/")):
            return jsonify(error="Asset not found"), 404
        path = (web_root / filename).resolve()
        if not path.is_relative_to(web_root) or not path.is_file():
            return jsonify(error="Asset not found"), 404
        return send_from_directory(web_root, filename)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    create_app().run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
