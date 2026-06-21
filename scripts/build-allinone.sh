#!/bin/sh
# Build the all-in-one Docker image and save it as a gzipped tarball for handoff.
#
# Default: builds for the local machine's architecture (--load compatible).
# Multi-arch: set MULTI_ARCH=1 to build linux/amd64 + linux/arm64 as an OCI
#             layout (requires docker buildx; cannot be docker-loaded directly).
set -e

IMAGE=bookshelf:test
TARBALL=bookshelf-test.tar.gz

# Detect local arch for --load-compatible single-arch build
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  x86_64)  PLATFORM=linux/amd64 ;;
  aarch64|arm64) PLATFORM=linux/arm64 ;;
  *) echo "[build] Unknown arch: $HOST_ARCH, defaulting to linux/amd64" ; PLATFORM=linux/amd64 ;;
esac

if [ "${MULTI_ARCH:-0}" = "1" ]; then
  # Multi-arch OCI layout — verifies both arches build but cannot be docker-loaded.
  # Tester receives the single-arch tarball; this is a CI/maintainer-only step.
  OCI_TARBALL=bookshelf-test-multiarch.tar
  echo "[build] Building multi-arch image (linux/amd64 + linux/arm64) → $OCI_TARBALL..."
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -f Dockerfile.allinone \
    -t "$IMAGE" \
    --output "type=oci,dest=${OCI_TARBALL}" \
    .
  echo "[build] OCI layout saved to $OCI_TARBALL"
  echo "[build] (OCI layout is not docker-loadable; use skopeo or push to a registry)"
else
  echo "[build] Building for $PLATFORM → $IMAGE..."
  docker buildx build \
    --platform "$PLATFORM" \
    -f Dockerfile.allinone \
    -t "$IMAGE" \
    --load \
    .

  echo "[build] Saving to $TARBALL..."
  docker save "$IMAGE" | gzip > "$TARBALL"
  echo "[build] Done."
  echo
  echo "  Tester loads the image with:"
  echo "    gunzip -c $TARBALL | docker load"
  echo "    docker run -p 3000:3000 -v bookshelf-data:/data $IMAGE"
fi
