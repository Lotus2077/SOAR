# Official Python manifest pinned after a verified registry pull. The resulting
# image must also be recorded by immutable image ID in each SOAR run.
FROM python:3.11-slim@sha256:9534e5a8e315485d4061ed659af0fd78a284c015f9b73661b41d6bab25604534

# Dependency fetching happens at image build time, never in an agent container.
# Apt packages are not byte-reproducible; record the built image ID for replay.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git bash \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "3600"]
