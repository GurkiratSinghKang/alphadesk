"""Direct wheel installer - bypasses pip hang on Windows."""
import urllib.request
import zipfile
import io
import os
import sys
import json
import time

SITE_PACKAGES = os.path.join(os.path.dirname(sys.executable), "Lib", "site-packages")

# Package -> wheel URL mapping (py3-none-any where possible, cp312-win_amd64 for compiled)
PACKAGES = {
    # Core web
    "fastapi": "https://files.pythonhosted.org/packages/py3/f/fastapi/fastapi-0.115.12-py3-none-any.whl",
    "uvicorn": "https://files.pythonhosted.org/packages/py3/u/uvicorn/uvicorn-0.34.2-py3-none-any.whl",
    "starlette": "https://files.pythonhosted.org/packages/py3/s/starlette/starlette-0.46.2-py3-none-any.whl",
    "pydantic": "https://files.pythonhosted.org/packages/cp312/p/pydantic/pydantic-2.11.3-cp312-cp312-win_amd64.whl",
    "pydantic_core": "https://files.pythonhosted.org/packages/cp312/p/pydantic_core/pydantic_core-2.33.1-cp312-cp312-win_amd64.whl",
    "pydantic_settings": "https://files.pythonhosted.org/packages/py3/p/pydantic-settings/pydantic_settings-2.9.1-py3-none-any.whl",
    "python_dotenv": "https://files.pythonhosted.org/packages/py3/p/python-dotenv/python_dotenv-1.1.0-py3-none-any.whl",
    "orjson": "https://files.pythonhosted.org/packages/cp312/o/orjson/orjson-3.10.18-cp312-cp312-win_amd64.whl",
    "httpx": "https://files.pythonhosted.org/packages/py3/h/httpx/httpx-0.28.1-py3-none-any.whl",
    "httpcore": "https://files.pythonhosted.org/packages/py3/h/httpcore/httpcore-1.0.9-py3-none-any.whl",
    "websockets": "https://files.pythonhosted.org/packages/cp312/w/websockets/websockets-15.0.1-cp312-cp312-win_amd64.whl",
    "anyio": "https://files.pythonhosted.org/packages/py3/a/anyio/anyio-4.9.0-py3-none-any.whl",
    "sniffio": "https://files.pythonhosted.org/packages/py3/s/sniffio/sniffio-1.3.1-py3-none-any.whl",
    "h11": "https://files.pythonhosted.org/packages/py3/h/h11/h11-0.16.0-py3-none-any.whl",
    "idna": "https://files.pythonhosted.org/packages/py3/i/idna/idna-3.10-py3-none-any.whl",
    "certifi": "https://files.pythonhosted.org/packages/py3/c/certifi/certifi-2025.4.26-py3-none-any.whl",
    "typing_extensions": "https://files.pythonhosted.org/packages/py3/t/typing_extensions/typing_extensions-4.14.0-py3-none-any.whl",
    "annotated_types": "https://files.pythonhosted.org/packages/py3/a/annotated_types/annotated_types-0.7.0-py3-none-any.whl",
    "typing_inspection": "https://files.pythonhosted.org/packages/py3/t/typing_inspection/typing_inspection-0.4.1-py3-none-any.whl",
    "click": "https://files.pythonhosted.org/packages/py3/c/click/click-8.2.1-py3-none-any.whl",

    # Database
    "sqlalchemy": "https://files.pythonhosted.org/packages/cp312/s/sqlalchemy/sqlalchemy-2.0.41-cp312-cp312-win_amd64.whl",
    "asyncpg": "https://files.pythonhosted.org/packages/cp312/a/asyncpg/asyncpg-0.30.0-cp312-cp312-win_amd64.whl",
    "alembic": "https://files.pythonhosted.org/packages/py3/a/alembic/alembic-1.15.2-py3-none-any.whl",
    "mako": "https://files.pythonhosted.org/packages/py3/m/mako/mako-1.3.10-py3-none-any.whl",
    "markupsafe": "https://files.pythonhosted.org/packages/cp312/m/markupsafe/MarkupSafe-3.0.2-cp312-cp312-win_amd64.whl",
    "greenlet": "https://files.pythonhosted.org/packages/cp312/g/greenlet/greenlet-3.2.3-cp312-cp312-win_amd64.whl",
    "redis": "https://files.pythonhosted.org/packages/py3/r/redis/redis-6.2.0-py3-none-any.whl",
    "async_timeout": "https://files.pythonhosted.org/packages/py3/a/async_timeout/async_timeout-5.0.1-py3-none-any.whl",

    # Claude AI
    "anthropic": "https://files.pythonhosted.org/packages/py3/a/anthropic/anthropic-0.52.0-py3-none-any.whl",
    "jiter": "https://files.pythonhosted.org/packages/cp312/j/jiter/jiter-0.10.0-cp312-cp312-win_amd64.whl",
    "distro": "https://files.pythonhosted.org/packages/py3/d/distro/distro-1.9.0-py3-none-any.whl",
    "tokenizers": "https://files.pythonhosted.org/packages/cp312/t/tokenizers/tokenizers-0.21.2-cp312-cp312-win_amd64.whl",
    "huggingface_hub": "https://files.pythonhosted.org/packages/py3/h/huggingface_hub/huggingface_hub-0.33.0-py3-none-any.whl",

    # Data science
    "numpy": "https://files.pythonhosted.org/packages/cp312/n/numpy/numpy-2.2.6-cp312-cp312-win_amd64.whl",
    "pandas": "https://files.pythonhosted.org/packages/cp312/p/pandas/pandas-2.2.3-cp312-cp312-win_amd64.whl",
    "pytz": "https://files.pythonhosted.org/packages/py2.py3/p/pytz/pytz-2025.2-py2.py3-none-any.whl",
    "python_dateutil": "https://files.pythonhosted.org/packages/py2.py3/p/python_dateutil/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
    "six": "https://files.pythonhosted.org/packages/py2.py3/s/six/six-1.17.0-py2.py3-none-any.whl",
    "tzdata": "https://files.pythonhosted.org/packages/py2.py3/t/tzdata/tzdata-2025.2-py2.py3-none-any.whl",
}


