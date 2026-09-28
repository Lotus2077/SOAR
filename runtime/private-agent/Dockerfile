# Public artifact tooling only. Build with the context restricted to this directory.
# This is the same immutable Python base manifest used by the pinned coding image.
# Runtime selection must use the resulting immutable image ID, never the build tag.
FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534

# Debian top-level versions are frozen from signed repository metadata. Transitive
# Debian packages are captured in the final image/version receipt; this Dockerfile
# alone is not a byte-reproducible Debian snapshot. No private build arguments.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash=5.2.37-2+b9 \
        chromium=152.0.7977.82-1~deb13u1 \
        fonts-noto-cjk=1:20240730+repack1-1 \
        fonts-noto-color-emoji=2.051-0+deb13u1 \
        fonts-noto-core=20201225-2 \
        git=1:2.47.3-0+deb13u1 \
        libreoffice-calc=4:25.2.3-2+deb13u6 \
        libreoffice-impress=4:25.2.3-2+deb13u6 \
        libreoffice-writer=4:25.2.3-2+deb13u6 \
        poppler-utils=25.03.0-5+deb13u4 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY requirements.txt /opt/soar/artifact-requirements.txt
RUN python3 -I -m pip --isolated --disable-pip-version-check install \
        --no-cache-dir --only-binary=:all: --require-hashes \
        --index-url https://pypi.org/simple -r /opt/soar/artifact-requirements.txt \
    && python3 -I -c "import pypdf, pptx, docx, openpyxl, playwright, PIL, lxml" \
    && mkdir -p /workspace

# Playwright must explicitly launch /usr/bin/chromium. No second browser download.
# Runtime uses the host DockerSandbox: no network or mounts, non-root, clean env,
# read-only rootfs and bounded tmpfs. LibreOffice profiles belong under /tmp.
WORKDIR /workspace
CMD ["python3", "-I", "-c", "import time; time.sleep(86400)"]
