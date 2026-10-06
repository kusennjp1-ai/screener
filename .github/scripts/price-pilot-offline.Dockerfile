# Dependency installation happens before the disconnected test phase.
# The harness records the resolved base and output image identities.
ARG PYTHON_IMAGE=python:3.11-slim-bookworm
FROM ${PYTHON_IMAGE}
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /dependencies
COPY backend/requirements*.txt ./backend/
COPY price-pilot-offline-constraints.txt ./constraints.txt
# The complete server requirements include sentence-transformers. Use official
# CPU wheels so this preview does not download CUDA runtime distributions.
RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && python -c "from importlib.metadata import version; print('torch==' + version('torch'))" > cpu-constraints.txt \
    && python -m pip install --index-url https://pypi.org/simple \
       -c constraints.txt -c cpu-constraints.txt -r backend/requirements.txt \
       -r backend/requirements-test.txt exchange-calendars==4.5.3 \
    && python -m pip check
WORKDIR /work
ENTRYPOINT ["python", "/work/.github/scripts/price-pilot-offline-check.py", "check"]