def install_wheel(name: str, url: str) -> bool:
    try:
        already = os.path.exists(os.path.join(SITE_PACKAGES, name))
        if already:
            # Check more carefully
            pkg_dirs = [d for d in os.listdir(SITE_PACKAGES)
                       if d.startswith(name) and d.endswith('.dist-info')]
            if pkg_dirs:
                print(f"  [skip] {name} (already installed)")
                return True

        t0 = time.time()
        data = urllib.request.urlopen(url, timeout=30).read()
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(SITE_PACKAGES)
        elapsed = time.time() - t0
        size_mb = len(data) / 1024 / 1024
        print(f"  [ok]   {name} ({size_mb:.1f}MB in {elapsed:.1f}s)")
        return True
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")
        return False


if __name__ == "__main__":
    print(f"Installing to: {SITE_PACKAGES}")
    print(f"Python: {sys.version}")
    print(f"Packages: {len(PACKAGES)}")
    print()

    ok = 0
    fail = 0
    for name, url in PACKAGES.items():
        if install_wheel(name, url):
            ok += 1
        else:
            fail += 1

    print(f"\nDone: {ok} ok, {fail} failed")

    # Verify key imports
    print("\nVerifying imports:")
    for mod in ["fastapi", "uvicorn", "pydantic", "sqlalchemy", "anthropic", "numpy", "pandas", "redis", "httpx"]:
        try:
            __import__(mod)
            print(f"  [ok] {mod}")
        except ImportError as e:
            print(f"  [FAIL] {mod}: {e}")
